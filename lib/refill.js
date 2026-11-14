'use strict';

// Daily content pipeline:
//   topic -> generate answers (LLM) -> verify (second LLM pass + ground truth)
//         -> dedupe -> tier -> quality gates -> save as "ready" -> schedule days
//
// Uses plain fetch against the Messages API, so there are no dependencies.

const { norm } = require('./matcher');
const { validatePrompt } = require('./validate');
const { difficultyToTier } = require('./scoring');
const { ensureDay, addDays, dateKey } = require('./daily');
const { TOPICS } = require('./topics');
const { loadGroundTruth } = require('./groundtruth');

// Approximate USD per million tokens. Check Anthropic's pricing page and
// override with PRICE_<ROLE>_IN / PRICE_<ROLE>_OUT if these have changed.
const DEFAULT_PRICES = { generate: [2, 10], verify: [1, 5] };

class Budget {
  constructor(maxCalls, prices) {
    this.maxCalls = maxCalls;
    this.prices = prices;
    this.calls = 0;
    this.cost = { generate: [0, 0], verify: [0, 0] };
  }

  take() {
    if (this.calls >= this.maxCalls) throw new BudgetError(`API call budget of ${this.maxCalls} reached`);
    this.calls += 1;
  }

  add(role, usage) {
    this.cost[role][0] += usage?.input_tokens || 0;
    this.cost[role][1] += usage?.output_tokens || 0;
  }

  usd() {
    let total = 0;
    for (const role of Object.keys(this.cost)) {
      const [pin, pout] = this.prices[role];
      total += (this.cost[role][0] * pin + this.cost[role][1] * pout) / 1e6;
    }
    return total;
  }
}

class BudgetError extends Error {}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

async function callClaude({ env, fetchFn, budget, role, model, prompt, maxTokens }) {
  budget.take();
  const base = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const res = await fetchFn(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  budget.add(role, data.usage);
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function generationPrompt(topic) {
  return `You are building the answer bank for a daily developer trivia game.

Question: "${topic.text}"

List 40 to 60 DISTINCT answers that are objectively correct, ranging from what almost every developer would say to genuinely obscure but real entries. For each answer give:
- canonical: the display name
- aliases: other spellings, abbreviations or forms a player might type (may be empty)
- difficulty: integer 1-10 (1 = nearly every developer would say it, 10 = only specialists know it)
- evidence: where it is documented (spec, man page, official docs section)

Only include answers you are highly confident are real and correct. Do not invent entries to reach the count.
Respond with a single JSON object and nothing else: {"answers":[{"canonical":"...","aliases":["..."],"difficulty":1,"evidence":"..."}]}`;
}

function verificationPrompt(topic, answers) {
  return `You are a strict fact-checker for a developer trivia game.

Question: "${topic.text}"

For each candidate answer decide whether it is a real, correct answer to the question. Be strict: reject anything invented, deprecated beyond recognition, ambiguous, or not an answer to this exact question.

Candidates:
${answers.map((a, i) => `${i + 1}. ${a.canonical}`).join('\n')}

Respond with a single JSON object and nothing else: {"results":[{"n":1,"valid":true,"reason":"short reason"}]}`;
}

function newTopicPrompt(existing) {
  return `Propose ONE new topic for a daily developer trivia game of the form "Name a/an <thing>" where there are at least 40 objectively verifiable correct answers ranging from very common to very obscure.
It must not duplicate or closely overlap any of these existing prompts:
${existing.map((t) => `- ${t}`).join('\n')}
Respond with a single JSON object and nothing else: {"text":"Name a ...","category":"short-lowercase-slug"}`;
}

// Returns { prompt } on success or { rejected: reason }.
async function buildPrompt({ topic, ctx }) {
  const generated = extractJson(
    await callClaude({ ...ctx, role: 'generate', model: ctx.models.generate, prompt: generationPrompt(topic), maxTokens: 6000 }),
  );
  if (!Array.isArray(generated.answers)) return { rejected: 'generator returned no answers array' };

  // Shape check and dedupe by normalized canonical.
  const seen = new Set();
  let candidates = [];
  for (const a of generated.answers) {
    if (!a || typeof a.canonical !== 'string' || !a.canonical.trim()) continue;
    const key = norm(a.canonical);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      canonical: a.canonical.trim(),
      aliases: (Array.isArray(a.aliases) ? a.aliases : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()),
      tier: difficultyToTier(a.difficulty),
    });
  }

  // Layer 1: mechanical ground truth, when we have a trusted list.
  const truth = loadGroundTruth(topic.category);
  if (truth) candidates = candidates.filter((a) => [a.canonical, ...a.aliases].some((f) => truth.has(norm(f))));

  // Layer 2: independent LLM verification, one batched call.
  if (candidates.length === 0) return { rejected: 'no candidates survived ground-truth filter' };
  const verdict = extractJson(
    await callClaude({ ...ctx, role: 'verify', model: ctx.models.verify, prompt: verificationPrompt(topic, candidates), maxTokens: 4000 }),
  );
  const valid = new Set((verdict.results || []).filter((r) => r && r.valid === true).map((r) => r.n));
  candidates = candidates.filter((_, i) => valid.has(i + 1));

  // Layer 3: alias hygiene. An alias may not collide with another answer.
  const owners = new Map();
  for (const a of candidates) owners.set(norm(a.canonical), a.canonical);
  for (const a of candidates) {
    a.aliases = [...new Set(a.aliases)].filter((alias) => {
      const key = norm(alias);
      if (!key) return false;
      const owner = owners.get(key);
      if (owner && owner !== a.canonical) return false;
      owners.set(key, a.canonical);
      return true;
    });
  }

  // Quality gates.
  if (candidates.length < ctx.minAnswers) return { rejected: `only ${candidates.length} verified answers (need ${ctx.minAnswers})` };
  const tiersUsed = new Set(candidates.map((a) => a.tier));
  if (tiersUsed.size < 4) return { rejected: `answers span only ${tiersUsed.size} tiers` };
  if (candidates.filter((a) => a.tier >= 4).length < 2) return { rejected: 'too few hard answers' };

  const prompt = {
    id: `${slug(topic.category)}-${slug(topic.text)}-${ctx.today}`,
    text: topic.text,
    category: topic.category,
    fact: '',
    status: 'ready',
    source: 'llm',
    reviewed: false,
    answers: candidates,
  };
  const problems = validatePrompt(prompt, { minAnswers: ctx.minAnswers });
  if (problems.length) return { rejected: problems[0] };
  return { prompt };
}

async function pickTopic({ bank, ctx, rejectedTexts }) {
  const used = new Set(bank.prompts.map((p) => norm(p.text)));
  for (const t of rejectedTexts) used.add(norm(t));
  const next = TOPICS.find((t) => !used.has(norm(t.text)));
  if (next) return next;

  // Curated list exhausted: ask the model to propose a fresh topic.
  const proposal = extractJson(
    await callClaude({
      ...ctx,
      role: 'generate',
      model: ctx.models.generate,
      prompt: newTopicPrompt(bank.prompts.map((p) => p.text)),
      maxTokens: 300,
    }),
  );
  if (typeof proposal.text !== 'string' || typeof proposal.category !== 'string') return null;
  if (used.has(norm(proposal.text))) return null;
  return { text: proposal.text.trim(), category: slug(proposal.category) };
}

async function refill({
  store,
  config,
  env = process.env,
  fetchFn = fetch,
  log = console.log,
  now = () => Date.now(),
  daysAhead = 14,
  maxNew = 7,
  maxAttemptsPerPrompt = 2,
}) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

  const today = dateKey(new Date(now()), config.timezone);
  const n = config.questionsPerDay;
  const prices = {
    generate: [Number(env.PRICE_GENERATE_IN) || DEFAULT_PRICES.generate[0], Number(env.PRICE_GENERATE_OUT) || DEFAULT_PRICES.generate[1]],
    verify: [Number(env.PRICE_VERIFY_IN) || DEFAULT_PRICES.verify[0], Number(env.PRICE_VERIFY_OUT) || DEFAULT_PRICES.verify[1]],
  };
  const budget = new Budget(Number(env.MAX_API_CALLS_PER_RUN) || 40, prices);
  const ctx = {
    env,
    fetchFn,
    budget,
    today,
    minAnswers: Number(env.MIN_ANSWERS) || 25,
    models: {
      generate: env.GENERATE_MODEL || 'claude-sonnet-5-5',
      verify: env.VERIFY_MODEL || 'claude-haiku-4-5',
    },
  };

  // How many never-scheduled prompts do we still hold versus what the buffer needs?
  const targetDates = Array.from({ length: daysAhead }, (_, i) => addDays(today, i + 1));
  const schedule = store.schedule.read();
  const bank = store.bank.read();
  const everScheduled = new Set(Object.values(schedule).flat());
  const unused = bank.prompts.filter((p) => p.status !== 'rejected' && !everScheduled.has(p.id)).length;
  const futureSlots = targetDates.reduce((sum, d) => sum + (schedule[d] || []).length, 0);
  const missing = Math.max(0, daysAhead * n - futureSlots);
  const toGenerate = Math.min(maxNew, Math.max(0, missing - unused));

  const report = { generated: [], rejected: [], scheduledDays: [], calls: 0, estimatedUsd: 0, stoppedEarly: null };
  const rejectedTexts = [];

  for (let made = 0; made < toGenerate; ) {
    const liveBank = store.bank.read();
    let topic;
    let outcome = null;
    try {
      topic = await pickTopic({ bank: liveBank, ctx, rejectedTexts });
      if (!topic) {
        report.stoppedEarly = 'could not find a new topic';
        break;
      }
      for (let attempt = 1; attempt <= maxAttemptsPerPrompt && !outcome?.prompt; attempt++) {
        try {
          outcome = await buildPrompt({ topic, ctx });
        } catch (err) {
          if (err instanceof BudgetError) throw err;
          outcome = { rejected: err.message };
        }
        if (outcome.rejected) log(`  attempt ${attempt} for "${topic.text}" rejected: ${outcome.rejected}`);
      }
    } catch (err) {
      if (err instanceof BudgetError) {
        report.stoppedEarly = err.message;
        break;
      }
      report.stoppedEarly = err.message;
      break;
    }

    if (outcome?.prompt) {
      liveBank.prompts.push(outcome.prompt);
      store.bank.write(liveBank);
      report.generated.push({ id: outcome.prompt.id, answers: outcome.prompt.answers.length });
      log(`+ ${outcome.prompt.id} (${outcome.prompt.answers.length} verified answers)`);
      made += 1;
    } else {
      report.rejected.push({ text: topic.text, reason: outcome?.rejected || 'unknown' });
      rejectedTexts.push(topic.text); // do not retry this topic in the same run
      if (report.rejected.length >= 5) {
        report.stoppedEarly = 'too many rejected drafts';
        break;
      }
    }
  }

  // Schedule as many whole days as we have unseen prompts for.
  for (const date of targetDates) {
    const current = store.schedule.read()[date] || [];
    if (current.length >= n) continue;
    const bankNow = store.bank.read();
    const scheduledNow = new Set(Object.values(store.schedule.read()).flat());
    const fresh = bankNow.prompts.filter((p) => p.status !== 'rejected' && !scheduledNow.has(p.id)).length;
    if (fresh < n - current.length) break;
    ensureDay(store, date, n);
    report.scheduledDays.push(date);
  }

  report.calls = budget.calls;
  report.estimatedUsd = Number(budget.usd().toFixed(4));
  store.meta.write({ ...store.meta.read(), lastRefill: new Date(now()).toISOString() });
  return report;
}

module.exports = { refill, extractJson };

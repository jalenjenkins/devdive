'use strict';

const crypto = require('node:crypto');
const { match } = require('./matcher');
const { TIERS, LAYERS, tierInfo, layerFor, emojiRow } = require('./scoring');
const { dateKey, ensureDay, puzzleNumber } = require('./daily');

class GameError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const PLAYER_ID = /^[a-zA-Z0-9-]{8,64}$/;

function cleanName(name) {
  return String(name ?? '')
    .replace(/[^\w .-]/g, '')
    .trim()
    .slice(0, 16);
}

class Game {
  constructor({ store, config, now = () => Date.now() }) {
    this.store = store;
    this.config = config;
    this.now = now;
    this.rounds = new Map(); // token -> round (in memory; lost on restart)
    this.activeByKey = new Map(); // "playerId:date" -> token
  }

  today() {
    return dateKey(new Date(this.now()), this.config.timezone);
  }

  meta() {
    const date = this.today();
    return {
      date,
      puzzleNumber: puzzleNumber(date, this.config.launchDate),
      questionsPerDay: this.config.questionsPerDay,
      questionSeconds: this.config.questionSeconds,
      tiers: TIERS,
      layers: LAYERS,
    };
  }

  // ---- round lifecycle -------------------------------------------------

  start(playerId, name) {
    if (!PLAYER_ID.test(String(playerId ?? ''))) throw new GameError(400, 'invalid playerId');
    const date = this.today();

    const done = this.store.results.read().find((r) => r.playerId === playerId && r.date === date);
    if (done) return { finished: true, summary: this.summarize(done) };

    const key = `${playerId}:${date}`;
    let round = this.rounds.get(this.activeByKey.get(key));
    if (!round) {
      const prompts = ensureDay(this.store, date, this.config.questionsPerDay);
      if (prompts.length === 0) throw new GameError(503, 'no prompts available today');
      round = {
        token: crypto.randomBytes(16).toString('hex'),
        playerId,
        name: cleanName(name),
        date,
        prompts,
        index: 0,
        qStart: this.now(),
        updatedAt: this.now(),
        score: 0,
        depth: 0,
        answers: [],
      };
      this.rounds.set(round.token, round);
      this.activeByKey.set(key, round.token);
    }

    // A player who left mid-question loses that question when they return.
    if (this.isExpired(round)) {
      this.record(round, { matched: false, timedOut: true, input: '' });
      this.advance(round);
      if (round.index >= round.prompts.length) return { finished: true, summary: this.finish(round) };
    }
    if (round.qStart === null) round.qStart = this.now();
    return { finished: false, ...this.view(round) };
  }

  // Idempotent: a retry cannot restart a question whose timer is running.
  next(token, index) {
    const round = this.rounds.get(String(token ?? ''));
    if (!round) throw new GameError(404, 'round not found or already finished');
    if (index !== round.index) throw new GameError(409, 'out of sync');
    if (round.qStart === null) round.qStart = this.now();
    return this.view(round);
  }

  answer(token, index, input) {
    const round = this.rounds.get(String(token ?? ''));
    if (!round) throw new GameError(404, 'round not found or already finished');
    if (round.qStart === null) {
      throw new GameError(409, 'start the next question first', { needsNext: true });
    }
    if (index !== round.index) {
      throw new GameError(409, 'out of sync', { state: this.view(round) });
    }

    const prompt = round.prompts[round.index];
    const timedOut = this.isExpired(round) || (
      !String(input ?? '').trim() && this.now() >= round.qStart + this.config.questionSeconds * 1000
    );
    const hit = timedOut ? null : match(input, prompt.answers);

    const result = hit
      ? this.record(round, { matched: true, input, answer: hit.answer, fuzzy: hit.fuzzy })
      : this.record(round, { matched: false, timedOut, input });

    result.fact = prompt.fact || '';
    result.rarest = this.rarest(prompt, hit && hit.answer);

    this.advance(round);
    const finished = round.index >= round.prompts.length;
    const response = {
      result,
      score: round.score,
      depth: round.depth,
      layer: layerFor(round.depth),
      // Do not reveal the next prompt before its server timer starts.
      next: finished ? null : { index: round.index, total: round.prompts.length },
    };
    if (finished) response.summary = this.finish(round);
    return response;
  }

  // ---- internals -------------------------------------------------------

  isExpired(round) {
    if (round.qStart === null) return false;
    const limit = round.qStart + this.config.questionSeconds * 1000 + this.config.graceMs;
    return this.now() > limit;
  }

  view(round) {
    const totalMs = this.config.questionSeconds * 1000;
    const prompt = round.prompts[round.index];
    return {
      roundToken: round.token,
      total: round.prompts.length,
      index: round.index,
      prompt: { id: prompt.id, text: prompt.text, category: prompt.category },
      msLeft: Math.max(0, round.qStart + totalMs - this.now()),
      totalMs,
      score: round.score,
      depth: round.depth,
      layer: layerFor(round.depth),
      tiers: round.answers.map((a) => a.tier),
    };
  }

  record(round, { matched, input, answer, fuzzy, timedOut }) {
    const prompt = round.prompts[round.index];
    const info = matched ? tierInfo(answer.tier) : null;
    const entry = {
      promptId: prompt.id,
      matched,
      timedOut: Boolean(timedOut),
      canonical: matched ? answer.canonical : null,
      tier: matched ? answer.tier : 0,
      points: info ? info.points : 0,
      depthGained: info ? info.depth : 0,
    };
    round.answers.push(entry);
    round.score += entry.points;
    round.depth += entry.depthGained;

    this.store.appendLog({
      ts: new Date(this.now()).toISOString(),
      date: round.date,
      promptId: prompt.id,
      input: String(input ?? '').slice(0, 80),
      canonical: entry.canonical,
      tier: matched ? answer.tier : null,
      fuzzy: Boolean(fuzzy),
      timedOut: entry.timedOut,
    });

    return {
      matched,
      timedOut: entry.timedOut,
      canonical: entry.canonical,
      tier: entry.tier,
      tierName: info ? info.name : null,
      emoji: info ? info.emoji : null,
      points: entry.points,
      depthGained: entry.depthGained,
    };
  }

  advance(round) {
    round.index += 1;
    round.qStart = null;
    round.updatedAt = this.now();
  }

  // The rarest valid answers, as examples to learn from after each reveal.
  rarest(prompt, given) {
    return [...prompt.answers]
      .filter((a) => !given || a.canonical !== given.canonical)
      .sort((a, b) => b.tier - a.tier)
      .slice(0, 3)
      .map((a) => a.canonical);
  }

  finish(round) {
    const result = {
      playerId: round.playerId,
      name: round.name,
      date: round.date,
      score: round.score,
      depth: round.depth,
      tiers: round.answers.map((a) => a.tier),
      ts: new Date(this.now()).toISOString(),
    };
    const results = this.store.results.read();
    results.push(result);
    this.store.results.write(results);
    this.rounds.delete(round.token);
    this.activeByKey.delete(`${round.playerId}:${round.date}`);
    return this.summarize(result);
  }

  summarize(result) {
    const todays = this.store.results.read().filter((r) => r.date === result.date);
    const ranked = this.rank(todays);
    const rank = ranked.findIndex((r) => r.playerId === result.playerId) + 1;
    const layer = layerFor(result.depth);
    const number = puzzleNumber(result.date, this.config.launchDate);
    const row = emojiRow(result.tiers);
    return {
      date: result.date,
      puzzleNumber: number,
      score: result.score,
      depth: result.depth,
      layer,
      tiers: result.tiers,
      emojiRow: row,
      share: `Downstack #${number} ${row} ${result.depth}m (${layer.name}) ${result.score} pts`,
      rank,
      totalPlayers: ranked.length,
      leaderboard: this.entries(ranked, 10),
    };
  }

  rank(results) {
    return [...results].sort(
      (a, b) => b.score - a.score || b.depth - a.depth || a.ts.localeCompare(b.ts),
    );
  }

  entries(ranked, limit) {
    return ranked.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      name: r.name || 'anon',
      score: r.score,
      depth: r.depth,
    }));
  }

  leaderboard(date = this.today(), limit = 20) {
    const ranked = this.rank(this.store.results.read().filter((r) => r.date === date));
    return { date, entries: this.entries(ranked, limit) };
  }

  // Drops abandoned rounds so memory does not grow forever.
  sweep(maxAgeMs = 3600000) {
    const cutoff = this.now() - maxAgeMs;
    for (const [token, round] of this.rounds) {
      if ((round.qStart ?? round.updatedAt) < cutoff) {
        this.rounds.delete(token);
        this.activeByKey.delete(`${round.playerId}:${round.date}`);
      }
    }
  }
}

module.exports = { Game, GameError };

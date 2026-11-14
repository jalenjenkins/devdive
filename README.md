# Downstack (formerly DevDive)

A daily pixel-arcade rare-answer trivia game for developers. Seven prompts a day, 25 seconds each. Any correct answer scores, but the rarer it is, the more points you earn and the deeper you dive through the stack: Browser, Framework, Runtime, Operating System, Kernel, Firmware, Silicon.

Zero runtime dependencies. Needs Node 20 or newer.

```
npm start            # http://localhost:3000
npm test             # tests run locally, no network needed
```

## Pixel arcade redesign

The UI uses charcoal, warm white, and vermilion, a persistent computer-depth shaft, and self-hosted Press Start 2P for the prompt and game labels. Answer ranks are **Vibecoder → Indie Hacker → Bootstrapped → Breakout → Unicorn → Founder Lore**; point values, meter rewards, thresholds, and matching are unchanged. On phones, current depth stays visible and the full vertical map is available under **Explore the stack**. Local fonts and art work under the existing self-only CSP; there are no runtime dependencies or external font requests.

The reveal is untimed. After answering, `POST /api/answer` returns the next question's index and total, **not its prompt**. `POST /api/next` with `{roundToken, index}` atomically discloses that prompt and starts its server timer. Retrying Next does not reset the clock. `POST /api/start` resumes an active or paused round. This replaces the previous response shape that exposed the next prompt and began its timer during reveal; API clients must activate Next before answering. Existing `devdive.pid` and `devdive.name` localStorage keys are retained.

See `DESIGN.md` for the implemented visual system, `PRODUCT.md` for product constraints, and `public/assets/SOURCES.md` for asset provenance. The clipboard fallback exposes selectable text if browser clipboard access is unavailable.

## How it works

| Piece | File | What it does |
|---|---|---|
| Answer bank | `data/seed.json` | 13 hand-written prompts, about 35 to 60 answers each, tiered 1 (obvious) to 6 (deep cut). Compact format: `"canonical\|alias\|alias"`. |
| Matcher | `lib/matcher.js` | Normalizes input (case, spaces, hyphens, leading `git `/`node:`), exact match on canonical or alias, then one typo allowed on inputs of 5+ characters. Ambiguous typos score nothing. |
| Scoring | `lib/scoring.js` | Six tiers worth 10/20/35/55/75/100 points and 50/100/200/400/700/1200 meters. Depth maps to a stack layer. |
| Daily set | `lib/daily.js` | Same 7 prompts for everyone, chosen by a seeded shuffle of the date, one per category when possible, unseen prompts before repeats. Persisted on first use. |
| Game rules | `lib/game.js` | Server-side timer (25 s plus 1.5 s grace), one attempt per day, resume support, leaderboard, share string. |
| API + static files | `lib/server.js` | Plain `node:http`. Rate limited, body size capped, strict CSP. |
| Front end | `public/` | Vanilla JS, no build step. Keyboard-first, light and dark themes, reduced-motion friendly. |
| Daily automation | `lib/refill.js` | Generates, verifies and schedules new prompts. See below. |
| Feedback loop | `lib/retier.js` | Re-tiers answers from real player frequency and reports frequent unmatched inputs. |

The answer bank never leaves the server until a question has been answered. The timer is enforced on the server, so editing the page does not help.

## Daily automation

The refill pipeline keeps new content flowing without you writing it:

1. Pick a topic (curated list in `lib/topics.js`, then model-proposed topics once that runs out).
2. Ask the model for 40 to 60 answers with aliases, a 1 to 10 difficulty and an evidence note.
3. Verify. Where a ground-truth list can be built locally (`git help -a`, Node's built-in module list, Linux signal names, Python's stdlib list) answers not on it are dropped. Everything left goes through a second, strict model pass.
4. Strip colliding aliases, convert difficulty to tiers, and apply quality gates (at least 25 verified answers, at least 4 tiers represented, at least 2 hard answers).
5. Save as `ready` and schedule as many whole days ahead as there are unseen prompts for.

```
export ANTHROPIC_API_KEY=...
npm run backfill       # one-time: fill a 14-day buffer (about 98 prompts)
npm run refill         # daily: top up (7 new prompts)
npm run preview        # print tomorrow's set with answer counts and rarest answers
npm run retier         # blend tiers with real player frequency
```

Set `AUTO_REFILL=1` and the server runs the refill and re-tier itself, at most once every 22 hours. That needs a persistent data directory (a volume), because the bank, schedule and results are JSON files in `DATA_DIR`.

**Cost control.** `MAX_API_CALLS_PER_RUN` (default 40) is a hard cap, and every run prints an estimated spend. The built-in price table (`$2/$10` per million tokens for the generator, `$1/$5` for the verifier) is an approximation; override it with `PRICE_GENERATE_IN`, `PRICE_GENERATE_OUT`, `PRICE_VERIFY_IN`, `PRICE_VERIFY_OUT` and check Anthropic's pricing page. Models default to `claude-sonnet-5-5` (generate) and `claude-haiku-4-5` (verify); change them with `GENERATE_MODEL` and `VERIFY_MODEL`.

**Review window.** New prompts go live as scheduled, but you can veto any before its date:

```
ADMIN_TOKEN=pick-a-long-random-string
curl -H "x-admin-token: $ADMIN_TOKEN" "http://localhost:3000/api/admin/preview?date=2026-11-16"
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"id":"css-name-a-css-property-2026-11-15"}' http://localhost:3000/api/admin/reject
```

A rejected prompt is replaced automatically in any day that already contained it. Admin routes return 404 unless `ADMIN_TOKEN` is set.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DATA_DIR` | `./data` | Where `bank.json`, `schedule.json`, `results.json`, `answers-log.jsonl` live. Put this on a persistent volume in production. |
| `TIMEZONE` | `UTC` | Timezone that decides when the day rolls over, e.g. `America/New_York` |
| `LAUNCH_DATE` | `2026-11-15` | Puzzle #1 |
| `QUESTION_SECONDS` | 25 | Time per prompt |
| `QUESTIONS_PER_DAY` | 7 | Prompts per round |
| `ADMIN_TOKEN` | unset | Enables `/api/admin/*` |
| `TRUST_PROXY` | 0 | Set to `1` behind a proxy so rate limiting uses `X-Forwarded-For` |
| `RATE_LIMIT_PER_MIN` | 120 | Per-IP API requests per minute |
| `AUTO_REFILL` | 0 | Run the daily refill inside the server |

## Deploy

A `Dockerfile` is included. On Fly.io or Railway, mount a volume and point `DATA_DIR` at it.

```
fly launch --no-deploy            # then: fly volumes create data --size 1
# set DATA_DIR=/data, TIMEZONE, ADMIN_TOKEN, ANTHROPIC_API_KEY, AUTO_REFILL=1, TRUST_PROXY=1
fly deploy
```

Run a single instance. Active rounds live in memory, so two instances would not share them.

## Known limits (read before launch)

- **Storage is JSON files.** Fine for hundreds of players a day. Past a few thousand, move `results.json` and the answer log to SQLite or Postgres; `lib/store.js` is the only file that touches disk.
- **Active rounds are in memory.** A server restart mid-round drops that round, and the player can start a fresh one if they have not finished. They never lose a completed result.
- **No accounts.** A player is a random id in localStorage, so clearing storage lets someone play twice. Add sign-in if the leaderboard needs to be tamper-resistant.
- **Names are not profanity-filtered.** Only stripped to letters, digits, spaces, dots and dashes. Add a filter before a public launch.
- **Content accuracy is your responsibility.** The seed bank was written by hand and checked for internal collisions, not against every official source. Skim it, and use the unmatched-input report to add valid answers players typed.
- **Originality.** The mechanic of rewarding rare correct answers is generic, but write your own prompts, branding and visuals. Do not reuse another game's content.

## Tests

The redesign adds coverage for untimed reveals, prompt disclosure, idempotent Next, pause/resume, timeout classification, real depth positions, countdown boundaries, and startup scoring. There are 53 passing Node tests. Browser verification also exercised all six ranks, no-match, a full round, replay, clipboard fallback, network recovery, pending submission, and widths from 320px to 1440px.

`npm test` covers the matcher (typos, prefixes, ambiguity), bank integrity (no alias collisions, tiers), daily scheduling (determinism, category spread, rejection swaps), game rules (scoring, timeouts, grace window, resume, one attempt per day, no answer leakage), the HTTP layer (security headers, path traversal, rate limiting, admin auth), and the refill pipeline against a fake Claude API (bogus answers dropped, budget cap, give-up after repeated rejections).

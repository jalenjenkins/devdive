# Downstack

Downstack (formerly DevDive) is a daily rare-answer developer trivia game. A player gets seven prompts with 25 seconds per prompt. Any matched answer scores; rarer answers earn more points and descend farther through Browser, Framework, Runtime, Operating System, Kernel, Firmware, and Silicon.

## Users

Developers playing a short daily challenge on desktop keyboards or phones. First-time players need the rarity incentive explained in one sentence; returning players need immediate access to the prompt, countdown, and answer field.

## Product commitments

- One attempt per daily identity; the daily prompt set is shared by all players.
- Server-enforced question clocks, deterministic matching, and no answer-bank leakage before reveal.
- A reveal is untimed. The next prompt is disclosed and its timer starts atomically on Next (or resume).
- Six startup-themed answer ranks: Vibecoder, Indie Hacker, Bootstrapped, Breakout, Unicorn, Founder Lore. Titles describe answers, not players. Existing point values, depths, layers, and matching rules are retained.
- Keep question count and depth separate. Seven progress squares are questions; six rarity squares describe the answer tier.
- Pixel UI in charcoal, warm white, and vermilion. Purple, yellow, and green were explicitly rejected. Prompt typography uses the same pixel family as game labels.
- Use a server-issued HttpOnly guest session cookie for daily identity. Client-supplied IDs do not authorize rounds. The legacy display-name preference remains local; v1 identities require a deliberate migration before any existing production cutover.
- No accounts, purchases, lives, currency, or continuous-play loop. Return tomorrow for another descent.

## Production foundation

The served bank contains 72 source-backed prompts and 4,464 accepted-answer entries across nine categories. Runtime play requires no model calls or scraping. PostgreSQL stores sessions, frozen daily snapshots, rounds, idempotent submissions, reports, and indexed results across instances. SQLite is a durable single-instance fallback. Guest play is casual fair play; cookie deletion still creates a new identity. Reference updates are proposed for review, not silently published.

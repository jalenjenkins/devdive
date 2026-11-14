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
- Retain legacy devdive localStorage keys so the rename does not reset existing daily identities.
- No accounts, purchases, lives, currency, or continuous-play loop. Return tomorrow for another descent.

# Renewable reference catalog

`catalog.json` is the reviewed, versioned production question bank. It currently contains 72 prompts and 4,464 accepted-answer entries across CSS, HTML, JavaScript, Web APIs, Python, Node.js, Linux, Git, and HTTP. Entries across related prompts can overlap; this is not a claim of 4,464 unique facts or infinite unique questions.

## Primary sources

| Source | Import | Rights / attribution |
| --- | --- | --- |
| [MDN Browser Compatibility Data](https://github.com/mdn/browser-compat-data) | Pinned npm JSON; standard-track, non-deprecated, non-experimental features | [CC0-1.0](https://github.com/mdn/browser-compat-data/blob/main/LICENSE). We extract identifiers, not MDN article prose. |
| [Python runtime](https://docs.python.org/3/library/) | Standard modules, reserved keywords, built-ins, exceptions, and public module members | [Python license](https://docs.python.org/3/license.html). Identifiers are extracted from the installed runtime; documentation prose is not copied. |
| [Node runtime](https://nodejs.org/api/) | Public built-in modules; Linux signal and errno identifiers | [Node MIT license and third-party notices](https://github.com/nodejs/node/blob/main/LICENSE). No Node source implementation is bundled. |
| [Git command reference](https://git-scm.com/docs/git) | `git --list-cmds=main,nohelpers` | Command-name facts, not Git implementation or manual prose; [Git source license](https://github.com/git/git/blob/master/COPYING). |
| [IANA HTTP status registry](https://www.iana.org/assignments/http-status-codes/) | Assigned numeric codes and their registered descriptions | [IANA protocol registry CC0 terms](https://www.iana.org/help/licensing-terms). Unassigned, unused, and reserved entries are excluded. |
| [IANA HTTP field registry](https://www.iana.org/assignments/http-fields/) | Permanent field names | Same IANA protocol registry terms. Deprecated/obsoleted/provisional entries excluded. |

Source versions, download hashes where appropriate, license references, and import time are embedded in the catalog. Every prompt names its source. The player gets a source link on reveal.

## Refresh and review

Run on Linux with Node 24+, Python 3.12, Git and development dependencies installed:

```
npm ci
npm run content:refresh
npm run content:check
npm test
```

MDN is pinned in package-lock.json. Deliberately upgrade it with `npm install --save-dev --save-exact @mdn/browser-compat-data@latest` before refreshing if desired. IANA uses its current downloadable registries and records their hashes. CI proposes weekly source updates as pull requests; it does not publish unreviewed content automatically. Run a refresh behind an environment proxy with `NODE_USE_ENV_PROXY=1` when required by that environment.

Review newly added/removed identifiers, prompt wording, global HTML attributes, and version-specific APIs. Small or duplicate answer sets are excluded. The importer fails validation on alias collisions. An unchanged content version does not rewrite the bank. Restart/deploy after merging; existing daily snapshots remain frozen in the database.

## Rarity is editorial

`editorial-ranks.json` supplies initial difficulty tiers. Unlisted answers start at Bootstrapped (tier 3); no popularity or population-frequency claim is made. Reference data proves membership, not rarity. Review the editorial list and use aggregate player evidence for future changes; never retier a published daily puzzle.

The bank is finite and will repeat. Refreshes keep answers current; additional meaningful question templates and categories are required to expand variety. Avoid generating superficial variants just to increase a question count.

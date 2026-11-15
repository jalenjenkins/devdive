# Downstack

A deployable daily developer trivia game: seven open-answer prompts, 25 seconds per prompt, six startup ranks, and a descent through seven computing layers. Pixel typography, charcoal/warm-white/vermilion UI, desktop and mobile support.

**No paid AI service is required.** The production catalog contains **72 source-backed prompts and 4,464 accepted-answer entries across nine categories**. Content is imported from reference datasets and runtimes, reviewed in Git, and frozen per daily puzzle.

## Run locally

Requires **Node 24+**.

```sh
npm ci
npm start
# http://localhost:3000
```

Without `DATABASE_URL`, Downstack creates `data/downstack.sqlite` in WAL mode. Rounds, results, reports, and published puzzles survive restarts. Keep this directory on persistent storage. SQLite is for local development or one app instance.

## Deploy with PostgreSQL

Set `DATABASE_URL` to a PostgreSQL connection string and run the same app. Migrations execute transactionally at startup; concurrent PostgreSQL instances coordinate migrations with an advisory lock. The web service needs no persistent disk in this configuration.

```sh
DATABASE_URL='postgresql://user:password@host:5432/downstack?sslmode=verify-full' \
NODE_ENV=production npm start
```

Use your database provider's certificate-verified connection settings. This app does not turn off certificate verification. A provider may require its root certificate or a pooled connection URL.

### Render / a free-tier web host

1. Create an external PostgreSQL database (a free tier is sufficient for an initial launch, subject to provider quotas).
2. Connect this GitHub repository to Render as a **Blueprint**. `render.yaml` describes the Docker web service and readiness endpoint.
3. Enter `DATABASE_URL` when prompted. There is no database provisioned or billed by this blueprint.
4. Deploy and use the generated HTTPS URL. Set `PUBLIC_ORIGIN` to that exact origin if your proxy changes the host header. Set `TRUST_PROXY_HOPS` to the number of trusted proxies guaranteed by your host; the Render blueprint uses one hop.
5. Check `/api/ready`. It must return `ok: true` and `storage: postgres`.

Any Docker/Node host with HTTPS and PostgreSQL also works. Free hosts can sleep or enforce quotas; an external database preserves progress, but cannot remove a host's cold-start delay. Hosting accounts, database credentials, and a domain must be supplied by the owner; this repository does not create them automatically.

### Full local deployment with Docker Compose

```sh
docker compose up --build
# http://localhost:3000
```

Compose starts the app and a healthy PostgreSQL 17 database, with a named persistent database volume. Its default password and HTTP/development settings are **local only**. For production use a unique password, HTTPS, `NODE_ENV=production`, the correct origin, and host-managed database backups. The app container runs as a non-root user. For a single-instance production SQLite deployment, mount a persistent `/data` volume and explicitly set `ALLOW_SQLITE_IN_PRODUCTION=1`. Production otherwise refuses to start without `DATABASE_URL`, protecting free-host deployments from silently falling back to ephemeral files.

## How it scales

- **Stateless web instances:** guest identity is an opaque, server-issued HttpOnly cookie. Only its SHA-256 hash is stored. Round tokens are independently random and ownership is checked on every operation.
- **Durable rounds:** deadlines, answers, score, and reveal state live in SQL, not a process Map. Deploys and server restarts preserve a dive.
- **Transactional scoring:** row locks serialize concurrent mutations. A player/date uniqueness constraint prevents duplicate daily rounds and results. Duplicate answer requests return the original saved response; a different answer cannot replace it.
- **Frozen daily content:** the first successful daily snapshot wins atomically. Catalog updates never change a live day's accepted answers or tiers. Instances rolling across versions read the same snapshot.
- **Indexed leaderboard:** top-N queries use a date/score/depth/time index. Global rank/count still grows with the number of completions for that day; cache aggregate counts if that becomes a measured bottleneck.
- **Bounded caches:** only 32 immutable daily snapshots are cached per process. Fuzzy matching uses a linear one-edit check, not a quadratic matrix per candidate.
- **Shared abuse limits:** minute buckets live in SQL, so adding replicas does not reset them. Raw IP addresses are not stored in those buckets.
- **No runtime scraping or AI:** all accepted answers are deployed with the app. Import jobs do not compete with gameplay.

Start with one web instance and managed PostgreSQL. Add instances only when monitoring justifies it. Keep `DB_POOL_SIZE × instance count` below your provider's connection allowance; pooled database endpoints are useful on small plans. No sticky sessions or Redis are required. The local load smoke test is not a hosting-capacity guarantee.

## Renewable questions and accepted answers

See [data/SOURCES.md](data/SOURCES.md) for provenance, source versions, licenses, filters, and review policy.

```sh
npm run content:check        # offline validation of the shipped bank
npm run content:refresh      # Linux + Node 24 + Python 3.12 + Git; fetch IANA registries
npm run preview             # proposed next daily set; does not publish it
npm run preview -- 2026-12-01 --answers  # owner-only CLI inspection
```

MDN is a pinned development dependency. Upgrade it deliberately before a refresh if desired:

```sh
npm install --save-dev --save-exact @mdn/browser-compat-data@latest
npm run content:refresh
npm test
```

The weekly GitHub Actions refresh workflow proposes a pull request with updated sources and catalog. Review and merge it before deploying. Enable GitHub Actions' permission to create pull requests if your repository settings currently disallow it. Source facts are not copied from other trivia games. A refresh can add, remove, or correct identifiers; it does not promise endless novel questions. Expand meaningful templates/categories to reduce repetition.

Ranks are **editorial difficulty estimates**, not measured answer frequencies. Unlisted entries start at tier 3. Edit `data/editorial-ranks.json` and refresh to adjust future puzzles. Never infer rarity from name length or randomly assign it.

The old Anthropic generator remains available only as `npm run legacy:refill`, and the old frequency tool as `npm run legacy:retier`. They operate on the legacy JSON bank, **not the production SQL catalog**. They are not run by the web service and do not automatically publish AI-generated answers.

## API and game lifecycle

- `GET /api/meta`: date, ranks, layers, source summary; creates the browser session cookie.
- `POST /api/start` `{name?}`: start/resume the caller's daily round, saved reveal, or completed result. Client `playerId` fields are ignored.
- `POST /api/answer` `{roundToken,index,input}`: one server-scored answer. Exact retries are safe.
- `POST /api/next` `{roundToken,index}`: reveal the next prompt and start its deadline together. Retries cannot restart the timer.
- `POST /api/report` `{roundToken,index,note?}`: report an already submitted answer for review. Reports do not change scoring.
- `GET /api/leaderboard`: today's top 20.
- `GET /api/health`: liveness. `GET /api/ready`: database/content readiness.
- `GET /api/admin/reports`: latest 100 reports; requires `x-admin-token` matching `ADMIN_TOKEN`. Leave unset to disable.

Reveal time is untimed. Refreshing during reveal restores that reveal; a paused next question remains hidden until Next. Refreshing an expired active question records one timeout. Cookie deletion creates a new anonymous identity; this is casual fair play, not verified-account anti-cheat. Accounts/payment processing are not implemented.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener; honors platform-assigned ports |
| `DATABASE_URL` | unset | Shared PostgreSQL; otherwise SQLite |
| `DATA_DIR` | `./data` | SQLite directory; persistent volume required |
| `ALLOW_SQLITE_IN_PRODUCTION` | unset | Explicit opt-in for one instance with persistent SQLite storage |
| `DB_POOL_SIZE` | `10` | PostgreSQL connections per app instance |
| `TIMEZONE` | `UTC` | Shared daily reset timezone |
| `LAUNCH_DATE` | `2026-11-15` | Puzzle numbering start |
| `QUESTION_SECONDS` | `25` | Server-enforced clock |
| `QUESTIONS_PER_DAY` | `7` | Daily question count, capped at 10 |
| `PUBLIC_ORIGIN` | inferred host | Exact allowed browser origin, no trailing slash |
| `TRUST_PROXY_HOPS` | `0` | Trusted forwarding hops counted from the right |
| `RATE_LIMIT_PER_MIN` | `120` | Per-IP API requests; health/readiness excluded |
| `RETENTION_DAYS` | `90` | Retain round state, inputs, reports, and results |
| `ADMIN_TOKEN` | unset | Server-side owner reports credential |

`NODE_ENV=production` enables Secure cookies and HSTS. Serve it behind HTTPS. Local HTTP should use development mode. Cookies are required for play. Secrets never belong in frontend files or committed `.env` files.

## Operations and upgrades

```sh
npm run db:migrate
npm run maintenance
```

Maintenance also runs hourly and at startup. It deletes expired rate buckets and cascades deletion of rounds/results/reports older than the configured retention window, then prunes unreferenced snapshots and inactive identities. Configure retention before launch. Back up PostgreSQL using your provider or `pg_dump`; back up SQLite consistently using its backup API or while the app is stopped. Test restores.

**Upgrading from v1:** legacy `bank.json`, `results.json`, schedules, and localStorage IDs are not automatically imported into SQL. They are left untouched. Archive them before upgrading an existing deployment; this release starts a new cookie-based identity system and a new reviewed bank. Do not delete legacy data expecting a migration. Published v2 snapshots are preserved across subsequent catalog updates and restarts. Future destructive schema changes require explicit migrations; the initial schema here is additive/idempotent.

## Verification

```sh
npm test
TEST_DATABASE_URL=postgres://user:password@localhost:5432/downstack_test npm test
npm run test:browser  # after npx playwright install chromium
TEST_DATABASE_URL=postgres://user:password@localhost:5432/downstack_load_test npm run test:load
```

PostgreSQL integration/load checks require disposable database names ending in `_test`; the integration test truncates its test tables. Never point them at production. Browser checks launch their own isolated SQLite server, exercise a real source-backed round, reports, reload/reveal recovery, clipboard fallback, source links, pixel typography, and widths from 320px to 1440px. `BROWSER_PATH` can select an existing Chromium executable. Captures go into ignored `test-results/`.

CI runs tests against SQLite and PostgreSQL, browser checks, and a Docker build. Local smoke checks are evidence of working paths, not a substitute for production monitoring or a security audit.

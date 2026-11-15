# Release verification

Validated against catalog `0afa8ba66dfe6fa5f30f47d7`: 72 prompts, 4,464 accepted-answer entries, nine categories and six primary-source records.

- **57 Node tests passed, zero skipped**, with a real PostgreSQL 17 test service enabled. This includes ownership checks, frozen daily answers, concurrent starts/submissions, restart recovery, idempotent retries, timeout/grace handling, reports, source filtering, catalog integrity, and the linear typo matcher.
- **Chromium browser flow passed** using the actual reference catalog: complete daily round, source links, report submission, saved reveal after reload, clipboard fallback, pixel prompt typography, and widths 320/390/760/1024/1280/1440.
- **Two-instance PostgreSQL smoke test:** 30 simulated players, 150 requests, approximately 962ms total, p50 219ms and p95 434ms in the task's local environment. This checks integration paths, not production hosting capacity.
- **Docker build passed.** The task environment requires an additional certificate for its network proxy; it was supplied only through a temporary BuildKit secret and temporary Dockerfile copy. The committed Dockerfile retains normal TLS verification and contains no environment certificate.
- **Both non-root container modes passed:** SQLite with a writable named volume and PostgreSQL over a private container network. Each completed an API answer, underwent an actual container restart, restored the same reveal, and started the next timer successfully.
- **Production dependency audit:** no reported vulnerabilities at verification time.
- **Production storage guard:** production refuses to start without PostgreSQL unless persistent single-instance SQLite is explicitly opted into.
- **No production data or paid services were used.** Test databases, credentials and container networks were isolated.

## What still belongs to deployment

Provide a real hosting account and PostgreSQL connection string, configure HTTPS/proxy settings, and verify backups/restore and provider quotas. The repository includes a Render blueprint, Docker Compose, automatic additive migrations, readiness checks, CI, and reviewed weekly content-refresh pull requests. Their remote executions depend on repository permissions and the chosen hosting service.

The bank is finite, rarity starts from editorial tiers, guest cookie deletion can create a new identity, and pre-v2 JSON history is not automatically migrated. See README and data/SOURCES.md for those boundaries.

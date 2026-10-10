# Server and web operations

Local implementation verified 10 October 2026. Deployment and production migrations are separate release actions. No cloud deployment has been made by this work.

## Local setup and acceptance

Use Node 22 and pnpm 10.34.6. Install with `pnpm install --frozen-lockfile`, configure ignored app environment files from their examples, and build with `pnpm build`. Keep the web origin at `http://localhost:3000`, the API at `http://127.0.0.1:4000`, and the same development Clerk instance on both apps.

Run `pnpm db:migrate` only against the intended development database. The existing local database has already received the initial migration; do not manually reapply its SQL. Integration tests create/drop separate local databases when `TEST_DATABASE_URL` is absent. A supplied disposable URL must differ from runtime/direct database identities; its tests create/drop isolated schemas. The local role needs `CREATEDB` only for automatic database creation.

Run `pnpm check`, `pnpm test`, `pnpm test:integration`, `pnpm test:storage`, `pnpm test:e2e`, `pnpm smoke`, `pnpm smoke:desktop`, and `pnpm format:check`. Storage/browser checks require development Clerk/R2 credentials and remove their synthetic fixtures. Browser tests exercise actual Clerk sessions and 20 MiB PNG transfers. The padded PNG transfer fixture does not establish worst-case image-processing memory.

The manually dispatched `Development browser acceptance` GitHub workflow requires a `development` environment with development-only Clerk and dedicated test-bucket R2 secrets matching the environment names in its YAML. It uses fresh PostgreSQL and migrates that database before testing. Production Clerk keys are refused. Configure the GitHub environment before dispatch; the workflow has not run remotely. Ordinary CI runs credentials-free build/unit checks and PostgreSQL integration checks.

## Development upload fixture

After building shared packages, start API/web and set a fresh Clerk **session token** in the current process environment as `SCREENSTASH_SESSION_TOKEN`. Use a secure local session/token inspection workflow; do not paste it into chat, commit it, or place its value in shell history. `SCREENSTASH_API_ORIGIN` optionally overrides the default `http://localhost:3000`.

```powershell
pnpm fixture:upload C:\path\synthetic.png C:\path\synthetic-ocr.txt
```

The OCR argument is optional and capped at 1 MiB before loading. The script verifies basic PNG metadata, computes its checksum, creates a fresh capture identity, PUTs directly to R2, and finalizes through the authenticated API. Each invocation creates a new capture; protocol retry/idempotency is tested separately. It prints only capture/screenshot IDs and status. Remove the session token from the process environment after use. This script is a development tool; the product has no browser upload screen.

## Limits and recovery

| Policy                            | Default                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| PNG                               | 20 MiB, 40 million pixels, 16,384 pixels per side, one frame                                       |
| Account storage / pending uploads | 1 GiB / 25                                                                                         |
| Image processing                  | One operation per process, two per owner, four across instances                                    |
| Shared processing slot            | Three-minute expiry; reclaim after worker termination                                              |
| Sharp decode / preview deadline   | 20 seconds                                                                                         |
| Express function duration         | Explicit 120 seconds; verify detected function and plan on deployment                              |
| Expensive-operation throttles     | Upload authorization 30/min, finalization 30/min, renewal 20/min per owner                         |
| Other throttles                   | `/api/me` 60/min, device registration 30/min, tag creation 60/min, share creation 10/min per owner |
| Public access                     | 300/min per token hash, 6,000/min aggregate; crawler access needs no account or IP-header trust    |
| Maintenance                       | Up to 20 jobs / 45 seconds per invocation                                                          |

`ACCOUNT_STORAGE_BYTES`, `ACCOUNT_PENDING_UPLOADS`, and `IMAGE_PROCESSING_GLOBAL_LIMIT` are validated API configuration. Capacity failures return retryable 503; throttling returns 429 with `Retry-After`. The shared processing admission uses short PostgreSQL transactions and expiring slots; image I/O runs outside transactions. Failed writes use fresh immutable final keys on retry and leave durable orphan-cleanup jobs.

Run `pnpm configure:maintenance` to fill a missing local `CRON_SECRET` without displaying it; an existing valid secret is preserved. The secret is configured locally now. Configure its matching server-only value in Vercel. Never put it in a browser/desktop public variable. The API cron targets `/api/internal/maintenance` daily; verify provider scheduling and bearer authorization on deployment. Manual recovery calls use the same secret and bounded endpoint. Existing code permits safe overlapping workers with leased jobs and retry backoff.

`pnpm ops:status` prints aggregate pending/due/retried cleanup counts, oldest pending timestamp, expired uploads, active processing slots, and configuration presence. It prints no object keys, user identifiers, share tokens, or provider credentials. Investigate a growing due backlog, repeated retries, or old pending records. An active-object job is deferred rather than completed; live originals/previews and in-flight writes must survive maintenance. Late staging writes are held until their last PUT expiry plus a safety margin. Orphans receive a five-minute grace period.

## Vercel, R2, and Clerk release configuration

For review of an existing backlog, run `pnpm ops:review-cleanup`. It writes the exact first 200 pending job IDs/object keys, reasons, deadlines and reference/protection flags to ignored `test-results/cleanup-review.json`. It does not inspect or delete storage objects. Review due/protected flags and intended owners before approving any destructive backlog execution. Existing-backlog execution in this continuation was blocked by automatic approval review; the application jobs remain pending.

Create separate Vercel projects rooted at `apps/api` and `apps/web`, including workspace dependencies. Use their checked-in build commands, Node runtime, and matching Node version. Express default-exports `src/index.ts`; only local `server.ts` listens. Check the deployed function actually receives the 120-second duration. Set web `EXPRESS_API_ORIGIN` to the API origin, and API `WEB_ORIGIN`/`PUBLIC_BASE_URL` to the canonical web HTTPS origin before building. Never infer canonical URLs from client Host headers. Verify current plan eligibility, quotas, regions, connection counts and transfer usage before release.

Use a private R2 bucket with bucket-scoped credentials. Disable public bucket/custom-domain image access; the application streams authorized bytes. Do not add blanket browser CORS: the fixture uploader PUTs from Node, and a future Electron uploader must prove its actual request path before adding only the required origins/methods/headers. Configure expiration **only on the staging prefix**, conservatively longer than session/PUT lifetimes (for example seven days). Do not apply lifecycle deletion to referenced originals/previews. Keep image/object keys immutable.

Use pooled PostgreSQL runtime connections and a separate direct migration URL. Run migrations from a controlled release step after reviewing SQL and making a recoverable backup. Verify the app's small pool lifecycle on Vercel and monitor connection/query latency.

Configure matching Clerk production keys, web domains, redirects, and sign-in methods. Register the API `/api/webhooks/clerk` endpoint for `user.deleted` and supply its signing secret. The local webhook signing secret is still absent; real delivery is unverified. Signed/deduplicated fixture events pass integration tests. Verify actual delivery/retry monitoring and immediate tombstone behavior before production use; local synthetic-account teardown is not proof of webhook delivery.

Keep public `/s/*` pages/media reachable without deployment protection, login, or bot challenges. Next renders fresh share details with `cache: 'no-store'` and blocking metadata for all agents. Express independently authorizes each media GET/HEAD. Do not add persistent route/data caches, positive CDN TTL, redirects to storage URLs, image optimization caches, or analytics exposing token paths. Configure platform/error-tracking redaction for `/s/:token` and `/api/public/shares/:token`; application error responses are sanitized, but provider access logs need separate configuration.

## Deployment acceptance and backup rehearsal

On an isolated HTTPS deployment, repeat real Clerk sign-in/sign-out, owner separation, cookie media and bearer JSON transport. Transfer a 20 MiB PNG through both API and web proxy; compare checksums and HEAD lengths. Exercise a real 40-million-pixel PNG under concurrent finalization/share creation, measure peak memory/runtime, and verify retryable capacity failures, expired leases and cleanup recovery. Local builds/tests cannot establish provider streaming or Fluid concurrency behavior.

Create a synthetic share, inspect raw HTML for browser/Discord/Twitter user agents, and check OG/Twitter tags, approved title, generic descriptions/alt, absolute preview URLs, JPEG 1200 × 630 and no private metadata. Warm page/details/images, then replace/revoke/delete and confirm all fresh GET/HEAD return 404 without 304 or stale cached content. Confirm effective no-store headers on success, 404 and provider errors. Paste a newly issued synthetic link into Discord and X and record actual preview results. Revocation stops new application responses; existing downloads/platform caches cannot be withdrawn.

Before release, define database backup retention and object recovery together. Rehearse restoring a database snapshot into a separate database/branch, run migrations there if needed, and verify owner associations, active-share hashes, search indexes and cleanup leases. Reconcile every restored live object key against a separate preserved R2 copy/inventory. A database snapshot alone cannot restore objects already deleted by maintenance; a restore rehearsal must use retained object bytes and must not reactivate previously revoked links or deleted accounts. Keep cleanup disabled on the isolated restore until reconciliation is reviewed. Record recovery time/data-loss targets and an explicit restore result; no backup/restore rehearsal has been performed yet.

Release remains pending until these deployed, webhook, backup and social checks are recorded. Desktop authentication/capture/OCR/queue remains its separate implementation stage.

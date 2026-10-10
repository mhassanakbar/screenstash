# Server and web implementation plan

Status: approved; server/web features implemented and locally verified on 10 October 2026. Deployment gates remain pending.
Prepared: 8 October 2026.
Sources: specification v0.5 and implementation document v1.6.

Progress (10 October 2026): phases 1–6 are implemented with local PostgreSQL, real development Clerk, live R2 and production-browser acceptance. Search/edit/date/tag controls and public sharing now pass, including initial social metadata and warmed replacement/revocation/deletion. Latest counts: 23 unit tests, 32 PostgreSQL integration tests, one live R2 test and two browser tests. Phase 7 has local checks, operations utilities/runbook and CI configuration; deployed webhook/cron/streaming/cache/processing, backup/restore and actual Discord/X previews remain pending. See the [current checkpoint](../screenstash-implementation.md#implementation-checkpoint--10-october-2026) and [operations runbook](operations-runbook.md). No deployment has been performed.

## Scope and checkpoint

Implement the Express API, Next.js website, and their shared contracts, HTTP client, and PostgreSQL package. Preserve the existing Electron foundation; its capture, OCR, auth renderer, and queue implementation remain a separate stage.

This document is the requested pre-implementation review checkpoint. After approval, implement the phases in order, passing their technical verification gates before advancing. Routine fixes and subsequent phases do not need repeated approval. Deployment and migration of an existing production database are separate release actions.

Do not add collections, teams, annotation, semantic search, or a browser upload product flow. Exercise the desktop-facing upload protocol through development test fixtures until the desktop uploader exists.

## Preflight results

Verified the current checkout before preparing this plan:

| Item                 | Evidence / status                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Repository           | Clean before this plan; latest commit `bfb5e1d`                                                                   |
| Server/web baseline  | 15 successful Turbo lint, typecheck, and build tasks across the API, website, and three shared packages           |
| Production runtime   | Existing smoke test passed: API health, Next.js page, API/media rewrites, HEAD, JSON 404, no-store                |
| Feature state        | API health/404 only; placeholder web page; database schema empty                                                  |
| Clerk                | API and web configuration values are present; credentials/session behavior have not been validated                |
| R2                   | API integration values are present; bucket access and permissions have not been validated                         |
| PostgreSQL           | `DATABASE_URL` and `DIRECT_DATABASE_URL` are empty                                                                |
| Webhook/maintenance  | `CLERK_WEBHOOK_SIGNING_SECRET` and `CRON_SECRET` are empty                                                        |
| Local database tools | Docker and psql were not found on PATH                                                                            |
| Environment loading  | Next.js reads its local environment file; the API and migration runner currently do not automatically load theirs |
| Deployment           | Vercel projects/configuration have not been exercised against live services                                       |

Only variable names and presence were inspected; secret values were not printed. A populated variable does not prove that its credentials are valid.

Proposed database setup: use an isolated Neon development database plus a separate disposable test database/branch. Keep pooled runtime and direct migration URLs distinct. Supply service credentials through ignored environment files/provider settings. Generate the maintenance secret locally during implementation; obtain the webhook signing secret from the configured Clerk webhook endpoint.

Missing service configuration does not prevent writing contracts, migrations, or isolated tests. It does prevent claiming that real database/auth/storage integration is verified. Record such gates as pending rather than substituting a permissive auth or storage fallback.

## Sequence and verification gates

### 1. Configuration, contracts, database, and test harness

Implement:

- Explicit local environment loading for the API and migration tooling; Vercel continues to supply environment variables directly.
- Typed configuration validation, request IDs, sanitized error responses, small JSON limits, origin/proxy policy, and safe log redaction. Keep health independent of credentials; dependency readiness reports unavailable dependencies without leaking their configuration.
- Zod request/response contracts and application error codes in `packages/shared`; extend the typed client with session-token injection, abort support, and structured API errors.
- Drizzle schema and reviewed SQL migrations for users, devices, screenshots, tags, screenshot tags, upload sessions, shares, webhook deduplication, cleanup jobs, and shared rate-limit state.
- Unique capture identities, owner-aware associations, one active share per screenshot, tombstones, search indexes, and leased work constraints.
- A small reusable pooled runtime database adapter with function lifecycle handling. Migration commands target the explicit direct connection.
- Vitest API/integration test infrastructure and Playwright web test infrastructure, isolated service configuration, and deterministic PNG/OCR-text fixtures.

Verify before advancing:

- Invalid configuration fails predictably without exposing secrets; placeholders still build without contacting production services.
- Shared contracts reject invalid fields and cannot express a client-selected owner identity.
- Apply migrations to a fresh disposable PostgreSQL database; inspect constraints/indexes and test uniqueness, owner associations, and lease claims.
- Verify pooled runtime connections and transactional behavior against that database.
- Run scoped lint, typecheck, build, and the existing production smoke check.

Gate: configuration/contracts compile and real PostgreSQL migration/constraint tests pass. If the development/test URLs are not configured, report this gate as pending and continue only independent work.

### 2. Clerk authentication and the protected web shell

Implement:

- Pin compatible `@clerk/nextjs` and `@clerk/express` versions.
- Next.js `src/proxy.ts`, account/vault layouts, Clerk provider, SignIn, SignUp, UserButton/profile UI, sign-in redirects, and a protected vault shell.
- Express Clerk session verification, explicit authorized-party configuration, internal owner provisioning, `GET /api/me`, and idempotent `POST /api/devices`.
- Bearer authorization for application JSON requests. Private media GET/HEAD can use Clerk's same-origin cookie; cookie-only mutations are rejected.
- Signed raw-body Clerk deletion webhooks, event deduplication, identity tombstones, immediate access denial/share revocation, and durable cleanup scheduling.
- TanStack Query account boundaries: include verified identity in private keys and clear private state on sign-out/account changes.
- Tailwind/shadcn foundations and accessible navigation for the signed-in shell.

Verify before advancing:

- Real development Clerk sign-in/sign-out works; two test accounts map to distinct owners.
- Missing, expired, invalid, wrong-instance, and disallowed-party tokens fail; API responses are JSON rather than login redirects.
- Bearer headers and private media cookies reach Express through Next.js rewrites. Session cookies cannot authorize mutations.
- Duplicate provisioning creates one owner/device. Forged and duplicate deletion events are safe; deleted identities cannot recreate their vault.
- Public sharing paths remain outside mandatory sign-in/provider layouts.
- Build the production website and run auth/browser integration checks using supported Clerk test tooling.

Gate: authenticated web-to-API identity and account isolation work with the real development Clerk instance and database. Signed webhook delivery remains pending until its endpoint/secret are configured.

Official integration references: [Clerk Next.js middleware](https://clerk.com/docs/reference/nextjs/clerk-middleware), [Clerk Express middleware](https://clerk.com/docs/reference/express/clerk-middleware), [Clerk webhooks](https://clerk.com/docs/guides/development/webhooks/syncing).

### 3. R2 uploads, authorized media, and durable cleanup

Implement:

- A private R2 adapter, server-generated keys, presigned staging PUT authorization, application quotas, and shared rate limiting.
- Upload-session creation/status/renewal/finalization with immutable expected metadata, checksum verification, bounded PNG decoding, reserved final keys, and retry-safe database transitions.
- Private original/download GET/HEAD streams with ownership checks, backpressure, disconnect cancellation, no-store headers, and sanitized attachment filenames.
- A leased cleanup processor for staging, originals, previews, expired sessions, and deleted accounts/screenshots. Protect the bounded maintenance handler with `CRON_SECRET`.
- A development fixture uploader that uses the normal authenticated protocol with a supplied PNG and OCR text; this enables server/web acceptance before Electron capture exists.

Verify before advancing:

- Real R2 staging PUT and finalization work. Repeat/concurrent finalization returns one screenshot.
- Wrong checksums, invalid PNGs, dimension/byte-limit violations, foreign sessions, expired URLs, and incompatible capture retries are handled correctly.
- A still-valid staging PUT cannot change the verified immutable original.
- Download checksums match source bytes, including a 20 MiB fixture. Test GET/HEAD and headers through both API and Next.js rewrite paths.
- Interrupted finalization and object cleanup recover safely without deleting live objects. Missing objects make cleanup idempotent.
- Multiple invocations obey account quotas, shared rate limits, and cleanup leases.

Early hosting spike: once an isolated Vercel preview is available, verify 20 MiB streaming and worst-case Sharp processing there before building the full media UI. Local streaming alone does not validate the serverless path. Treat this as a deployment gate; do not weaken authorization or reduce screenshot limits silently if it fails.

Vercel limits request bodies to 4.5 MB and documents a streamed-response exception; direct uploads and an actual deployed streaming check are required. Hobby cron supports daily runs, so immediate logical denial must be independent of eventual physical deletion. [Payload guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions), [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Gate: the complete authenticated fixture upload/download cycle and cleanup recovery pass against development PostgreSQL/R2. The hosting spike must pass before deployment readiness is claimed.

### 4. Private gallery, detail, download, and deletion

Implement:

- Owner-scoped screenshot list/detail endpoints with validated cursors, deterministic date/ID ordering, and DTOs that omit storage credentials/keys.
- Responsive gallery, lazy original images, loading/empty/error states, screenshot detail, downloads, and permanent-delete confirmation.
- Logical deletion that immediately excludes the screenshot and revokes shares, then durably schedules physical cleanup.
- Visible-page polling/focus refresh so later desktop uploads appear automatically; stop background polling and cancel stale requests on account changes.

Verify before advancing:

- Fixture uploads appear in the signed-in gallery and survive a browser reload.
- User B cannot list, view, stream, download, or delete User A's screenshots using known IDs.
- Pagination does not duplicate/skip deterministic fixture results; stale responses cannot populate another account's cache.
- Delete immediately removes all authorized access, and delayed upload retries cannot recreate the deleted capture.
- Browser checks cover mobile/desktop layout, keyboard interaction, error recovery, and download content.

Gate: the private upload-to-gallery-to-download/delete vertical slice is usable and isolated between two real accounts.

### 5. Rename, tags, dates, and text search

Implement:

- Owner-scoped tag list/create, normalized uniqueness, transactional rename/tag assignment, and weighted PostgreSQL full-text indexing.
- Search title/tag/OCR text using the specified `simple` dictionary; AND tag filters, UTC half-open capture-date ranges, and filter-bound cursors.
- Debounced search, tag assignment/filtering, URL-preserved filters, date controls, and pagination resets.

Verify before advancing:

- Known OCR/title/tag fixtures are found only by their owner.
- Rename/tag changes update search in the same transaction; foreign tag IDs cannot be attached.
- Test punctuation/blank queries, injection-like text, multi-tag AND semantics, timezone/daylight-saving boundaries, and changed-filter cursors.
- Browser search and filter states survive reload/back navigation.

Gate: organization/search API and browser acceptance checks pass with real PostgreSQL; source OCR generation remains a desktop-stage check.

### 6. Public shares and social metadata

Implement:

- Owner-only share status/create/replace/revoke endpoints. Store only token hashes, publish the approved public title, and reveal a new link once.
- Generate the 1200 × 630 JPEG preview before activating the share; handle concurrent replacement/deletion and preview cleanup.
- Fresh token-authorized details, original, and preview endpoints with generic unavailable responses.
- Web share dialog and public `/s/[token]` Server Component with blocking `generateMetadata`, no-store lookup/page/media behavior, no-referrer policy, and escaped metadata.
- Keep private titles, OCR, owner identity, and object keys out of public output.

Verify before advancing:

- Signed-out visitors can open active links and decode the original/preview without Clerk UI.
- Raw initial HTML contains Open Graph/Twitter tags for ordinary browsers, Discord, and Twitterbot.
- Warm the page and both media paths, revoke/delete/replace, and verify subsequent GET/HEAD returns 404 without stale 200/304 responses.
- Unknown/unshared/deleted screenshots reveal no private data. Test malicious titles and very tall/wide/transparent sources.
- Old tokens fail after replacement; overlapping share operations preserve one active share.

Gate: public access, initial metadata, and revocation pass in production-mode tests. Deployed cache behavior and real Discord/X previews are separate release evidence. [Next.js metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata).

### 7. Integration, operations, and release verification

Implement:

- Extend CI with meaningful unit, real PostgreSQL integration, and authenticated web E2E checks.
- Complete readiness diagnostics, sanitized observability, cleanup backlog monitoring, retry/deadline handling, environment documentation, and a migration/deployment runbook.
- Configure plan-appropriate maintenance scheduling, bucket lifecycle, cache policies, Clerk origins/webhooks, and preview/production isolation.
- Prepare independent Vercel API/web builds and record database/function/transfer usage.

Verify before declaring server/web complete:

- Run lint, typecheck, production builds, focused unit/integration tests, browser E2E, and the original foundation smoke checks.
- On an isolated deployment, repeat Clerk bearer/cookie transport, maximum-size streaming, concurrent Sharp/finalization behavior, cleanup interruption recovery, and warmed-cache revocation.
- Validate a copied development share in Discord and X and record actual preview results and platform caching limitations.
- Record all pending provider configuration or external verification explicitly.

Gate: local implementation evidence is complete; deployment readiness requires its own live evidence and reviewable release configuration.

## Working method after approval

Implement in reviewable increments. Before each phase, inspect its affected contracts, constraints, SDK APIs, and prerequisite results. Define the focused acceptance cases, implement the increment, then run its verification gate. Fix regressions before advancing. Keep this plan updated with passed/pending gates and links to evidence.

Use real PostgreSQL for database invariants and real configured Clerk/R2 for end-to-end integration. Unit doubles may exercise failures but do not replace provider checks. Do not add fake production auth or an in-memory production database to make tests pass.

The initial implementation increment is Phase 1: environment loading/validation, API conventions, shared contracts, database schema/migrations, and the service test harness. PostgreSQL connection configuration is the first external prerequisite for its complete gate.

## Review decision

Confirm the phase order and verification gates before Phase 1 feature changes begin. This single plan approval authorizes the implementation sequence; additional questions should be limited to genuinely missing inputs or separate release actions.

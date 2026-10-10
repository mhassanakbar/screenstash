# Desktop implementation plan

Prepared 10 October 2026. Status: approved by the user; the first phase-1 increment passes packaged development acceptance. Additional UI/hardware gates and phases 2–7 remain pending.

Sources: [specification v0.5](../screenstash-spec.md), [implementation document](../screenstash-implementation.md), and baseline checkout `b1fc167`. Server/web features have passed local acceptance. The current desktop adds Clerk authentication, trusted IPC, encrypted session storage and a display probe. Tray, persisted captures, OCR, settings and the upload queue remain absent.

## Implementation checkpoint — 10 October 2026

- Pinned `@clerk/electron` 0.1.0 and `electron-store` 8.2.0. Native API is enabled, confirmed by the user. Development Clerk origins preserve the web origin and explicitly include `http://localhost:5173` and `screenstash://renderer`.
- Main owns the application lock, custom asset protocol, service origins, CSP and sender/main-frame checks. The official sandboxed preload exposes Clerk plus named, validated application operations. A correlated token broker discards outstanding credentials on account changes and renderer loss.
- Observed real native JWTs include `azp: screenstash://renderer`. Express now accepts only the configured `DESKTOP_AUTH_ORIGINS` alongside `WEB_ORIGIN`; the default desktop list is empty. Production rejects the development HTTP origin. Signature, expiry and party verification remain enabled.
- Fixed a packaged startup failure: Forge's Vite plugin includes only `.vite` artifacts, so leaving Clerk/storage/Squirrel as external imports omitted their runtime modules. Main now bundles these dependencies, externalizing Electron and the unused optional passkeys module. The smoke test loads the actual ASAR main entry and verifies offline startup through the custom protocol.
- Packaged development acceptance has verified real Clerk ticket sign-in, the API owner/device binding, encrypted persistence and restored identity after restart, sign-out invalidation, rejection of an untrusted IPC frame, and a 1920 × 1080 frame at 100% scaling. Isolated acceptance profiles stay in ignored `test-results`; disposable accounts are removed even when another teardown step fails.
- Checks: 29 unit/embedded database tests and 32 real PostgreSQL integration tests pass, including explicit desktop-origin acceptance and rejection of foreign parties, expired tokens and incorrect signatures. Full repository lint/typecheck/build and formatting pass. Packaged acceptance also passed fresh-token retrieval after the original JWT expired while the window stayed hidden, then encrypted restart and sign-out. Its final run took about 1.4 minutes. The offline ASAR bootstrap smoke test passes.
- Windows reports an unsynchronized local clock; measured native token issuance was about five seconds ahead. This caused intermittent `session-token-iat-in-the-future` rejection. Synchronize Windows time for reliable development sign-in; no verifier tolerance was increased. The test permits a bounded wait for the original token to become valid.

Remaining phase-1/release evidence: interactive prebuilt email-code UI acceptance, account switching, mixed-DPI/multiple-display cases, capture fallback on hardware that returns undersized thumbnails, and production signed installation/authentication. Ticket-based acceptance proves the SDK/session path rather than an email delivery flow. The next implementation phase is the durable repository; do not claim capture/OCR/upload functionality from the display probe.

## Scope and working decisions

Build the Windows x64 capture → local PNG → local English OCR → durable queue → direct R2 upload → verified API finalization flow. Reuse the existing Express API, Zod contracts and HTTP client. Web gallery/search/sharing remain in Next.js. Desktop sharing, annotations, stitched cross-monitor captures, additional OCR languages and automatic application updates remain outside MVP.

| Area             | Proposed implementation                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Keep pinned Electron 44.7.0, Forge 8.0.1, React 19.3.0, Vite 8.3.4, Node 22 and pnpm 10.34.6; change only if a demonstrated integration issue requires it |
| Authentication   | Pin a compatible beta `@clerk/electron`, its documented storage peer and official React UI; no custom credential forms or refresh protocol                |
| Capture          | Display containing the pointer; `Ctrl+Shift+1` full display, `Ctrl+Shift+2` rectangular region on that display; configurable shortcuts                    |
| Persistence      | Versioned per-capture JSON manifests and PNGs under Electron `userData`; one main-process writer and one application instance                             |
| OCR              | One reusable local Tesseract.js worker, English resources bundled; failure produces empty OCR text and an uploadable image                                |
| Uploads          | One upload at a time; immutable capture payloads, server session reconciliation, direct presigned PUT, retry-safe finalization                            |
| Offline behavior | Capture/OCR/queue UI boot independently of Clerk; uploads require a fresh verified session for the capture's original owner                               |
| Defaults         | Automatic uploads enabled after sign-in; launch at startup disabled until selected; originals retained locally after sync                                 |

Existing API limits apply: 20 MiB PNG, 40 million pixels, 16,384 pixels per side and 200,000 OCR characters. Preserve fidelity; do not silently resize. Where safe local saving succeeds but an image exceeds upload limits, show a local-only size error and retain the original. Define capture allocation limits before requesting unusually large frames.

Local PNGs/OCR manifests are private application data on the Windows user's disk, but are not encrypted by this proposed MVP. Clerk credentials use SDK-managed encrypted persistence. Never store tokens or presigned URLs in queue files, settings or diagnostics.

## Inspected baseline and prerequisites

- `src/main/index.ts` creates a single 960 × 680 window, blocks navigation/popups, and quits when all windows close. It has no application-instance lock or background lifecycle yet.
- Main/preload compile to explicit CJS files. Renderer isolation, disabled Node integration and sandboxing already exist. The smoke script loads a placeholder renderer from ASAR using `file://`; it must change when the packaged protocol/auth bootstrap changes.
- Forge already packages Windows x64 and makes unsigned Squirrel/ZIP artifacts. This proves artifact generation, not installation, startup behavior or production signing.
- Desktop `.env.example` has API origin and Clerk publishable key only. Add validated web origin and Clerk Frontend API hostname configuration; keep secrets server-side. Pin the Vite dev-server origin rather than allowing its port to drift.
- Express currently supplies only `WEB_ORIGIN` to Clerk `authorizedParties`. Observe actual desktop session-token claims first, then add an explicit validated desktop-origin configuration and tests. Do not relax signature/issuer/origin checks globally.
- The shared HTTP client currently drops the `Retry-After` header. Add a bounded, parsed retry-delay field to `ApiError` before implementing queue scheduling, preserving existing web behavior.

Before each phase, inspect its affected contracts/dependencies, verify the previous gate, implement, and run focused checks. Hardware/provider gates that cannot be exercised must stay explicitly pending. Do not substitute permissive auth, fake capture frames or network OCR for the required integrations.

## Phase 1 — Packaged authentication and capture risk checks

Deliver a minimal trusted app bootstrap, Clerk integration, and a capture probe before investing in the rest of the UI.

1. Establish main-owned single-instance/bootstrap handling, separate trusted-window roles, typed sender-validated IPC and a validated configuration module. Initialize the official Clerk bridge and preload adapter at the required lifecycle points; verify the pinned SDK's lock ownership options rather than acquiring competing locks.
2. Serve packaged local assets through `screenstash://renderer` with canonicalized, containment-checked paths. Reject unexpected hosts, traversal, subframes and external navigation; include equivalent guards in development. Region/capture windows receive no Clerk bridge or token broker.
3. Integrate Clerk's sign-in/sign-up/account UI and encrypted storage. Use email verification codes initially. Configure Native API and the exact development/packaged origins for the existing development instance, preserving its other allowlisted origins. Production configuration remains a separate release step. See [Clerk Electron quickstart](https://clerk.com/docs/electron/getting-started/quickstart).
4. Give main an ephemeral, correlated token-request broker tied to the trusted main-frame renderer and an account-generation counter. Verify `/api/me` before establishing an owner/device binding. Tokens stay in memory and are invalidated on sign-out, account changes, renderer loss or broker timeout.
5. Add only the Express origin/claim policy needed by observed native tokens, retaining web verification and negative-token tests. Record missing-versus-present `azp` behavior through the official verifier; do not fabricate claims or turn off authorized-party checking.
6. Match `desktopCapturer` sources by `display_id`, request physical dimensions and compare actual image dimensions. Probe the fallback internal display-media frame path if thumbnails cannot preserve resolution. Electron explicitly does not guarantee requested thumbnail size. See [DesktopCapturerSource](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source).

Gate: packaged development app signs in with real Clerk, restarts with encrypted session persistence, verifies the correct API owner, rejects invalid IPC/origins, and can obtain a correctly sized frame on available Windows displays. Record DPI/monitor cases still unavailable. A failed Clerk beta or capture fidelity check is a decision point to resolve before later integration.

The custom renderer scheme and production CSP should follow [Clerk's Electron deployment guide](https://clerk.com/docs/guides/development/deployment/electron). Production permits the required configured Clerk hosts, with no development eval/localhost allowances; keep local capture UI usable if remote Clerk scripts cannot load. Retain sandboxing and narrow preload APIs throughout.

## Phase 2 — Durable local repository and ownership

Create the queue repository and its crash behavior before making capture results depend on it.

- Persist an installation UUID, versioned settings and owner binding separately from credentials. Register the installation through `/api/devices` per verified owner; a device ID is not an account identity.
- Store `captures/<capture-id>.png` and `queue/<capture-id>.json`. Main generates IDs/paths; renderer requests never accept arbitrary filesystem locations.
- Manifest fields: schema version, capture ID/time, relative PNG name, dimensions/size/checksum, owner IDs or explicit unassigned state, device ID, title, OCR outcome/text/truncation, processing stage, frozen upload payload, session/screenshot IDs, attempts/retry time and sanitized error code.
- Serialize writes; write/flush/close temporary files and rename within the same directory. Keep a recoverable manifest backup. Define which file wins at every crash boundary; recover interrupted temporary files and report quarantined corrupt records without deleting their PNGs.
- Assign capture ownership at capture start. Offline captures may retain a previously verified owner binding; signed-out captures are unassigned. Explicitly confirm assignment of unassigned captures. An account switch never silently reassigns owned records.
- On restart, validate schemas, path containment and file hashes as needed. Recover orphan PNGs as unassigned if original ownership cannot be recovered. Never infer an orphan's owner from whoever is currently signed in.
- Enforce user-visible disk usage and handle full disk, permissions, missing files and unsupported schema versions. Report “Saved locally” only after image and manifest persistence succeeds.

Gate: deterministic repository tests cover interrupted image/manifest writes, backup recovery, corrupted/traversal payloads, missing images, disk-write failures, second-instance exclusion and A → B account isolation. Killing and restarting the packaged app preserves a synthetic capture. No upload runs yet.

## Phase 3 — Capture, region overlay and shortcuts

- Implement single-flight full-display capture, hiding ScreenStash windows and waiting for the capture frame so application UI does not enter the screenshot. Always restore the previous visible/hidden state on failure or cancellation.
- Freeze the target display frame before opening the region overlay. Show it in a frameless window over that display; support drag in either direction, Escape cancellation, minimum nonempty selection and clear keyboard help.
- Overlay submits only capture ID and bounded display-relative rectangle. Main checks sender/frame/role, maps DIP coordinates using actual frame dimensions, clamps edges and crops the frozen source. Never let overlay supply a file path, display source ID or arbitrary bytes.
- Register default shortcuts after readiness and surface conflicts. Apply replacement shortcuts without losing a working binding on failure. Release registrations on quit; reject overlapping/reentrant captures.
- Preserve correct behavior when a monitor is removed, resolution/DPI changes, Windows locks or a capture source is unavailable. Cancel a region session if its display changes rather than using stale coordinates.

Gate: packaged manual capture matrix covers full display and all crop corners, reversed drag, cancellation, small regions, hidden app UI, negative-origin secondary monitor, rotated display and 100/125/150/200% DPI where available. Compare PNG pixels/dimensions with known visual fixtures. Synthetic coordinate tests complement real screen tests; they do not replace them. Captures persist across restart while offline.

## Phase 4 — Local OCR and packaged resources

- Pin compatible Tesseract.js/core versions, bundle English trained data and worker/WASM resources with licenses/checksums, and resolve development versus packaged resource paths explicitly. Use unpacked extra resources where required; caches are writable under userData, not the installation directory.
- Run one recognition task at a time outside renderer/main event handling, reusing the worker. Bound execution (proposed 60-second per-image deadline), terminate/recreate on hangs/crashes and keep capture/tray responsive.
- Normalize recognized text while preserving useful punctuation/newlines; remove inappropriate control characters, truncate at the shared limit and record truncation. Keep OCR text out of logs and telemetry.
- OCR success or failure advances the capture to ready. Failure uses `ocrStatus: failed` and empty text; it must not block image upload. Freeze OCR/title/time/checksum metadata before first upload authorization; retries must reuse the exact payload.

Gate: installed build recognizes known English fixtures on a clean first launch without internet, including worker/language initialization with an empty cache. Verify timeout/crash recovery, useful search words, truncation, failed-OCR upload eligibility and bounded memory at supported image limits. Resource/configuration guidance: [Tesseract local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) and [worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).

## Phase 5 — Owner-bound upload and offline recovery

Implement the coordinator in main using the existing typed API client and one active upload.

```text
saved → ocr_pending → ready → authorizing → uploading → finalizing → synced
                                    ↘ retry_wait / auth_required / paused / failed
```

OCR outcome and the last recoverable upload stage are separate persisted fields. Never show synced until server finalization is confirmed and the server screenshot ID is stored durably.

1. Obtain a fresh token and verify that `/api/me` matches the capture owner. Register the account-scoped device if necessary. Recheck account generation at every network boundary; cancel requests on sign-out/switch and never finalize A's capture using B's token.
2. Authorize with immutable capture metadata; persist session/reserved screenshot IDs before PUT. Keep returned URL/headers in memory. Send only the authorized headers and PNG to R2, with byte/progress accounting, bounded timeout and cancellation; never send Clerk credentials to R2.
3. Finalize through Express and persist synced status. If a response is lost, reconcile the existing session: finalized means confirm its screenshot; pending can resume finalization or obtain renewed PUT authorization; expired authorization renews the same session/capture. Rejected images remain terminal. A deleted capture never gets a fresh identity to evade the server tombstone.
4. Use jittered exponential retry from roughly two seconds to five minutes, honoring parsed `Retry-After`. Retry network errors, retryable conflicts, 429 and transient 5xx. Refresh the Clerk token once on 401, then pause for auth. Treat deleted owner/capture, invalid payload/image and quota/policy blocks distinctly; preserve local bytes and avoid tight retry loops.
5. Reconcile interrupted stages after restart, including finalization committed just before app death. Do not use network-status indicators as proof of connectivity; scheduled requests establish availability. Manual “Upload now” processes explicitly selected eligible records when automatic uploads are off.
6. Turning automatic upload off stops scheduling new work; explicit pause/sign-out aborts active work where possible. A request already accepted by the server may complete: reconcile it later under its original owner. Account switching clears private UI/token state while leaving the original queue binding intact.

Gate: real development Clerk + local PostgreSQL + private R2 proves capture/OCR/upload/gallery/search end to end, checksum equality, maximum-size transfer, offline/reconnect, tray renewal after token expiry, sleep/resume, forced restart during every stage, expired PUT renewal, lost finalize responses and deleted-server-capture handling. Switch A → B during PUT/finalization and confirm no cross-account upload or duplicate record. Repeat against a separately authorized deployed API before release.

## Phase 6 — Tray, queue UI and Windows settings

- Replace the placeholder screen with capture controls, account UI, recent local captures/queue, per-item progress/retry/error state, disk use and settings. Show another owner's pending work only as a generic paused count; do not display their thumbnails/OCR in the new account's view.
- Add tray actions for display/region capture, show queue, open web vault, settings, pause/resume and explicit quit. Window close hides the auth host rather than destroying it. Bound broker waits and recreate a crashed auth renderer before network work resumes; local capture stays available.
- Expose narrow actions/events: capture, queue snapshots, retry, confirmed unassigned assignment, settings changes, verified external vault link and explicit synced-copy cleanup. Validate both requests and responses. Events carry status/progress, never credentials or unrestricted paths.
- Implement configurable shortcuts, automatic-upload toggle and Windows login-item behavior for the Squirrel-installed app. Startup opt-in persists; background launch stays in the tray. Update startup arguments/installed executable paths correctly across reinstall/upgrade; avoid renderer registry access.
- Keep originals after sync. “Clear synced local copies” previews its eligible set and requires product confirmation, excluding pending/unassigned/failed files. Serialize cleanup with queue writes; explain that clearing local copies leaves cloud screenshots intact.

Gate: keyboard/focus/error/loading checks pass; tray capture works with the main window hidden; sign-out stops network work; second launch focuses the existing instance; startup works for the installed app; explicit quit releases shortcuts/workers and flushes writes. Local cleanup cannot delete an unsynced capture. Security checks include forbidden IPC senders, escaped titles/OCR, blocked navigation/popups/permissions and [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

## Phase 7 — Installation and release acceptance

- Update desktop smoke tests to bootstrap the real packaged scheme/preload and assert offline UI, isolation and validated IPC rather than placeholder copy. Add Electron integration tests where reliable; keep privileged capture and installed startup cases in an explicit manual matrix.
- Build the Windows package, Squirrel installer and ZIP with the pinned Forge/Vite toolchain. Inspect artifacts for missing OCR resources, accidental secrets and write attempts inside ASAR/install paths. Test an installed standard-user Windows build, not just the unpacked development app. [Forge Vite plugin](https://www.electronforge.io/config/plugins/vite).
- Prove fresh offline capture/OCR, sign-in/restart/tray session persistence, install/uninstall/reinstall, preserved local data and login-item settings. Keep development SDK keys/origins separate from production artifacts.
- Complete a capture → upload → gallery → OCR-search demo using the real deployed API, with offline/reconnect and account-switch cases. Record available/unavailable DPI hardware tests and processing/resource measurements.
- Prepare signing configuration, third-party notices, installer checksums and a release checklist. Unsigned builds are development artifacts; signing/distribution and publishing GitHub Releases are separate release actions. Do not claim SmartScreen reputation or automatic updates from a generated installer.

Gate: lint, type checks, focused repository/state-machine/auth/capture/OCR tests, server regressions, production web build, desktop package/make and updated packaged smoke pass. Installed hardware/auth/OCR acceptance and deployed integration must have recorded evidence before production distribution.

## Proposed file organization

```text
apps/desktop/src/
  main/
    index.ts                 # bootstrap, lock and shutdown
    windows/                 # main, region and internal capture hosts
    auth/                    # Clerk bridge, ephemeral broker, owner/device binding
    capture/                 # display frames, crop mapping and shortcuts
    repository/              # manifests, files, recovery and settings
    ocr/                     # worker lifecycle and local resource paths
    sync/                    # coordinator, reconciliation, retry and transport
    tray/                    # menus, notifications and lifecycle
    ipc/                     # validated handlers and sender/role guards
  preload/                   # separate app, region and capture bridges
  renderer/                  # local shell, account, queue, settings and overlay
  contracts/                 # desktop IPC/settings/manifest schemas
apps/desktop/resources/      # tray assets, notices and pinned OCR resources
tests/desktop/               # repository, state-machine and Electron checks
docs/desktop-verification.md # results and hardware/installation matrix
```

Desktop persistence/IPC schemas stay in the desktop package. Add shared types only for actual API contracts, including any backward-compatible retry-delay support. Express origin verification is the expected small server change; no database migration or new upload protocol is planned.

## Inputs and approval checkpoint

Existing development API/Clerk/R2 credentials support most integration work. Phase 1 still needs verified Clerk Native API/allowed origins and the desktop Frontend API hostname; inspect presence without printing secrets, and ask for missing configuration only when needed. Preserve the web instance's existing settings. Mixed-DPI/multiple-monitor hardware, a standard-user installation test and a clean offline environment are manual acceptance inputs. Production API/web deployment, actual account-deletion delivery and signing credentials remain independent release gates.

Proposed order: authentication/capture risk checks → durable repository → capture → OCR → upload recovery → tray/settings → installed acceptance. Review this sequence and its product defaults before implementation. After approval, progress phase by phase without repeated planning confirmations; report a failed prerequisite or unavailable external gate precisely. This planning request does not authorize feature changes, destructive existing-backlog cleanup, deployment or release publication.

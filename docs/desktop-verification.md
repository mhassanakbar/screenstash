# Desktop OCR and sync verification

Verification date: October 27, 2026. This increment implements local English OCR,
owner-bound synchronization, and tray/queue/settings controls. It is not a
production release sign-off and does not claim that a capture reached the real
deployed web vault.

## Reproducible setup

- Node: **22.23.2** (repository pin); pnpm: **10.34.6** (packageManager pin).
- Run `corepack enable`, then `corepack pnpm install --frozen-lockfile`.
  Noninteractive dependency replacement may require `$env:CI = 'true'`.
- Desktop build/dev/make first run `scripts/prepare-desktop-ocr.mjs`. It copies
  lockfile-pinned worker, WASM, English model, and required support files into
  ignored `apps/desktop/resources/ocr`, verifies fixed core/model hashes, and
  includes resource manifests/notices. No runtime language download is required.
- The tool host can inject `ELECTRON_RUN_AS_NODE=1`. Remove it in the validation
  process before launching Electron:

  ```powershell
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  corepack pnpm smoke:desktop
  corepack pnpm test:capture
  ```

  This only corrects the launch environment; it does not bypass Windows security
  policy. Do not disable Device Guard to run an unsigned development artifact.

## Automated evidence

The final automated suite passed **92 tests in 14 files**.

| Check                                   | Evidence / limitation                                                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm check`                   | Lint, package/test typechecks, web production build, and desktop packaging pass.                                                                                                                                                        |
| `corepack pnpm test`                    | Unit and embedded-database suite pass; includes real bundled OCR and upload-to-search coverage.                                                                                                                                         |
| Focused Prettier and `git diff --check` | Check changed source, tests, and documentation only. Repository-wide `format:check` also reports existing formatting in unrelated files; no mass reformat was applied.                                                                  |
| `corepack pnpm desktop:make`            | Squirrel Setup/full nupkg/RELEASES and Windows ZIP generated. These are unsigned development artifacts, not a verified installed release.                                                                                               |
| `corepack pnpm smoke:desktop`           | Passed during this increment after removing the injected Electron environment flag.                                                                                                                                                     |
| Packaged OCR acceptance                 | Passed once against a fresh isolated profile: recover orphan PNG, recognize English, persist OCR/settings, hide on close while bridge remains live, restart with retained state.                                                        |
| Latest `corepack pnpm test:capture`     | All three tests fail before application startup: Windows reports the rebuilt ScreenStash.exe was blocked by the organization's Device Guard policy, exit code 4551. Latest package/UI acceptance is therefore **blocked**, not passing. |
| Native PostgreSQL integration           | Not run successfully: neither `TEST_DATABASE_URL` nor a local `DIRECT_DATABASE_URL` was configured. PGlite coverage is not a substitute for this gate.                                                                                  |

The offline OCR test relocates the complete generated resource bundle to a fresh
directory, denies HTTP/HTTPS/network access, avoids a writable language cache,
and runs the real recognizer. Lifecycle tests cover initialization/recognition
timeouts, crash recycling, bounded worker reuse, stop, normalization and text
truncation. Queue tests cover durable completion, failure with empty text,
interrupted recognition, and exclusion of locked upload metadata.

`tests/database/desktop-sync.test.ts` runs an English PNG through the real OCR
queue, sync coordinator, API UploadService, and PostgreSQL full-text search in
PGlite. It verifies the original PNG bytes/hash and owner-isolated recognized-text
search. Authentication transport and object storage are fixtures; this test does
not authenticate with Clerk, PUT to R2, or exercise the deployed web UI.

Sync tests cover create/PUT/finalize, lost responses and restart reconciliation,
credential-free original-byte PUT, identity switches and cancellation, retries,
server-directed Retry-After, explicit upload with automatic upload disabled,
recoverable failed/delayed uploads, and terminal deletion safeguards. The
generated exponential backoff caps at five minutes; longer server Retry-After
hints remain visible and explicit Retry/Upload now may override the wait.

Controls tests cover strict IPC schemas, invalidation-only events, persisted
settings, startup rejection/rollback, installed Squirrel updater registration,
restoration of unsupported startup preferences, and tray callbacks. Renderer
crashes invalidate the active identity immediately and trigger reloads with
bounded backoff rather than abandoning authentication after the first crash.

## Data and account safeguards

- Active identity starts unverified after launch; persisted owner metadata is
  never treated as authentication. Each upload API boundary rechecks the exact
  bearer token against the capture's owner.
- Captures made while signed out remain unassigned/local. No automatic assignment
  operation is exposed. Switching accounts does not adopt another owner's queue.
- OCR text is persisted locally but omitted from queue summaries and logs.
  Upload metadata is frozen before authorization and cannot be rewritten by OCR.
- Closing the window hides it; Quit stops processing and flushes repository writes.
  Pause applies to processing; auto-upload and startup are separately persisted.
- Originals are retained. Local cleanup and owner-confirmed reassignment remain
  explicitly deferred: there is no destructive bridge or cleanup UI.

## Outstanding release acceptance

- [ ] Run the latest packaged capture/OCR/tray suite on a policy-approved machine
      or approved signed artifact; do not work around organizational execution policy.
- [ ] Install as a standard Windows user; verify first launch completely offline,
      OCR resource loading, tray operation, opt-in startup with `--background`,
      install/uninstall/reinstall, and retained local data/preferences.
- [ ] Verify mixed-DPI/multiple-monitor capture and region coordinates on physical
      hardware; record OCR time/memory measurements on representative screenshots.
- [ ] Run native PostgreSQL integration with the required test database URL.
- [ ] Verify production Clerk configuration, real owner-bound R2 upload/finalize,
      reconnect/restart/account-switch cancellation, and a captured screenshot visible
      in the deployed private vault and searchable by its recognized text.
- [ ] Verify deployed streaming, revoked sharing, account-deletion webhooks,
      and backup restoration with recorded evidence.
- [ ] Review signing, installer checksums, third-party notices and distribution.
      A generated installer establishes neither SmartScreen reputation nor updates.

No production deployment, release publication, destructive backlog cleanup,
installation, or startup registration on this machine was performed by this
validation run.

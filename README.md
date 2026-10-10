# ScreenStash

Windows screenshot vault with a Next.js website, Express API, and Electron desktop foundation. Server/web features are implemented and locally verified; deployment and desktop features remain pending.

## Workspace

| Package               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `apps/web`            | Next.js App Router, deployed to Vercel             |
| `apps/api`            | Express, deployed separately as a Vercel Function  |
| `apps/desktop`        | Electron Forge + React + Vite, Windows desktop app |
| `packages/shared`     | Zod contracts and shared public types              |
| `packages/api-client` | Typed HTTP client; session-token provider boundary |
| `packages/db`         | Drizzle + PostgreSQL adapter and migration tooling |

The API includes configuration validation, Clerk ownership/device registration, signed deletion webhook handling, verified R2 uploads, private media, gallery/deletion, search/tags, and public sharing. The web app includes Clerk UI, gallery/detail/download/delete, search/edit/filter controls, and revocable sharing with server-rendered OG/Twitter metadata. See the [implementation checkpoint](screenstash-implementation.md#implementation-checkpoint--10-october-2026) and [operations runbook](docs/operations-runbook.md) for verified behavior and remaining release gates.

## Requirements

- Node.js **22.23.2** (`.node-version`); supported scaffold range: Node 22.13 or newer within Node 22.
- pnpm **10.34.6**, pinned in `package.json`.
- Windows x64 for the desktop packaging and installer checks.

If an existing pnpm launcher fails, use `npx --yes pnpm@10.34.6 <command>` in place of `pnpm <command>`. No global package-manager changes are required.

## Install and verify

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm smoke
pnpm smoke:desktop
pnpm test
pnpm test:integration
pnpm format:check
```

Turbo builds workspace dependencies before their consumers. The desktop build produces a packaged Windows application in `apps/desktop/out/`; it does not launch a window. The desktop smoke check loads the actual ASAR main entry and checks the local protocol, sandboxed preload and offline renderer in a hidden Electron window.

The HTTP smoke check starts the compiled API on port 4000 and production Next.js on port 3000, verifies rewrites/response contracts, and stops both servers. Those ports must be free, and the web build must use the default local API origin.

## Development

```powershell
pnpm dev
```

This starts API, Next.js, and Electron together. To run a single app, use `pnpm --filter @screenstash/web dev`, `pnpm --filter @screenstash/api dev`, or `pnpm --filter @screenstash/desktop dev`. First run `pnpm build` so shared package exports exist.

The API listens on `http://127.0.0.1:4000`. Next.js listens on `http://localhost:3000` and proxies API and authorized media paths to Express. The remaining routes belong to Next.js.

## Environment and services

Health and infrastructure tests require no provider credentials. The authenticated website requires Clerk keys. Copy app-specific `.env.example` files when configuring integrations. Never commit secrets.

Next.js loads `apps/web/.env` and `.env.local`. The local Express server and migration tooling load `apps/api/.env` without overriding process variables. Vercel supplies process variables directly. Public `VITE_*` and `NEXT_PUBLIC_*` values must contain no secrets.

Database migration commands require `DIRECT_DATABASE_URL`; use `pnpm db:migrate` on the development database. `DATABASE_URL` is the pooled runtime connection. Never point integration tests at the application database.

`pnpm test:integration` uses a separate disposable `TEST_DATABASE_URL` when supplied. Otherwise it creates and drops an isolated database on a local `DIRECT_DATABASE_URL` instance; the local role needs `CREATEDB`. Automatic creation is refused for remote hosts. `pnpm test` also exercises the migration constraints in embedded PostgreSQL.

Browser verification requires development Clerk keys in the API/web environment files and Chromium (`pnpm exec playwright install chromium`). After building API and web, run `pnpm test:e2e`. It creates disposable Clerk test accounts, checks sign-in, owner isolation and sign-out, then deletes those accounts. Keep `WEB_ORIGIN`, the browser origin, and Clerk redirect configuration aligned at `http://localhost:3000`. Production keys are refused by the browser harness.

Configure the Clerk webhook endpoint at `/api/webhooks/clerk` for `user.deleted`, with `CLERK_WEBHOOK_SIGNING_SECRET`. Until configured, the endpoint returns 503. Signed fixtures validate processing locally; real provider delivery requires a reachable deployment.

## Deployment foundations

Create two Vercel projects rooted at `apps/web` and `apps/api`, with access to shared monorepo files. Their `vercel.json` build commands use filtered Turbo builds so each app's shared dependencies are built from a clean checkout. Next.js uses its standard framework preset; Express's `src/index.ts` default-exports the app for Vercel detection. The API build emits local runtime artifacts; `src/server.ts` is only the local listener.

Set the web project's `EXPRESS_API_ORIGIN` to the API project's origin before building. API/media rewrites are explicit; the share-page route stays in Next.js. Keep public sharing routes accessible to social crawlers. The API configuration includes a 120-second function duration and daily maintenance cron. Provider execution, streaming/caching, signed webhook delivery, backups and real social previews still need deployed verification. No deployment has been made.

Use `pnpm configure:maintenance` for a missing local secret, `pnpm ops:status` for aggregate backlog/configuration diagnostics, and `pnpm fixture:upload <png> [ocr-text-file]` with a fresh process-local `SCREENSTASH_SESSION_TOKEN` for synthetic uploads. See the runbook for secret handling and limits. A manual GitHub development-browser workflow is included; configure its development environment secrets before dispatch.

## Desktop distribution

The approved [desktop implementation plan](docs/desktop-implementation-plan.md) covers Clerk integration, native capture, local OCR, durable upload recovery, tray/settings and installed Windows acceptance. Desktop now saves full-display and region PNGs locally, with durable manifests, recovery, account isolation, a local screenshot list and folder access. OCR, cloud uploads, tray and configurable settings remain pending.

With the app running, use **Ctrl + Shift + 1** for the display containing your pointer or **Ctrl + Shift + 2** to select a region on that display. Drag in either direction and release to capture; Escape cancels. UI buttons perform the same operations. The app hides before capture and restores its previous visibility. PNGs are stored under Electron's `userData/captures`, with metadata under `userData/queue`; “Show in folder” locates an original. Signed-out captures remain unassigned and offline captures preserve a previously verified owner. No cloud upload occurs yet. Local storage is capped at 1 GiB, and an unavailable shortcut is reported in the UI. `pnpm test:capture` verifies native pixels, selection/cancellation and offline restart against a temporary local test pattern on the current interactive Windows display.

On Windows, select **Set up Print Screen**, then **Open Windows keyboard settings**. Turn off “Use the Print Screen button to open screen snipping”, return to ScreenStash and select **Enable Print Screen shortcuts**. **Print Screen** selects a region; **Shift + Print Screen** captures the display. The opt-in persists across restart, and the Ctrl + Shift shortcuts remain available. If another app owns a key, the UI reports it and provides a retry button. Disabling ScreenStash's Print Screen shortcuts releases its registrations; it does not change the Windows toggle. The settings link is a fixed, main-process-only `ms-settings:easeofaccess-keyboard` URI; ScreenStash does not modify the registry.

Desktop authentication requires Native API enabled in the existing Clerk instance, matching publishable keys, and the Frontend API hostname in `apps/desktop/.env`. Configure the API's `DESKTOP_AUTH_ORIGINS=screenstash://renderer,http://localhost:5173` for development; production accepts only `screenstash://renderer`. The Clerk origin allowlist must include these alongside the web origin. `node scripts/configure-desktop-development.mjs` preserves existing development origins and sets the local Frontend API hostname without printing credentials. `pnpm test:desktop` runs against the packaged Windows executable with disposable development accounts and isolated profiles; it verifies session renewal, encrypted restart, sign-out, IPC rejection and the attached display's dimensions. Keep Windows time synchronized for JWT validation.

`pnpm desktop:make` produces a Windows Squirrel installer and ZIP. Artifacts are unsigned development builds. Code signing, the Clerk production renderer scheme, packaged OCR resources, and release publishing will be implemented in their planned stages.

Forge's Vite integration is experimental; its version is pinned. Hoisted pnpm dependencies are configured for Electron Forge packaging compatibility. Shared packages are bundled into Electron and browser code; PostgreSQL tooling stays server-side.

See [the specification](screenstash-spec.md) and [the implementation plan](screenstash-implementation.md) for feature scope and architecture.

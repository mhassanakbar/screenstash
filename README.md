# ScreenStash

Windows screenshot vault with a Next.js website, Express API, and Electron desktop foundation. Server and web implementation is in progress.

## Workspace

| Package               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `apps/web`            | Next.js App Router, deployed to Vercel             |
| `apps/api`            | Express, deployed separately as a Vercel Function  |
| `apps/desktop`        | Electron Forge + React + Vite, Windows desktop app |
| `packages/shared`     | Zod contracts and shared public types              |
| `packages/api-client` | Typed HTTP client; session-token provider boundary |
| `packages/db`         | Drizzle + PostgreSQL adapter and migration tooling |

The API includes configuration validation, Clerk ownership/device registration, signed deletion webhooks, verified R2 uploads, private media, gallery/deletion, and search/tag endpoints. The web app includes Clerk UI, gallery/detail/download/delete, and search/edit/filter controls. The latest search controls still need browser acceptance; public sharing and desktop capture remain pending. Work is paused; see the [implementation checkpoint](screenstash-implementation.md#implementation-checkpoint--9-october-2026) to resume.

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

Turbo builds workspace dependencies before their consumers. The desktop build produces a packaged Windows application in `apps/desktop/out/`; it does not launch a window. The desktop smoke check loads the packaged renderer and preload in a hidden Electron window.

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

Set the web project's `EXPRESS_API_ORIGIN` to the API project's origin before building. API/media rewrites are explicit; the share-page route stays in Next.js. Keep future public sharing routes accessible to social crawlers rather than behind deployment protection. No deployment or external services have been provisioned.

## Desktop distribution

`pnpm desktop:make` produces a Windows Squirrel installer and ZIP. Artifacts are unsigned development builds. Code signing, the Clerk production renderer scheme, packaged OCR resources, and release publishing will be implemented in their planned stages.

Forge's Vite integration is experimental; its version is pinned. Hoisted pnpm dependencies are configured for Electron Forge packaging compatibility. Shared packages are bundled into Electron and browser code; PostgreSQL tooling stays server-side.

See [the specification](screenstash-spec.md) and [the implementation plan](screenstash-implementation.md) for feature scope and architecture.

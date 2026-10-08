# ScreenStash

Project foundation for a Windows screenshot vault. Feature implementation has not started.

## Workspace

| Package               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `apps/web`            | Next.js App Router, deployed to Vercel             |
| `apps/api`            | Express, deployed separately as a Vercel Function  |
| `apps/desktop`        | Electron Forge + React + Vite, Windows desktop app |
| `packages/shared`     | Zod contracts and shared public types              |
| `packages/api-client` | Typed HTTP client; session-token provider boundary |
| `packages/db`         | Drizzle + PostgreSQL adapter and migration tooling |

The current screens are placeholders. The API provides only `GET /api/health` and JSON 404 responses. No accounts, screenshot capture, uploads, database tables, or sharing features are implemented.

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

The placeholder builds require no Clerk, PostgreSQL, or R2 credentials. Copy app-specific `.env.example` files only when configuring those integrations. Never commit secrets.

Next.js loads `apps/web/.env.local`. Express, desktop main, and migration tooling currently receive configuration through the process environment; they do not automatically load example files. Public `VITE_*` and `NEXT_PUBLIC_*` values must contain no secrets.

Database migration commands require `DIRECT_DATABASE_URL`. The schema is intentionally empty until the build gate passes; do not run migrations against production. `DATABASE_URL` is reserved for the pooled runtime connection.

## Deployment foundations

Create two Vercel projects rooted at `apps/web` and `apps/api`, with access to shared monorepo files. Their `vercel.json` build commands use filtered Turbo builds so each app's shared dependencies are built from a clean checkout. Next.js uses its standard framework preset; Express's `src/index.ts` default-exports the app for Vercel detection. The API build emits local runtime artifacts; `src/server.ts` is only the local listener.

Set the web project's `EXPRESS_API_ORIGIN` to the API project's origin before building. API/media rewrites are explicit; the share-page route stays in Next.js. Keep future public sharing routes accessible to social crawlers rather than behind deployment protection. No deployment or external services have been provisioned.

## Desktop distribution

`pnpm desktop:make` produces a Windows Squirrel installer and ZIP. Artifacts are unsigned development builds. Code signing, the Clerk production renderer scheme, packaged OCR resources, and release publishing will be implemented in their planned stages.

Forge's Vite integration is experimental; its version is pinned. Hoisted pnpm dependencies are configured for Electron Forge packaging compatibility. Shared packages are bundled into Electron and browser code; PostgreSQL tooling stays server-side.

See [the specification](screenstash-spec.md) and [the implementation plan](screenstash-implementation.md) for feature scope and architecture.

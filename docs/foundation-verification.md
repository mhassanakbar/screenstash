# Foundation verification

Verified locally on Windows x64 on 8 October 2026 with Node.js 22.23.2 and pnpm 10.34.6.

## Scope

The six workspace packages are scaffolded. The applications contain placeholder screens and an API health endpoint. No authentication, capture, screenshot storage, gallery, search, or sharing feature has been implemented.

## Checks

| Check                                                    | Result |
| -------------------------------------------------------- | ------ |
| Frozen-lockfile installation                             | Passed |
| ESLint, including root verification scripts              | Passed |
| Strict TypeScript checks across all six packages         | Passed |
| Shared contracts/client/database builds and declarations | Passed |
| Express production build                                 | Passed |
| Next.js optimized production build                       | Passed |
| Electron main, preload, and React renderer builds        | Passed |
| Windows x64 application packaging                        | Passed |
| Production HTTP smoke checks                             | Passed |
| Packaged Electron renderer/preload smoke check           | Passed |
| Unsigned Squirrel installer and ZIP generation           | Passed |

The HTTP smoke check validates the compiled API, production Next.js page, API/media rewrites, shared response validation, JSON 404 handling, HEAD behavior, and no-store headers. It starts and stops its own local servers.

The Electron smoke check opens a hidden window using the renderer and preload from the packaged ASAR. It confirms renderer content, the restricted preload bridge, and disabled renderer Node integration. This does not prove Windows capture behavior or exercise an installer installation.

Next.js type checking is ordered after its production build so generated route declarations cannot race a build. Forge main and preload output filenames are explicit and distinct. Generated Next.js declaration files are excluded from formatting.

## Artifacts and remaining verification

The packaged application is under `apps/desktop/out/ScreenStash-win32-x64`. Installer and ZIP artifacts are under `apps/desktop/out/make`; all build artifacts are ignored by Git.

Vercel deployment, live Clerk authentication, PostgreSQL connectivity/migrations, R2 uploads/streaming, native capture/OCR, signing, and clean-machine installation remain feature or release-stage checks. They require implementation and configured services; this foundation does not claim to verify them. No hosted services were provisioned or production data changed.

Run the commands in the root README to repeat these checks. Windows CI runs the lint, typecheck, build, formatting, and smoke gates.

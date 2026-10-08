# ScreenStash — Screenshot Vault Project Specification

ScreenStash is the selected project name. It reflects a personal library for saving, organizing, and sharing screenshots.

## ScreenStash — Project specification

Version 0.5 · MVP · Target: 4 weekends · Includes public sharing · Next.js and Express on Vercel · Clerk authentication

### Overview

ScreenStash is a desktop screenshot capture tool with a cloud-backed library accessible through a web application.

Users capture screenshots through a desktop app, upload them automatically, and later find them using text search, tags, or dates. Collections are excluded from MVP.

Core differentiator: Screenshots are searchable by the text visible inside them, without requiring manual tagging.

Users can explicitly publish individual screenshots through share links that open without signing in and support image previews when pasted into Discord or Twitter/X.

### MVP features

| Area            | Requirements                                                         |
| --------------- | -------------------------------------------------------------------- |
| Desktop capture | Full-screen and rectangular region capture using global shortcuts    |
| Uploads         | Automatic upload to R2 through presigned URLs                        |
| Offline support | Local queue with retries after connection loss                       |
| Web gallery     | Responsive grid, full-size preview, download, delete                 |
| Organization    | Rename screenshots, add tags, filter by date                         |
| Search          | Search titles, tags, and OCR-extracted text                          |
| Authentication  | Clerk-managed accounts and sessions; Clerk UI components for web and desktop sign-in |
| Settings        | Configure capture shortcut, automatic uploads, and launch at startup |
| Public sharing  | Create, copy, and revoke a public link for an individual screenshot; Discord and Twitter/X image previews |

### Out of scope for MVP

- Video recording and GIF capture
- Screenshot annotation and editing
- Password-protected links, expiring links, public galleries, and automated posting to social platforms
- Team collaboration
- AI image understanding and semantic search
- Mobile applications
- Cross-platform support beyond Windows

### Architecture

Electron Desktop

Capture · OCR · Upload queue

Next.js Website on Vercel

Gallery · Search · Manage · Account screens · Public share pages and preview metadata

Express API on Vercel Functions (Node.js / Fluid compute)

Clerk session verification · Ownership checks · Screenshot metadata · Search · Upload authorization · Share creation/revocation · Authorized media delivery

PostgreSQL

Users · Screenshots · Tags · OCR text

Cloudflare R2

Original images

### Technology stack

| Component  | Technology                              |
| ---------- | --------------------------------------- |
| Monorepo   | pnpm workspaces + Turborepo             |
| Desktop    | Electron Forge, React, Vite, TypeScript |
| Web        | Next.js App Router, React, TypeScript, TanStack Query |
| Backend    | Express.js, TypeScript                  |
| Authentication | Clerk: `@clerk/nextjs`, `@clerk/express`, `@clerk/electron`; prebuilt auth/account UI |
| Database   | PostgreSQL, Drizzle ORM                 |
| Storage    | Cloudflare R2                           |
| Validation | Zod                                     |
| OCR        | Tesseract.js, executed locally          |
| Styling    | Tailwind CSS, shadcn/ui                 |
| Testing    | Vitest, Playwright                      |

Next.js owns web routing and server-rendered public pages; TanStack Router is unnecessary. Electron keeps React and Vite. Express remains the authorization boundary and the only application with direct PostgreSQL/R2 access. Use Neon as the proposed managed PostgreSQL host.

### Core data model

| Entity            | Important fields                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `users`           | id, clerk_user_id (unique), created_at, deleted_at; application ownership record, no passwords or session credentials |
| `screenshots`     | id, user_id, title, object_key, mime_type, size_bytes, width, height, ocr_text, captured_at, created_at |
| `tags`            | id, user_id, name                                                                                       |
| `screenshot_tags` | screenshot_id, tag_id                                                                                   |
| `upload_sessions` | id, user_id, object_key, status, expires_at                                                             |
| `devices`         | id, user_id, name, last_seen_at                                                                         |
| `screenshot_shares` | id, screenshot_id, user_id, token_hash, public_title, created_at, revoked_at; at most one active share per screenshot |

### Screenshot upload flow

1. User presses the capture shortcut.
2. Electron captures the selected region and saves the image locally.
3. The desktop app performs OCR and adds the screenshot to a persistent upload queue.
4. Electron requests an upload URL from Express.
5. Express verifies the user and generates a short-lived R2 presigned URL.
6. Electron uploads directly to R2.
7. Electron calls the API to finalize the upload. Express verifies the object and saves its metadata.
8. The screenshot appears in the web gallery.

If an upload fails, the local file remains available for retry.

### Security requirements

- R2 bucket remains private.
- Presigned URLs expire quickly and are scoped to specific object keys.
- Every private screenshot API request checks ownership. Public share routes permit read-only access only when the share token is valid and active.
- Screenshot filenames and object keys are generated server-side.
- Clerk manages account credentials, verification, sessions, and enabled recovery flows. ScreenStash stores no passwords and issues no custom authentication or refresh tokens.
- Express verifies Clerk session tokens before private API access, maps the verified Clerk user ID to an internal user record, and enforces ownership independently of client UI state.
- Desktop authentication uses Clerk's Electron SDK and encrypted SDK token storage; Clerk secret keys stay server-side. Local capture/OCR remains available when Clerk cannot load offline.
- Electron uses context isolation and a restricted preload API.
- Screenshots are deleted from R2 when permanently removed from the vault.
- OCR text is treated as private user data.
- Sharing is opt-in per screenshot. Only the shared image and a user-approved public title are exposed; account details, tags, OCR text, and other screenshots remain private.
- Use cryptographically random share tokens with at least 128 bits of entropy; store a hash for validation and avoid logging tokens. Rate-limit share creation and public image requests.
- Revoking a share or deleting its screenshot disables both public HTML and image routes. Platform-cached previews or downloaded copies may remain outside ScreenStash's control.
- Next.js fetches active share details from Express on every public-page request. Do not persistently cache share details, share HTML, or authorized media; unavailable responses must not include screenshot preview metadata.

### Four-weekend implementation plan

Weekend 1 — Foundation

Set up monorepo, PostgreSQL, Clerk UI/session integration, Express token verification, R2 integration, and a basic Next.js gallery. Verify image upload/retrieval, API proxying, and Vercel preview deployment; spike packaged Windows Clerk sign-in and session persistence.

Weekend 2 — Desktop capture

Implement Electron capture, region selection, global shortcuts, and local screenshot saving. Connect desktop authentication and uploads.

Weekend 3 — Search and organization

Add OCR extraction, PostgreSQL full-text search, tags, date filters, and the persistent offline upload queue. Add Express share records, owner-only create/revoke operations, active-share lookup and authorized image routes; implement Next.js public pages and server-generated metadata.

Weekend 4 — Polish and release

Implement settings, error handling, upload recovery, automated tests, Windows installer, deployment, and a README with screenshots and architecture. Validate social preview metadata and test live links on Discord and Twitter/X. Keep advanced sharing options deferred to preserve the four-weekend target.

### MVP acceptance criteria

- User can capture a region with a keyboard shortcut.
- Screenshots upload without opening the website.
- Screenshots captured offline upload after reconnection.
- User can access screenshots from another device through the website.
- Search finds screenshots using visible text extracted by OCR.
- User can organize screenshots with tags.
- One user cannot access another user's private screenshots or manage their share links. Explicitly shared screenshots are readable by anyone with the link.
- Application can be installed and used on Windows without development tools.
- An owner can create and copy a share link from the web gallery, open it while signed out, and revoke it.
- Active share pages return image metadata in the initial HTML without requiring JavaScript, cookies, or sign-in; image URLs return an actual image with the correct content type.
- Live links are tested for screenshot previews in Discord and Twitter/X, with embeddings enabled. Platform-controlled suppression, caching, or rendering differences are documented.
- Revoked, unknown, or deleted shares return an unavailable response for both the page and image; private screenshots have no public image route.
- After a previously visited share is revoked, a new HTTP request to the deployed Next.js page and each Express media endpoint returns 404. Verify production caching and metadata behavior with ordinary browsers and social-crawler user agents.

Selected name: **ScreenStash**. The options above are retained as earlier naming alternatives.

For a portfolio, the most impressive part will be demonstrating the entire capture-to-cloud-to-search workflow, especially offline recovery and OCR search.

## Monorepo structure and package responsibilities

Use pnpm workspaces and Turborepo for the three applications and their shared authentication, API contracts, and data types.

```text
screenstash/
├── apps/
│   ├── desktop/      # Electron + React
│   ├── web/          # Next.js App Router + React
│   └── api/          # Express.js
├── packages/
│   ├── shared/       # Types, Zod schemas, constants
│   ├── db/           # Drizzle schema and migrations
│   └── api-client/   # Typed HTTP client for web and desktop
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

| Package | Responsibilities |
| --- | --- |
| `apps/desktop` | Screenshot capture, system tray, global shortcuts, local upload queue |
| `apps/web` | Next.js gallery, search, account screens, public share pages and preview metadata |
| `apps/api` | Clerk token verification, application-user mapping, screenshot metadata/search, R2 presigned URLs, ownership checks, share creation/revocation, active-share lookup and authorized image delivery |
| `packages/shared` | Zod schemas, request/response types, shared constants |
| `packages/db` | Drizzle ORM schema and database migrations |
| `packages/api-client` | Reusable authenticated API calls for web and desktop |

The shared API client centralizes screenshot uploads and gallery operations with an injected Clerk session-token provider. Clerk SDKs own sign-in, sign-out, account UI, and session renewal; the shared client does not implement a separate authentication system.

### Architectural boundaries

1. **Extract shared UI only when duplication emerges.** The desktop capture interface and web gallery have different responsibilities. A shared UI package is not required initially.
2. **Keep database access server-side.** Only the Express API uses `packages/db`; the website and Electron renderer never connect directly to PostgreSQL.
3. **Share API contracts rather than database models.** Define request and response schemas in Zod. Frontends should not depend on Drizzle's internal database types.
4. **Separate Electron main and renderer processes.** Use a typed, restricted preload bridge with `contextIsolation: true`; do not expose unrestricted Node.js APIs to the React renderer.
5. **Deploy applications independently.** Deploy Next.js and Express as separate Vercel projects from the monorepo. Express runs as a Node.js Vercel Function with Fluid compute. Build and distribute Electron separately through GitHub Releases. Browser API calls use a same-origin proxy; desktop and Next.js server-side fetches connect to Express directly.

### Turborepo decision

pnpm workspaces alone can manage local packages and dependencies. Turborepo adds task orchestration, dependency-aware builds, and caching. It is recommended for the three applications and three shared packages, but can be added later without restructuring the repository.
DECISION: We're using both pnpm workspaces and Turborepo.

### Collections scope clarification

DECISION: Collections are excluded from MVP. Organization uses titles, tags, and dates.

### Web framework and deployment decision

DECISION: Use Next.js App Router on Vercel for the gallery, account screens, and public share pages. Clerk manages authentication; Express on Vercel Functions verifies Clerk sessions and handles authorization, search, uploads, and share/media access. PostgreSQL and private R2 remain the storage layer; screenshot uploads continue directly to R2 using Express-issued presigned URLs. Vercel supports Express as a single Function with Fluid compute. [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)

For personal, noncommercial use, the baseline can be **$0/month** if both Vercel projects, Clerk, Neon, and R2 fit their free allowances. Function processing, database compute, and image delivery consume usage; this is a planning estimate excluding domains, taxes, backups, and paid features. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Neon plans](https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md), [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

For commercial use, budget Vercel Pro's current **$20/month** starting platform fee for one deploying seat, plus usage and any other service charges. The two projects can share the same team; this is not a $20 charge per project. Recheck prices and allowances before deployment. [Vercel Pro](https://vercel.com/docs/plans/pro-plan)

Serverless requirements: keep durable state in PostgreSQL/R2, use pooled database connections and shared rate limits, and replace persistent cleanup loops with leased jobs invoked by protected cron/request handlers. Hobby cron runs at most daily; faster scheduled cleanup requires a suitable paid plan or durable scheduler. Logical deletion/revocation takes effect immediately even when physical object cleanup is pending. [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)

Keep API requests small: Vercel limits request bodies to 4.5 MB. Stream authorized R2 image responses rather than returning buffered images; Vercel documents a streaming response exception to the payload limit. Verify a maximum-size original through the actual Next.js rewrite in the first deployment spike. Bound Sharp processing and finalization to function memory/duration, and retain retry-safe upload sessions. [Payload limits and streaming](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)

Clerk may add $0 while the selected features and usage fit its free plan; include Clerk charges separately if paid features or allowances require an upgrade. [Clerk pricing](https://clerk.com/pricing)

## Authentication decision — Clerk

DECISION: Use one Clerk application per environment for the website and desktop app. Use Clerk UI components for sign-in, sign-up, and account/session management; delegate credential handling and renewal to Clerk.

- **Next.js:** `@clerk/nextjs` with `ClerkProvider`, `SignIn`, `SignUp`, `UserButton`, and account/profile UI. Protect vault routes server-side with Clerk helpers. Keep `/s/*` public and free of mandatory Clerk UI/session loading. [Next.js integration](https://clerk.com/docs/nextjs/getting-started/quickstart)
- **Express:** `@clerk/express` verifies session JWTs; require a verified user on private routes, resolve the internal owner through `clerk_user_id`, and check resource ownership. Public shares retain separate share-token authorization. [Express integration](https://clerk.com/docs/expressjs/getting-started/quickstart)
- **Electron:** `@clerk/electron` supplies Clerk UI through its React entrypoint, a restricted main/preload bridge, and encrypted persistence. Pin its beta version and verify installed Windows sign-in, restart, and tray upload behavior early. [Electron integration](https://clerk.com/docs/electron/getting-started/quickstart)

Proposed MVP sign-in method: email verification codes, supported across web and Electron. Additional Clerk methods can be enabled after testing their desktop behavior. Capture and OCR work offline; uploads wait for a valid Clerk session belonging to the capture's owner. Express receives session tokens, never account passwords.

Provision the application user record on the first verified API request, without waiting for a creation webhook. Verify signed Clerk account-deletion webhooks to disable the local user, revoke shares, and schedule image cleanup; keep a minimal identity tombstone to prevent retries recreating the deleted vault. Session expiry/revocation follows Clerk's token/session semantics rather than ScreenStash's former custom lifetimes.

## Public sharing and social previews

### User experience

Screenshots remain private after capture and upload. The web gallery offers a Share action with an explicit "Anyone with this link can view the screenshot" notice. The owner chooses a public title (default: "Screenshot shared with ScreenStash"), creates a link, and copies it. A public page displays the screenshot without sign-in. The owner can stop sharing at any time; creating a replacement link issues a fresh token and never reactivates an old link.

For MVP, sharing is managed from the web gallery. Desktop sharing is a later convenience. Public links are accessible to anyone who receives or forwards them; they are not invitations tied to particular accounts.

### Routes and delivery

| Route | Service | Access | Behavior |
| --- | --- | --- | --- |
| `POST /api/screenshots/:id/share` | Express | Authenticated owner | Create an active share and return its absolute HTTPS page URL |
| `DELETE /api/screenshots/:id/share` | Express | Authenticated owner | Revoke the active share |
| `GET /api/public/shares/:token` | Express | Public, active token | Return only approved public title, stable media URLs, and image dimensions/type |
| `GET /s/:token` | Next.js | Public, active token | Fetch active details from Express and render complete HTML with screenshot and metadata |
| `GET /s/:token/image` | Express through proxy | Public, active token | Check the share and stream its original image from private R2 |
| `GET /s/:token/preview.jpg` | Express through proxy | Public, active token | Return the pre-generated social preview after validating the share |

On the Vercel public domain, use explicit external rewrites for `/api/*`, `/s/:token/image`, and `/s/:token/preview.jpg` to Express. `/s/:token` belongs to the Next.js App Router; do not proxy all `/s/*`. Next.js server-side share lookups use the Express origin directly. Express remains the only authority deciding whether the screenshot is accessible. [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites)

Keep R2 private. Public media endpoints authorize access using the share token, not an account cookie, and never expose an R2 credential. Use stable image URLs rather than expiring presigned URLs in preview metadata. Start with application-controlled delivery and `Cache-Control: no-store`; any later CDN cache must support purge on revocation and deletion. Support GET and HEAD consistently. Unknown and revoked shares return 404 without image metadata.

Render share pages at request time, use `cache: 'no-store'` for active-share fetches, and exclude them from ISR/static generation and persistent caches. Set blocking metadata for MVP so required tags are in the initial HTML `<head>` for browsers as well as crawlers. Resolve share availability before streaming starts, ensuring unavailable pages return a real 404. Verify effective cache headers on Vercel and the API in production.

### Preview metadata

Implement `generateMetadata` in the Next.js share page using the authorized Express response. Render these tags in the initial HTML `<head>`, using absolute HTTPS URLs and escaped user-provided values. The metadata API is a rendering mechanism; Express still authorizes each lookup and media request. [Next.js metadata documentation](https://nextjs.org/docs/app/getting-started/metadata-and-og-images)

```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="ScreenStash">
<meta property="og:title" content="Screenshot shared with ScreenStash">
<meta property="og:description" content="View this screenshot on ScreenStash.">
<meta property="og:url" content="https://YOUR_DOMAIN/s/SHARE_TOKEN">
<meta property="og:image" content="https://YOUR_DOMAIN/s/SHARE_TOKEN/preview.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Shared screenshot preview">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Screenshot shared with ScreenStash">
<meta name="twitter:description" content="View this screenshot on ScreenStash.">
<meta name="twitter:image" content="https://YOUR_DOMAIN/s/SHARE_TOKEN/preview.jpg">
<meta name="twitter:image:alt" content="Shared screenshot preview">
<meta name="robots" content="noindex, noarchive">
```

Use Open Graph metadata for the Discord preview target and Twitter Card metadata for the Twitter/X large-image preview target. Generate a JPEG preview on share creation, fitting the screenshot within a 1200 × 630 canvas without cropping important content; this is ScreenStash's chosen preview format, not a promise of identical platform rendering. Add Sharp to the API stack for preview generation. Preserve the original image for the public page. Do not derive public descriptions or alt text from private OCR automatically.

Permit social crawlers to fetch active share pages and images without browser challenges or authentication. The robots metadata requests exclusion from search indexes but does not enforce secrecy. Sharing supports pasted-link previews; it does not require automated posting, a Discord bot, or an X posting integration.

### Share lifecycle and validation

1. The API verifies screenshot ownership and that the upload is finalized.
2. It generates the preview, creates a random token and stores its hash, then returns the link.
3. Browsers and crawlers request the Next.js public page and Express-backed image routes.
4. Next.js obtains fresh authorized share details from Express; Express checks an active share and non-deleted screenshot for both the details lookup and each media request.
5. Revocation disables all media endpoints for that token. Screenshot deletion revokes associated shares and removes original and preview objects.

Test owner authorization, signed-out access, HTML metadata, image content type, token replacement, revocation, deletion, and exclusion of private metadata. Verify real previews using deployed HTTPS links in Discord and Twitter/X. A correctly formed card cannot guarantee that either platform always displays it; user settings, crawler behavior, and third-party caches influence the result. ScreenStash cannot withdraw copies already fetched by those platforms or recipients.

### Reference sources

- [Open Graph protocol](https://ogp.me/) — metadata fields used for public share previews.
- [Next.js metadata documentation](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) — server-generated share metadata.
- [Next.js blocking metadata configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots) — disable metadata streaming for the initial-HTML requirement.
- [Discord: Using Webhooks and Embeds](https://discord.com/safety/using-webhooks-and-embeds) — Discord's overview of automatic link embeds.
- Twitter Card tags above are implementation targets to validate during release testing; the historical X card documentation URL currently redirects to its general developer documentation.

# ScreenStash — Screenshot Vault Project Specification

ScreenStash is the selected project name. It reflects a personal library for saving, organizing, and sharing screenshots.

## ScreenStash — Project specification

Version 0.2 · MVP · Target: 4 weekends · Includes public sharing

### Overview

ScreenStash is a desktop screenshot capture tool with a cloud-backed library accessible through a web application.

Users capture screenshots through a desktop app, upload them automatically, and later find them using text search, tags, dates, or collections.

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
| Authentication  | Sign in to web and desktop with the same account                     |
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

React Website

Gallery · Search · Manage

Express API

Authentication · Metadata · Upload authorization · Public share HTML and image routes

PostgreSQL

Users · Screenshots · Tags · OCR text

Cloudflare R2

Original images

### Technology stack

| Component  | Technology                              |
| ---------- | --------------------------------------- |
| Monorepo   | pnpm workspaces + Turborepo             |
| Desktop    | Electron Forge, React, Vite, TypeScript |
| Web        | React, Vite, TanStack Router/Query      |
| Backend    | Express.js, TypeScript                  |
| Database   | PostgreSQL, Drizzle ORM                 |
| Storage    | Cloudflare R2                           |
| Validation | Zod                                     |
| OCR        | Tesseract.js, executed locally          |
| Styling    | Tailwind CSS, shadcn/ui                 |
| Testing    | Vitest, Playwright                      |

### Core data model

| Entity            | Important fields                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `users`           | id, email, password_hash, created_at                                                                    |
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
- Desktop authentication uses secure token storage.
- Electron uses context isolation and a restricted preload API.
- Screenshots are deleted from R2 when permanently removed from the vault.
- OCR text is treated as private user data.
- Sharing is opt-in per screenshot. Only the shared image and a user-approved public title are exposed; account details, tags, OCR text, and other screenshots remain private.
- Use cryptographically random share tokens with at least 128 bits of entropy; store a hash for validation and avoid logging tokens. Rate-limit share creation and public image requests.
- Revoking a share or deleting its screenshot disables both public HTML and image routes. Platform-cached previews or downloaded copies may remain outside ScreenStash's control.

### Four-weekend implementation plan

Weekend 1 — Foundation

Set up monorepo, PostgreSQL, Express authentication, R2 integration, and a basic React gallery. Verify image upload and retrieval through the API.

Weekend 2 — Desktop capture

Implement Electron capture, region selection, global shortcuts, and local screenshot saving. Connect desktop authentication and uploads.

Weekend 3 — Search and organization

Add OCR extraction, PostgreSQL full-text search, tags, date filters, and the persistent offline upload queue. Add share records, owner-only create/revoke operations, and public HTML/image routes.

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

Selected name: **ScreenStash**. The options above are retained as earlier naming alternatives.

For a portfolio, the most impressive part will be demonstrating the entire capture-to-cloud-to-search workflow, especially offline recovery and OCR search.

## Monorepo structure and package responsibilities

Use pnpm workspaces and Turborepo for the three applications and their shared authentication, API contracts, and data types.

```text
screenstash/
├── apps/
│   ├── desktop/      # Electron + React
│   ├── web/          # React + Vite
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
| `apps/web` | Screenshot gallery, search, collections, account settings |
| `apps/api` | Authentication, screenshot metadata, R2 presigned URLs, user authorization, public share HTML and image delivery |
| `packages/shared` | Zod schemas, request/response types, shared constants |
| `packages/db` | Drizzle ORM schema and database migrations |
| `packages/api-client` | Reusable authenticated API calls for web and desktop |

The shared API client centralizes screenshot uploads, authentication, and gallery operations so the two clients do not maintain separate implementations.

### Architectural boundaries

1. **Extract shared UI only when duplication emerges.** The desktop capture interface and web gallery have different responsibilities. A shared UI package is not required initially.
2. **Keep database access server-side.** Only the Express API uses `packages/db`; the website and Electron renderer never connect directly to PostgreSQL.
3. **Share API contracts rather than database models.** Define request and response schemas in Zod. Frontends should not depend on Drizzle's internal database types.
4. **Separate Electron main and renderer processes.** Use a typed, restricted preload bridge with `contextIsolation: true`; do not expose unrestricted Node.js APIs to the React renderer.
5. **Deploy applications independently.** Deploy the React website and Express API independently. Build and distribute Electron separately through GitHub Releases.

### Turborepo decision

pnpm workspaces alone can manage local packages and dependencies. Turborepo adds task orchestration, dependency-aware builds, and caching. It is recommended for the three applications and three shared packages, but can be added later without restructuring the repository.
DECISION: We're using both pnpm workspaces and turborepo.  

### Collections scope clarification

The original overview and web package responsibilities mention collections, while the explicit MVP feature list and core data model only specify tags. Collections are therefore an unresolved scope detail rather than an added MVP requirement in this specification. The four-weekend baseline follows the listed MVP features and data model.
DECISION: let's not cover it in MVP. 

## Public sharing and social previews

### User experience

Screenshots remain private after capture and upload. The web gallery offers a Share action with an explicit "Anyone with this link can view the screenshot" notice. The owner chooses a public title (default: "Screenshot shared with ScreenStash"), creates a link, and copies it. A public page displays the screenshot without sign-in. The owner can stop sharing at any time; creating a replacement link issues a fresh token and never reactivates an old link.

For MVP, sharing is managed from the web gallery. Desktop sharing is a later convenience. Public links are accessible to anyone who receives or forwards them; they are not invitations tied to particular accounts.

### Routes and delivery

| Route | Access | Behavior |
| --- | --- | --- |
| `POST /screenshots/:id/share` | Authenticated owner | Create an active share and return its absolute HTTPS URL |
| `DELETE /screenshots/:id/share` | Authenticated owner | Revoke the active share |
| `GET /s/:token` | Public, active token | Express returns complete HTML with the screenshot and preview metadata |
| `GET /s/:token/image` | Public, active token | Express checks the share and streams its image from private R2 |
| `GET /s/:token/preview.jpg` | Public, active token | Return a pre-generated social preview image after validating the share |

Route `/s/*` through the Express service on the public domain before the Vite SPA fallback. The private gallery remains a React application. A simple server-rendered share page avoids requiring a framework change or crawler JavaScript execution.

Keep R2 private. Public media endpoints authorize access using the share token, not an account cookie, and never expose an R2 credential. Use stable image URLs rather than expiring presigned URLs in preview metadata. Start with application-controlled delivery and `Cache-Control: no-store`; any later CDN cache must support purge on revocation and deletion. Support GET and HEAD consistently. Unknown and revoked shares return 404 without image metadata.

### Preview metadata

Render these tags in the initial HTML `<head>`, using absolute HTTPS URLs and escaped user-provided values:

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
3. Browsers and crawlers request the same public HTML and image routes.
4. Each route verifies an active share and a non-deleted screenshot before serving content.
5. Revocation disables all media endpoints for that token. Screenshot deletion revokes associated shares and removes original and preview objects.

Test owner authorization, signed-out access, HTML metadata, image content type, token replacement, revocation, deletion, and exclusion of private metadata. Verify real previews using deployed HTTPS links in Discord and Twitter/X. A correctly formed card cannot guarantee that either platform always displays it; user settings, crawler behavior, and third-party caches influence the result. ScreenStash cannot withdraw copies already fetched by those platforms or recipients.

### Reference sources

- [Open Graph protocol](https://ogp.me/) — metadata fields used for public share previews.
- [Discord: Using Webhooks and Embeds](https://discord.com/safety/using-webhooks-and-embeds) — Discord's overview of automatic link embeds.
- Twitter Card tags above are implementation targets to validate during release testing; the historical X card documentation URL currently redirects to its general developer documentation.
# Desktop sync integration

Construct SyncCoordinator with repository, baseUrl, getSessionToken, automatic (settings.autoUpload), paused (settings.paused), and optional onChanged. Fetch, clock, random and timeout providers support tests. This module has no Electron dependency and logs nothing.

- start(): Promise<void> subscribes to repository changes and drains eligible work, preserving pause state.
- wake(): Promise<void> drains due work; concurrent calls share the active drain.
- pause(): void cancels active work immediately; resume(): Promise<void> resumes scheduling.
- setAutomatic(enabled): Promise<void> controls new automatic scheduling, not an already active upload.
- uploadNow(id): Promise<void> explicitly schedules one eligible capture even with automatic upload disabled. Explicit pause still wins.
- retry(id): Promise<void> clears recoverable error/backoff and schedules the same capture. Deleted/invalid captures stay terminal.
- identityChanged(): Promise<void> synchronously aborts the old generation, clears manual selections, then reconciles the currently verified owner's queue. Invalidate the token broker first, call this method, immediately set the repository identity (in-memory assignment is synchronous), then await both operations. Initialize with null identity before starting; persisted owner metadata alone is not authentication.
- stop(): Promise<void> aborts and awaits active work, removes subscriptions and cancels timers.

Repository worker API: current-owner-scoped all() (unbounded), get(id), serialized update(id, patch), readVerifiedBytes(id) / readBytes(id), flush() / drain(), and subscribe(listener) returning an unsubscribe function. Unassigned records are visible to local OCR but never eligible for sync. Owner/image metadata cannot change through update. OCR patches fail once upload metadata is locked; OCR scheduling should exclude uploadMetadataLocked records. Primary and backup receive each successful update.

Summary OCR statuses: pending, processing, complete, failed. Upload statuses: pending, authorizing, uploading, finalizing, retry_wait, auth_required, paused, failed, synced. Recoverable stage is create, put, finalize, separate from upload status. Summary includes uploadAttempts, uploadRetryAt, uploadError, ocrError, ocrTruncated, but omits OCR text and remote IDs. Global pause belongs to settings; cancelling does not overwrite the durable recovery stage.

Safe upload error codes: AUTH_REQUIRED, LOCAL_DAMAGED, LOCAL_IO, NETWORK_ERROR, TIMEOUT, SERVICE_UNAVAILABLE, PUT_EXPIRED, PUT_FAILED, INVALID_RESPONSE, DELETED, INVALID_IMAGE, INVALID_PAYLOAD, QUOTA_EXCEEDED, POLICY_BLOCKED, UPLOAD_REJECTED. No provider error messages, tokens or presigned URLs are persisted. UI should map codes to messages. Authentication failure blocks scheduling until identity change or explicit retry.

One upload runs at a time. Every API mutation/status call gets a fresh token and verifies /api/me with that exact token before using it. PUT credentials stay in memory; original PNG bytes are checksum/size/dimension verified and sent with only authorized headers, no cookies/bearer, redirects disabled. Synced is persisted only after finalize confirms capture and screenshot IDs. Lost create responses reuse immutable metadata; interrupted sessions reconcile/renew rather than create a new identity. Retry-After is respected with jittered 2-second to 5-minute backoff. Network/API/R2 work share a bounded abort timeout (120 seconds by default).

Cleanup and reassignment remain deferred. Lifecycle/tray/settings/UI wiring lives in the desktop main process. The embedded PostgreSQL (PGlite) pipeline test runs the bundled OCR worker and queue against a real UploadService and full-text search, with fake token transport and in-memory object storage; it does not use cloud credentials. A native PostgreSQL run needs TEST_DATABASE_URL or a local DIRECT_DATABASE_URL; neither was configured for this task. See docs/desktop-verification.md for evidence and outstanding release gates.

The five-minute ceiling applies to generated backoff, not to a server's Retry-After lower bound. Longer server delays remain visible in the queue and can be explicitly overridden with Retry or Upload now. Individual native timers are bounded to 2,147,483,647 milliseconds and re-evaluate durable retry timestamps when they wake.

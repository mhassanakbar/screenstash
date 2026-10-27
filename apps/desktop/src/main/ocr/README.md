# Offline English OCR integration

Create one service per application, then pass its adapter into LocalOcrQueue:

    const recognizer = new LocalOcrRecognizer(new OfflineOcr({
      resourceDirectory: ocrResourceDirectory({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
      }),
    }));

LocalOcrRecognizer implements the queue's structural interface:

- recognize(Buffer): Promise<{ text: string; truncated: boolean }>
- terminate(): Promise<void>

Failures reject with OcrFailure containing only a fixed error code. The queue
owns persistence, ready/upload eligibility and owner binding. It must persist
empty text on failure and freeze upload metadata before authorization. Neither
the service nor worker reads or mutates capture records.

OfflineOcr.recognize(Uint8Array) instead returns a discriminated OcrResult:
succeeded with normalized ocrText, null ocrError and truncated; or failed with
empty ocrText, a fixed ocrError and truncated=false. Calls never log OCR text.
Only PNG bytes within shared byte/pixel/side limits are accepted. Inputs cannot
be local paths, URLs or language selectors. Concurrent calls fail with busy;
the persisted queue should serialize work instead of buffering images here.

The default 60-second deadline includes initialization and recognition. Timeout,
worker rejection and crash kill the worker before the next task starts. One
initialized worker is reused for up to 20 images, then recycled to release its
WASM heap. maxTasksPerWorker and timeoutMs are configurable. stop()/terminate()
abort active work, await thread retirement, and permanently close the instance.
Create a new instance if the application needs OCR again after shutdown.

Resource preparation and packaging

- corepack pnpm --filter @screenstash/desktop prepare:ocr
- The desktop dev/build/make scripts prepare assets before invoking Forge.
- Forge copies resources/ocr to the unpacked installation resources/ocr folder.
- Development resolves app.getAppPath()/resources/ocr, never the shell cwd.
- No disk cache is written. Language data lives in the disposable WASM filesystem.
- The worker uses a custom disk-only Tesseract adapter with network fetch denied.
- Only the baseline LSTM JavaScript/WASM core is shipped; it does not need SIMD.
- Upstream worker source, core and language checksums are checked during prep;
  every copied asset and license is checksummed in the generated manifest.json.
- Generated resources are ignored by Git, lint and formatting. Rebuild from the
  committed preparation script and pnpm lockfile rather than downloading at runtime.
- The pinned worker protocol is internal to Tesseract.js 6.0.1. Any upgrade needs
  fresh checksum review and the real offline recognition/recovery tests.

Validation

Run corepack pnpm exec vitest run tests/unit/desktop-ocr.test.ts. It checks
initialization/recognition deadlines, worker reuse/recycling, crash sanitization,
stop/busy behavior, image bounds and Unicode-safe truncation. The real test moves
the complete bundle outside the repository, starts with no trained-data cache,
blocks worker HTTP/HTTPS/TCP/TLS/fetch, recognizes known English search words,
then removes the English model to prove local failure and recovery without a CDN.

Parent-owned acceptance must still verify the installed build and shutdown flow.
The default worker V8 heap is capped at 128 MiB; WASM memory is not included in
that cap. A worst-case 40-megapixel/RSS soak at the shared supported image limits
remains a release gate; the recycling/deadline policy is not proof of that gate.

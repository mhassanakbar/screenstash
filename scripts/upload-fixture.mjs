import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApiClient } from '@screenstash/api-client';
import { limits } from '@screenstash/shared';

async function main() {
  const [file, ocrFile] = process.argv.slice(2);
  if (!file || !process.env.SCREENSTASH_SESSION_TOKEN)
    throw new Error(
      'Provide a PNG path and SCREENSTASH_SESSION_TOKEN in the process environment.',
    );
  const origin = process.env.SCREENSTASH_API_ORIGIN ?? 'http://localhost:3000';
  const url = new URL(origin);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('SCREENSTASH_API_ORIGIN must be an HTTP(S) origin.');
  if ((await stat(file)).size > limits.uploadBytes)
    throw new Error('PNG exceeds the upload byte limit.');
  const bytes = await readFile(file);
  const metadata = await sharp(bytes, {
    limitInputPixels: limits.imagePixels,
    failOn: 'warning',
  }).metadata();
  if (
    metadata.format !== 'png' ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error('Provide a single-frame PNG.');
  if (ocrFile && (await stat(ocrFile)).size > 1024 * 1024)
    throw new Error('OCR fixture exceeds 1 MiB.');
  const text = ocrFile ? await readFile(ocrFile, 'utf8') : '';
  const api = createApiClient({
    baseUrl: url.origin,
    getSessionToken: async () => process.env.SCREENSTASH_SESSION_TOKEN ?? null,
  });
  const captureId = randomUUID();
  const input = {
    captureId,
    title: path
      .basename(file, path.extname(file))
      .slice(0, limits.privateTitle),
    capturedAt: new Date().toISOString(),
    mimeType: 'image/png',
    sizeBytes: bytes.length,
    width: metadata.width,
    height: metadata.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ocrStatus: 'complete',
    ocrText: text.slice(0, limits.ocrText),
    ocrTruncated: text.length > limits.ocrText,
  };
  const upload = await api.createUpload(input);
  if (upload.status !== 'finalized') {
    if (!upload.putUrl)
      throw new Error('Upload authorization was unavailable.');
    const uploaded = await fetch(upload.putUrl, {
      method: 'PUT',
      headers: upload.requiredHeaders ?? {},
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(60000),
    });
    if (!uploaded.ok) throw new Error('Direct upload failed.');
  }
  const image = await api.finalizeUpload(upload.id);
  console.log(
    JSON.stringify({ captureId, screenshotId: image.id, status: 'finalized' }),
  );
}
main().catch(() => {
  console.error(
    'Fixture upload failed. Check the PNG, service configuration, and a fresh Clerk session token.',
  );
  process.exitCode = 1;
});

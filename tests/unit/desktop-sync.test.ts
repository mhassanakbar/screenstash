import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureRepository } from '../../apps/desktop/src/main/capture/repository';
import { SyncCoordinator } from '../../apps/desktop/src/main/sync/coordinator';
import {
  localCaptureSchema,
  type CaptureIdentity,
} from '../../apps/desktop/src/contracts/capture';

const directories: string[] = [];
const coordinators: SyncCoordinator[] = [];
const base = path.resolve('test-results');
const identity = (): CaptureIdentity => ({
  owner: { id: randomUUID(), clerkUserId: 'user_' + randomUUID() },
  device: {
    id: randomUUID(),
    installationId: randomUUID(),
    name: 'Fixture',
    lastSeenAt: new Date().toISOString(),
  },
});
afterEach(async () => {
  for (const coordinator of coordinators.splice(0)) await coordinator.stop();
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== base ||
      !path.basename(directory).startsWith('sync-unit-')
    )
      throw new Error('Unexpected cleanup target');
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'sync-unit-'));
  directories.push(directory);
  const repository = new CaptureRepository(directory);
  await repository.initialize();
  const owner = identity();
  await repository.setIdentity(owner);
  const bytes = await sharp({
    create: { width: 24, height: 16, channels: 3, background: '#228844' },
  })
    .png()
    .toBuffer();
  const capture = await repository.save(
    bytes,
    'display',
    new Date().toISOString(),
    owner,
  );
  const session = {
    id: randomUUID(),
    screenshotId: randomUUID(),
    status: 'pending',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    putUrl: 'https://r2.invalid/private?signature=secret',
    putExpiresAt: new Date(Date.now() + 60000).toISOString(),
    requiredHeaders: { 'Content-Type': 'image/png' },
  };
  let uploaded: Uint8Array | undefined;
  let metadata: Record<string, unknown> = {};
  const finalized = () => ({
    title: capture.title,
    mimeType: 'image/png',
    sizeBytes: bytes.length,
    width: 24,
    height: 16,
    capturedAt: capture.capturedAt,
    ocrStatus: 'complete',
    ocrText: 'searchable fixture invoice',
    ocrTruncated: false,
    ...metadata,
    id: session.screenshotId,
    captureId: capture.id,
    createdAt: capture.capturedAt,
    tags: [],
  });
  const json = (value: unknown) => new Response(JSON.stringify(value));
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://r2.invalid')) {
      uploaded = init?.body as Uint8Array;
      return new Response(null);
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer owner-token',
    );
    if (url.endsWith('/api/me')) return json(owner.owner);
    if (url.endsWith('/api/devices')) return json(owner.device);
    if (url.endsWith('/api/upload-sessions')) {
      metadata = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json(session);
    }
    if (url.endsWith('/renew')) return json(session);
    if (url.endsWith('/finalize')) {
      session.status = 'finalized';
      return json(finalized());
    }
    if (url.endsWith('/' + session.id))
      return json({
        ...session,
        putUrl: undefined,
        requiredHeaders: undefined,
        putExpiresAt: undefined,
      });
    throw new Error('Unexpected fixture route');
  });
  const coordinator = (
    options: Partial<ConstructorParameters<typeof SyncCoordinator>[0]> = {},
  ) => {
    const result = new SyncCoordinator({
      repository,
      baseUrl: 'https://api.invalid',
      getSessionToken: async () => 'owner-token',
      fetch: transport,
      random: () => 1,
      ...options,
    });
    coordinators.push(result);
    return result;
  };
  const settle = () =>
    repository.update(capture.id, {
      ocrStatus: 'complete',
      ocrText: 'searchable fixture invoice',
    });
  return {
    directory,
    repository,
    owner,
    bytes,
    capture,
    session,
    transport,
    coordinator,
    settle,
    uploaded: () => uploaded,
    metadata: () => metadata,
    json,
    finalized,
  };
}

describe('Owner-bound desktop sync', () => {
  it('bounds a token provider that never settles and persists timeout backoff', async () => {
    const test = await fixture();
    await test.settle();
    const sync = test.coordinator({
      timeoutMs: 10,
      getSessionToken: () => new Promise(() => {}),
    });
    await sync.start();
    expect(test.repository.get(test.capture.id)).toMatchObject({
      uploadStatus: 'retry_wait',
      uploadError: 'TIMEOUT',
    });
    expect(test.transport).not.toHaveBeenCalled();
  });
  it('preserves persisted pause through start and resumes explicitly', async () => {
    const test = await fixture();
    await test.settle();
    const sync = test.coordinator({ paused: true });
    await sync.start();
    expect(test.transport).not.toHaveBeenCalled();
    await sync.resume();
    expect(test.repository.get(test.capture.id)?.uploadStatus).toBe('synced');
  });
  it('refreshes a rejected token once then blocks authentication without retry storms', async () => {
    const test = await fixture();
    await test.settle();
    test.transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'UNAUTHENTICATED',
            message: 'private message',
            retryable: false,
          },
        }),
        { status: 401 },
      ),
    );
    const token = vi.fn(async () => 'owner-token');
    const sync = test.coordinator({ getSessionToken: token });
    await sync.start();
    expect(token).toHaveBeenCalledTimes(2);
    expect(test.repository.get(test.capture.id)).toMatchObject({
      uploadStatus: 'auth_required',
      uploadError: 'AUTH_REQUIRED',
    });
    await sync.wake();
    expect(token).toHaveBeenCalledTimes(2);
  });
  it('reconciles a lost finalize response after retry without creating or uploading again', async () => {
    const test = await fixture();
    await test.settle();
    const original = test.transport.getMockImplementation()!;
    let lost = false;
    test.transport.mockImplementation(async (url, init) => {
      const result = await original(url, init);
      if (String(url).endsWith('/finalize') && !lost) {
        lost = true;
        throw new TypeError('connection lost');
      }
      return result;
    });
    let now = Date.now();
    const sync = test.coordinator({ now: () => now });
    await sync.start();
    expect(test.repository.get(test.capture.id)).toMatchObject({
      uploadStatus: 'retry_wait',
      uploadStage: 'finalize',
    });
    now += 3000;
    test.transport.mockClear();
    await sync.wake();
    expect(test.repository.get(test.capture.id)?.uploadStatus).toBe('synced');
    expect(
      test.transport.mock.calls.some(
        ([url]) =>
          String(url).startsWith('https://r2.invalid') ||
          String(url).endsWith('/api/upload-sessions'),
      ),
    ).toBe(false);
  });
  it('reuses the capture id and immutable OCR after a lost create response', async () => {
    const test = await fixture();
    await test.settle();
    const original = test.transport.getMockImplementation()!;
    let lost = false;
    test.transport.mockImplementation(async (url, init) => {
      const result = await original(url, init);
      if (String(url).endsWith('/api/upload-sessions') && !lost) {
        lost = true;
        throw new TypeError('connection lost');
      }
      return result;
    });
    const sync = test.coordinator();
    await sync.start();
    await expect(
      test.repository.update(test.capture.id, { ocrText: 'replacement' }),
    ).rejects.toThrow('immutable');
    await sync.retry(test.capture.id);
    const payloads = test.transport.mock.calls
      .filter(([url]) => String(url).endsWith('/api/upload-sessions'))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual(payloads[1]);
    expect(test.repository.get(test.capture.id)?.uploadStatus).toBe('synced');
  });
  it('waits for OCR, persists exact original bytes and terminal primary/backup without secrets', async () => {
    const test = await fixture();
    const sync = test.coordinator();
    await sync.start();
    expect(test.transport).not.toHaveBeenCalled();
    await test.settle();
    await sync.wake();
    expect(test.repository.get(test.capture.id)?.uploadStatus).toBe('synced');
    expect(test.metadata().ocrText).toBe('searchable fixture invoice');
    expect(Buffer.from(test.uploaded()!)).toEqual(test.bytes);
    expect(createHash('sha256').update(test.uploaded()!).digest('hex')).toBe(
      test.repository.get(test.capture.id)?.sha256,
    );
    const put = test.transport.mock.calls.find(([url]) =>
      String(url).startsWith('https://r2.invalid'),
    )!;
    expect(put[1]?.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(put[1]?.credentials).toBe('omit');
    for (const suffix of ['.json', '.json.bak']) {
      const text = await readFile(
        path.join(test.directory, 'queue', test.capture.id + suffix),
        'utf8',
      );
      expect(JSON.parse(text).uploadStatus).toBe('synced');
      expect(text).not.toMatch(/owner-token|signature|https/);
    }
    const restarted = new CaptureRepository(test.directory);
    await restarted.initialize();
    expect(restarted.get(test.capture.id)?.uploadStatus).toBe('synced');
  });
  it('handles failed OCR as empty text and allows explicit upload with automatic disabled', async () => {
    const test = await fixture();
    await test.repository.update(test.capture.id, {
      ocrStatus: 'failed',
      ocrText: '',
      ocrError: 'OCR_FAILED',
    });
    const sync = test.coordinator({ automatic: false });
    await sync.start();
    expect(test.transport).not.toHaveBeenCalled();
    await sync.uploadNow(test.capture.id);
    expect(test.metadata()).toMatchObject({ ocrStatus: 'failed', ocrText: '' });
    expect(test.repository.get(test.capture.id)?.uploadStatus).toBe('synced');
  });
  it.each(['failed', 'retry_wait', 'auth_required', 'paused'] as const)(
    'upload-now restarts a recoverable %s record with automatic upload disabled',
    async (status) => {
      const test = await fixture();
      await test.settle();
      await test.repository.update(test.capture.id, {
        uploadStatus: status,
        uploadError: 'SERVICE_UNAVAILABLE',
        uploadRetryAt: new Date(Date.now() + 86400000).toISOString(),
      });
      const sync = test.coordinator({ automatic: false });
      await sync.start();
      expect(test.transport).not.toHaveBeenCalled();
      await sync.uploadNow(test.capture.id);
      expect(test.repository.get(test.capture.id)?.uploadStatus).toBe('synced');
    },
  );
  it('never uploads unassigned, other-owner, oversized or unfinished records', async () => {
    const test = await fixture();
    await test.settle();
    await test.repository.save(
      test.bytes,
      'display',
      new Date().toISOString(),
      null,
    );
    await test.repository.setIdentity(identity());
    await test.coordinator().start();
    expect(test.transport).not.toHaveBeenCalled();
    expect(test.repository.get(test.capture.id)).toBeNull();
  });
  it('verifies owner using the exact token for every API request', async () => {
    const test = await fixture();
    await test.settle();
    test.transport.mockResolvedValue(test.json(identity().owner));
    await test.coordinator().start();
    expect(
      test.transport.mock.calls.every(([url]) =>
        String(url).endsWith('/api/me'),
      ),
    ).toBe(true);
    expect(test.repository.get(test.capture.id)).toMatchObject({
      uploadStatus: 'auth_required',
      uploadError: 'AUTH_REQUIRED',
    });
  });
  it('aborts account changes during token acquisition before any network request', async () => {
    const test = await fixture();
    await test.settle();
    let release!: (value: string) => void;
    const getToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const sync = test.coordinator({ getSessionToken: getToken });
    const work = sync.start();
    await vi.waitFor(() => expect(getToken).toHaveBeenCalled());
    await test.repository.setIdentity(identity());
    const changing = sync.identityChanged();
    release('other-owner-token');
    await Promise.all([work, changing]);
    expect(test.transport).not.toHaveBeenCalled();
  });
  it('cancels a PUT on account switch without finalizing under the next account', async () => {
    const test = await fixture();
    await test.settle();
    const original = test.transport.getMockImplementation()!;
    let putStarted = false;
    test.transport.mockImplementation(async (url, init) => {
      if (String(url).startsWith('https://r2.invalid')) {
        putStarted = true;
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      }
      return original(url, init);
    });
    const sync = test.coordinator();
    const work = sync.start();
    await vi.waitFor(() => expect(putStarted).toBe(true));
    await test.repository.setIdentity(identity());
    await sync.identityChanged();
    await work;
    expect(
      test.transport.mock.calls.some(([url]) =>
        String(url).endsWith('/finalize'),
      ),
    ).toBe(false);
    await test.repository.setIdentity(test.owner);
    expect(test.repository.get(test.capture.id)?.uploadStage).toBe('put');
  });
  it.each([120, 31536000])(
    'preserves Retry-After %s seconds without a tight retry loop',
    async (seconds) => {
      const test = await fixture();
      await test.settle();
      const original = test.transport.getMockImplementation()!;
      test.transport.mockImplementation(async (url, init) =>
        String(url).endsWith('/api/upload-sessions')
          ? new Response('private diagnostic', {
              status: 429,
              headers: { 'Retry-After': String(seconds) },
            })
          : original(url, init),
      );
      const now = Date.now();
      const sync = test.coordinator({ now: () => now });
      await sync.start();
      const record = test.repository.get(test.capture.id)!;
      expect(record.uploadStatus).toBe('retry_wait');
      expect(Date.parse(record.uploadRetryAt!)).toBe(now + seconds * 1000);
      const count = test.transport.mock.calls.length;
      await sync.wake();
      expect(test.transport).toHaveBeenCalledTimes(count);
      expect(record.uploadError).toBe('SERVICE_UNAVAILABLE');
    },
  );
  it('reconciles a committed finalize after restart without another PUT or create', async () => {
    const test = await fixture();
    await test.settle();
    const first = test.coordinator();
    await first.start();
    await first.stop();
    await test.repository.update(test.capture.id, {
      uploadStatus: 'finalizing',
    });
    const restarted = new CaptureRepository(test.directory);
    await restarted.initialize();
    test.transport.mockClear();
    await test.coordinator({ repository: restarted }).start();
    expect(restarted.get(test.capture.id)?.uploadStatus).toBe('synced');
    expect(
      test.transport.mock.calls.some(
        ([url]) =>
          String(url).startsWith('https://r2.invalid') ||
          String(url).endsWith('/api/upload-sessions'),
      ),
    ).toBe(false);
  });
  it('renews the same pending session and preserves capture identity after interrupted PUT', async () => {
    const test = await fixture();
    await test.settle();
    await test.repository.update(test.capture.id, {
      uploadSessionId: test.session.id,
      screenshotId: test.session.screenshotId,
      uploadStage: 'put',
      uploadStatus: 'uploading',
    });
    await test.coordinator().start();
    expect(
      test.transport.mock.calls.some(([url]) => String(url).endsWith('/renew')),
    ).toBe(true);
    expect(
      test.transport.mock.calls.some(([url]) =>
        String(url).endsWith('/api/upload-sessions'),
      ),
    ).toBe(false);
    expect(test.repository.get(test.capture.id)?.uploadStatus).toBe('synced');
  });
  it('keeps tombstoned sessions terminal even on manual retry', async () => {
    const test = await fixture();
    await test.settle();
    test.session.status = 'deleted';
    const sync = test.coordinator();
    await sync.start();
    expect(test.repository.get(test.capture.id)).toMatchObject({
      uploadStatus: 'failed',
      uploadError: 'DELETED',
    });
    const count = test.transport.mock.calls.length;
    await sync.retry(test.capture.id);
    await sync.uploadNow(test.capture.id);
    expect(test.transport).toHaveBeenCalledTimes(count);
  });
  it('rejects damaged local bytes before making requests', async () => {
    const test = await fixture();
    await test.settle();
    await writeFile(
      path.join(test.directory, 'captures', test.capture.id + '.png'),
      Buffer.alloc(100),
    );
    await test.coordinator().start();
    expect(test.transport).not.toHaveBeenCalled();
    expect(test.repository.get(test.capture.id)).toMatchObject({
      uploadStatus: 'failed',
      uploadError: 'LOCAL_DAMAGED',
    });
  });
});

describe('Capture worker repository contract', () => {
  it('defaults legacy manifests, returns isolated copies and serializes OCR/upload patches', async () => {
    const test = await fixture();
    const record = test.repository.get(test.capture.id)!;
    const legacy = Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => !['ocrText', 'ocrError', 'uploadStage'].includes(key),
      ),
    );
    expect(localCaptureSchema.parse(legacy)).toMatchObject({
      ocrText: '',
      ocrError: null,
      uploadStage: 'create',
    });
    const changed = vi.fn();
    const unsubscribe = test.repository.subscribe(changed);
    await Promise.all([
      test.repository.update(record.id, {
        ocrStatus: 'complete',
        ocrText: 'preserved',
      }),
      test.repository.update(record.id, { uploadAttempts: 1 }),
    ]);
    await test.repository.flush();
    expect(test.repository.get(record.id)).toMatchObject({
      ocrText: 'preserved',
      uploadAttempts: 1,
    });
    record.ocrText = 'mutation';
    expect(test.repository.get(record.id)?.ocrText).toBe('preserved');
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(await test.repository.readBytes(record.id)).toEqual(test.bytes);
  });
  it('locks OCR metadata once authorization begins, including retries after lost create responses', async () => {
    const test = await fixture();
    await test.settle();
    await test.repository.update(test.capture.id, {
      uploadStatus: 'authorizing',
      uploadMetadataLocked: true,
    });
    await test.repository.update(test.capture.id, {
      uploadStatus: 'retry_wait',
    });
    await expect(
      test.repository.update(test.capture.id, { ocrText: 'replacement' }),
    ).rejects.toThrow('immutable');
    await expect(
      test.repository.update(test.capture.id, { uploadMetadataLocked: false }),
    ).rejects.toThrow('immutable');
    expect(test.repository.list()[0]).not.toHaveProperty('ocrText');
    expect(test.repository.list()[0]).not.toHaveProperty('uploadSessionId');
  });
});

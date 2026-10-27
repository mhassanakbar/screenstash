import {
  ApiError,
  createApiClient,
  parseRetryAfter,
  type SessionTokenProvider,
} from '@screenstash/api-client';
import type { LocalCapture, CaptureIdentity } from '../../contracts/capture';
import { isTerminalUploadError } from '../../contracts/capture';
import { CaptureRepository } from '../capture/repository';

export interface SyncOptions {
  repository: CaptureRepository;
  baseUrl: string;
  getSessionToken: SessionTokenProvider;
  fetch?: typeof fetch;
  automatic?: boolean;
  paused?: boolean;
  onChanged?: () => void;
  now?: () => number;
  random?: () => number;
  timeoutMs?: number;
}
class SyncFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(code);
  }
}
const sameOwner = (
  left: CaptureIdentity | null,
  right: CaptureIdentity | null,
) =>
  Boolean(
    left &&
    right &&
    left.owner.id === right.owner.id &&
    left.owner.clerkUserId === right.owner.clerkUserId,
  );

export class SyncCoordinator {
  private running = false;
  private paused = false;
  private automatic: boolean;
  private generation = 0;
  private authBlocked = false;
  private active: AbortController | undefined;
  private activeCaptureId: string | undefined;
  private draining: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private requested = new Set<string>();
  private readonly now: () => number;
  private readonly transport: typeof fetch;
  constructor(private readonly options: SyncOptions) {
    this.automatic = options.automatic ?? true;
    this.paused = options.paused ?? false;
    this.now = options.now ?? Date.now;
    this.transport = options.fetch ?? fetch;
  }
  start() {
    this.running = true;
    this.unsubscribe ??= this.options.repository.subscribe(() => {
      void this.wake();
    });
    return this.wake();
  }
  resume() {
    this.paused = false;
    return this.wake();
  }
  setAutomatic(enabled: boolean) {
    this.automatic = enabled;
    return this.wake();
  }
  pause() {
    this.paused = true;
    this.cancel();
  }
  async identityChanged() {
    this.cancel();
    this.authBlocked = false;
    this.requested.clear();
    await this.draining;
    for (const record of this.options.repository.all()) {
      if (
        sameOwner(record.identity, this.options.repository.currentIdentity()) &&
        record.uploadStatus === 'auth_required'
      )
        await this.options.repository.update(record.id, {
          uploadStatus: 'pending',
          uploadError: null,
        });
    }
    return this.wake();
  }
  stop() {
    this.running = false;
    this.cancel();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    return this.draining ?? Promise.resolve();
  }
  private cancel() {
    this.generation++;
    this.active?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  async retry(id: string) {
    const record = this.options.repository.get(id);
    if (
      !record ||
      !sameOwner(record.identity, this.options.repository.currentIdentity()) ||
      record.uploadStatus === 'synced'
    )
      return;
    if (this.activeCaptureId === id) return this.wake();
    if (isTerminalUploadError(record.uploadError)) return;
    await this.options.repository.update(id, {
      uploadStatus: 'pending',
      uploadRetryAt: null,
      uploadError: null,
      uploadAttempts: 0,
    });
    this.authBlocked = false;
    this.options.onChanged?.();
    this.requested.add(id);
    return this.wake();
  }
  uploadNow(id: string) {
    return this.retry(id);
  }
  wake(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.draining) return this.draining;
    if (!this.running || this.paused) return Promise.resolve();
    this.draining = this.drain().finally(() => {
      this.draining = undefined;
      this.schedule();
    });
    return this.draining;
  }
  private candidates() {
    if (this.authBlocked) return [];
    const identity = this.options.repository.currentIdentity();
    return this.options.repository
      .all()
      .filter(
        (record) =>
          sameOwner(record.identity, identity) &&
          record.uploadEligible &&
          ['complete', 'failed'].includes(record.ocrStatus) &&
          !['synced', 'failed', 'auth_required', 'paused'].includes(
            record.uploadStatus,
          ) &&
          (this.automatic || this.requested.has(record.id)),
      );
  }
  private schedule() {
    if (!this.running || this.paused) return;
    const times = this.candidates().map((record) =>
      record.uploadRetryAt ? Date.parse(record.uploadRetryAt) : this.now(),
    );
    if (!times.length) return;
    this.timer = setTimeout(
      () => {
        void this.wake();
      },
      Math.min(2147483647, Math.max(0, Math.min(...times) - this.now())),
    );
    this.timer.unref?.();
  }
  private async drain() {
    while (this.running && !this.paused) {
      const record = this.candidates().find(
        (item) =>
          !item.uploadRetryAt || Date.parse(item.uploadRetryAt) <= this.now(),
      );
      if (!record) return;
      const generation = this.generation;
      const controller = new AbortController();
      this.active = controller;
      this.activeCaptureId = record.id;
      const timeout = setTimeout(
        () => controller.abort(new SyncFailure('TIMEOUT', true)),
        this.options.timeoutMs ?? 120000,
      );
      try {
        await this.sync(record, generation, controller.signal);
      } catch (error) {
        if (
          generation === this.generation &&
          sameOwner(record.identity, this.options.repository.currentIdentity())
        ) {
          try {
            await this.failure(
              record.id,
              controller.signal.reason instanceof SyncFailure
                ? controller.signal.reason
                : error,
            );
          } catch {
            return;
          }
        }
      } finally {
        clearTimeout(timeout);
        this.active = undefined;
        this.activeCaptureId = undefined;
      }
      if (generation !== this.generation) return;
      if (
        ['synced', 'failed', 'auth_required'].includes(
          this.options.repository.get(record.id)?.uploadStatus ?? 'failed',
        )
      )
        this.requested.delete(record.id);
    }
  }
  private async sync(
    record: LocalCapture,
    generation: number,
    signal: AbortSignal,
  ) {
    const repository = this.options.repository;
    const check = () => {
      signal.throwIfAborted();
      if (
        generation !== this.generation ||
        !sameOwner(record.identity, repository.currentIdentity())
      )
        throw new SyncFailure('AUTH_REQUIRED');
    };
    const boundary = async <T>(work: () => Promise<T>): Promise<T> => {
      check();
      let abort!: () => void;
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      });
      try {
        const result = await Promise.race([work(), interrupted]);
        check();
        return result;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    };
    const save = async (
      changes: Parameters<CaptureRepository['update']>[1],
    ) => {
      await boundary(() => repository.update(record.id, changes));
      this.options.onChanged?.();
    };
    const client = createApiClient({
      baseUrl: this.options.baseUrl,
      fetch: this.transport,
      getSessionToken: async () => {
        const token = await boundary(() => this.options.getSessionToken());
        if (!token) throw new SyncFailure('AUTH_REQUIRED');
        const verifier = createApiClient({
          baseUrl: this.options.baseUrl,
          fetch: this.transport,
          getSessionToken: async () => token,
        });
        const owner = await boundary(() => verifier.me(signal));
        if (
          owner.id !== record.identity?.owner.id ||
          owner.clerkUserId !== record.identity.owner.clerkUserId
        )
          throw new SyncFailure('OWNER_MISMATCH');
        return token;
      },
    });
    let refreshed = false;
    const api = async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        return await boundary(work);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401 || refreshed)
          throw error;
        refreshed = true;
        return boundary(work);
      }
    };
    await save({
      uploadStatus: 'authorizing',
      uploadMetadataLocked: true,
      uploadError: null,
      uploadRetryAt: null,
    });
    record = repository.get(record.id)!;
    check();
    let bytes: Buffer;
    try {
      bytes = await boundary(() => repository.readVerifiedBytes(record.id));
    } catch (error) {
      check();
      if (error instanceof SyncFailure) throw error;
      throw new SyncFailure('LOCAL_DAMAGED');
    }
    let session: Awaited<ReturnType<typeof client.createUpload>>;
    if (record.uploadSessionId) {
      session = await api(() =>
        client.uploadStatus(record.uploadSessionId!, signal),
      );
    } else {
      const device = await api(() =>
        client.registerDevice(
          {
            installationId: record.identity!.device.installationId,
            name: record.identity!.device.name,
          },
          signal,
        ),
      );
      session = await api(() =>
        client.createUpload(
          {
            captureId: record.id,
            deviceId: device.id,
            title: record.title,
            capturedAt: record.capturedAt,
            mimeType: 'image/png',
            sizeBytes: record.sizeBytes,
            width: record.width,
            height: record.height,
            sha256: record.sha256,
            ocrStatus: record.ocrStatus as 'complete' | 'failed',
            ocrText: record.ocrStatus === 'failed' ? '' : record.ocrText,
            ocrTruncated: record.ocrTruncated,
          },
          signal,
        ),
      );
    }
    const validateSession = () => {
      if (record.uploadSessionId && record.uploadSessionId !== session.id)
        throw new SyncFailure('INVALID_RESPONSE');
      if (record.screenshotId && record.screenshotId !== session.screenshotId)
        throw new SyncFailure('INVALID_RESPONSE');
      if (session.status === 'deleted') throw new SyncFailure('DELETED');
      if (session.status === 'rejected') throw new SyncFailure('INVALID_IMAGE');
    };
    validateSession();
    await save({
      uploadSessionId: session.id,
      screenshotId: session.screenshotId,
    });
    record = repository.get(record.id)!;
    const confirm = async () => {
      const screenshot = await api(() =>
        client.finalizeUpload(session.id, signal),
      );
      if (
        screenshot.id !== session.screenshotId ||
        screenshot.captureId !== record.id
      )
        throw new SyncFailure('INVALID_RESPONSE');
      await save({
        uploadStatus: 'synced',
        uploadStage: 'finalize',
        screenshotId: screenshot.id,
        uploadRetryAt: null,
        uploadError: null,
        uploadAttempts: 0,
      });
    };
    if (session.status === 'finalized') {
      await confirm();
      return;
    }
    if (
      record.uploadSessionId &&
      record.uploadStage === 'finalize' &&
      session.status === 'pending'
    ) {
      try {
        await confirm();
        return;
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          !['UPLOAD_NOT_READY', 'UPLOAD_EXPIRED'].includes(error.code)
        )
          throw error;
      }
    }
    if (
      !session.putUrl ||
      !session.putExpiresAt ||
      Date.parse(session.putExpiresAt) <= this.now() ||
      session.status === 'expired'
    ) {
      session = await api(() => client.renewUpload(session.id, signal));
      validateSession();
      if (session.status === 'finalized') {
        await confirm();
        return;
      }
    }
    if (
      !session.putUrl ||
      new URL(session.putUrl).protocol !== 'https:' ||
      !session.putExpiresAt ||
      Date.parse(session.putExpiresAt) <= this.now()
    )
      throw new SyncFailure('INVALID_RESPONSE');
    const headers = session.requiredHeaders ?? {};
    if (
      Object.keys(headers).some((name) =>
        ['authorization', 'cookie', 'proxy-authorization'].includes(
          name.toLowerCase(),
        ),
      )
    )
      throw new SyncFailure('INVALID_RESPONSE');
    await save({ uploadStatus: 'uploading', uploadStage: 'put' });
    const response = await boundary(() =>
      this.transport(session.putUrl!, {
        method: 'PUT',
        headers,
        body: new Uint8Array(bytes),
        signal,
        credentials: 'omit',
        redirect: 'error',
      }),
    );
    if (!response.ok)
      throw new SyncFailure(
        response.status === 401 || response.status === 403
          ? 'PUT_EXPIRED'
          : 'PUT_FAILED',
        response.status === 401 ||
          response.status === 403 ||
          response.status === 429 ||
          response.status >= 500,
        parseRetryAfter(response.headers.get('Retry-After'), this.now()),
      );
    await save({ uploadStatus: 'finalizing', uploadStage: 'finalize' });
    await confirm();
  }
  private async failure(id: string, error: unknown) {
    const record = this.options.repository.get(id);
    if (!record) return;
    const apiError = error instanceof ApiError ? error : null;
    const syncError = error instanceof SyncFailure ? error : null;
    const auth =
      apiError?.status === 401 ||
      ['AUTH_REQUIRED', 'OWNER_MISMATCH'].includes(syncError?.code ?? '');
    const retryable =
      !auth &&
      (apiError
        ? apiError.retryable ||
          ['UPLOAD_EXPIRED', 'UPLOAD_NOT_READY'].includes(apiError.code) ||
          apiError.status === 429 ||
          apiError.status >= 500
        : syncError
          ? syncError.retryable
          : error instanceof TypeError ||
            (error instanceof Error &&
              ['AbortError', 'TimeoutError'].includes(error.name)));
    const attempts = record.uploadAttempts + 1;
    const delay = Math.max(
      Math.min(300000, 2000 * 2 ** Math.min(attempts - 1, 8)) *
        (0.75 + (this.options.random ?? Math.random)() * 0.25),
      apiError?.retryAfterMs ?? syncError?.retryAfterMs ?? 0,
    );
    if (auth) this.authBlocked = true;
    const code = auth
      ? 'AUTH_REQUIRED'
      : (syncError?.code ??
        (apiError
          ? ((
              {
                NOT_FOUND: 'DELETED',
                CAPTURE_DELETED: 'DELETED',
                UPLOAD_INVALID: 'INVALID_IMAGE',
                INVALID_INPUT: 'INVALID_PAYLOAD',
                QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
                FORBIDDEN: 'POLICY_BLOCKED',
                UPLOAD_EXPIRED: 'PUT_EXPIRED',
              } as Record<string, string>
            )[apiError.code] ??
            (retryable ? 'SERVICE_UNAVAILABLE' : 'UPLOAD_REJECTED'))
          : retryable
            ? 'NETWORK_ERROR'
            : 'LOCAL_IO'));
    await this.options.repository.update(id, {
      uploadStatus: auth
        ? 'auth_required'
        : retryable
          ? 'retry_wait'
          : 'failed',
      uploadAttempts: attempts,
      uploadError: code,
      uploadRetryAt: retryable
        ? new Date(this.now() + Math.min(delay, 86400000 * 365)).toISOString()
        : null,
    });
    this.options.onChanged?.();
  }
}

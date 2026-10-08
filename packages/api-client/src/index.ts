import { z } from 'zod';
import {
  healthResponseSchema,
  apiErrorSchema,
  meSchema,
  deviceInputSchema,
  deviceSchema,
  uploadInputSchema,
  uploadSessionSchema,
  screenshotPageSchema,
  screenshotQuerySchema,
  screenshotDetailSchema,
  screenshotPatchSchema,
  tagInputSchema,
  tagSchema,
  shareInputSchema,
  shareStatusSchema,
  shareCreatedSchema,
  publicShareSchema,
  idSchema,
  shareTokenSchema,
  type ErrorCode,
  type ScreenshotQuery,
} from '@screenstash/shared';

export type SessionTokenProvider = () => Promise<string | null>;
export interface ApiClientOptions {
  baseUrl: string;
  getSessionToken?: SessionTokenProvider;
  fetch?: typeof fetch;
}
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const transport = options.fetch ?? fetch;
  async function request<T>(
    route: string,
    schema: z.ZodType<T> | null,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
    authenticated = true,
  ): Promise<T> {
    const token = authenticated ? await options.getSessionToken?.() : null;
    if (authenticated && !token)
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.', false);
    const response = await transport(`${baseUrl}${route}`, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (parsed.success) {
        const error = parsed.data.error;
        throw new ApiError(
          response.status,
          error.code,
          error.message,
          error.retryable,
          error.requestId,
        );
      }
      throw new ApiError(
        response.status,
        'DEPENDENCY_UNAVAILABLE',
        'The service returned an unexpected response.',
        response.status >= 500,
      );
    }
    if (!schema) return undefined as T;
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success)
      throw new ApiError(
        502,
        'DEPENDENCY_UNAVAILABLE',
        'The service returned an invalid response.',
        true,
      );
    return parsed.data;
  }
  const owned = (id: string) => idSchema.parse(id);
  return {
    health: (signal?: AbortSignal) =>
      request(
        '/api/health',
        healthResponseSchema,
        'GET',
        undefined,
        signal,
        false,
      ),
    me: (signal?: AbortSignal) =>
      request('/api/me', meSchema, 'GET', undefined, signal),
    registerDevice: (
      input: z.input<typeof deviceInputSchema>,
      signal?: AbortSignal,
    ) =>
      request(
        '/api/devices',
        deviceSchema,
        'POST',
        deviceInputSchema.parse(input),
        signal,
      ),
    createUpload: (
      input: z.input<typeof uploadInputSchema>,
      signal?: AbortSignal,
    ) =>
      request(
        '/api/upload-sessions',
        uploadSessionSchema,
        'POST',
        uploadInputSchema.parse(input),
        signal,
      ),
    uploadStatus: (id: string, signal?: AbortSignal) =>
      request(
        `/api/upload-sessions/${owned(id)}`,
        uploadSessionSchema,
        'GET',
        undefined,
        signal,
      ),
    renewUpload: (id: string, signal?: AbortSignal) =>
      request(
        `/api/upload-sessions/${owned(id)}/renew`,
        uploadSessionSchema,
        'POST',
        {},
        signal,
      ),
    finalizeUpload: (id: string, signal?: AbortSignal) =>
      request(
        `/api/upload-sessions/${owned(id)}/finalize`,
        screenshotDetailSchema,
        'POST',
        {},
        signal,
      ),
    screenshots(query: ScreenshotQuery = {}, signal?: AbortSignal) {
      const parsed = screenshotQuerySchema.parse(query);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value))
          for (const id of value) params.append(key, id);
        else if (value !== undefined) params.set(key, String(value));
      }
      return request(
        `/api/screenshots?${params}`,
        screenshotPageSchema,
        'GET',
        undefined,
        signal,
      );
    },
    screenshot: (id: string, signal?: AbortSignal) =>
      request(
        `/api/screenshots/${owned(id)}`,
        screenshotDetailSchema,
        'GET',
        undefined,
        signal,
      ),
    updateScreenshot: (
      id: string,
      input: z.input<typeof screenshotPatchSchema>,
      signal?: AbortSignal,
    ) =>
      request(
        `/api/screenshots/${owned(id)}`,
        screenshotDetailSchema,
        'PATCH',
        screenshotPatchSchema.parse(input),
        signal,
      ),
    deleteScreenshot: (id: string, signal?: AbortSignal) =>
      request<void>(
        `/api/screenshots/${owned(id)}`,
        null,
        'DELETE',
        {},
        signal,
      ),
    tags: (signal?: AbortSignal) =>
      request('/api/tags', z.array(tagSchema), 'GET', undefined, signal),
    createTag: (input: z.input<typeof tagInputSchema>, signal?: AbortSignal) =>
      request(
        '/api/tags',
        tagSchema,
        'POST',
        tagInputSchema.parse(input),
        signal,
      ),
    shareStatus: (id: string, signal?: AbortSignal) =>
      request(
        `/api/screenshots/${owned(id)}/share`,
        shareStatusSchema,
        'GET',
        undefined,
        signal,
      ),
    createShare: (
      id: string,
      input: z.input<typeof shareInputSchema>,
      signal?: AbortSignal,
    ) =>
      request(
        `/api/screenshots/${owned(id)}/share`,
        shareCreatedSchema,
        'POST',
        shareInputSchema.parse(input),
        signal,
      ),
    revokeShare: (id: string, signal?: AbortSignal) =>
      request<void>(
        `/api/screenshots/${owned(id)}/share`,
        null,
        'DELETE',
        {},
        signal,
      ),
    publicShare: (token: string, signal?: AbortSignal) =>
      request(
        `/api/public/shares/${shareTokenSchema.parse(token)}`,
        publicShareSchema,
        'GET',
        undefined,
        signal,
        false,
      ),
  };
}

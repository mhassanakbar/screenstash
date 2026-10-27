import { describe, expect, it, vi } from 'vitest';
import {
  createApiClient,
  ApiError,
  parseRetryAfter,
} from '@screenstash/api-client';
import { randomUUID } from 'node:crypto';

describe('API transport', () => {
  it('parses Retry-After seconds and dates without retaining headers', () => {
    const now = Date.parse('2026-10-26T10:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120000);
    expect(parseRetryAfter('Mon, 26 Oct 2026 10:02:00 GMT', now)).toBe(120000);
    expect(parseRetryAfter('Mon, 26 Oct 2026 09:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('not a date', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
  it('does not send an acquired token after cancellation', async () => {
    const controller = new AbortController();
    const transport = vi.fn();
    const client = createApiClient({
      baseUrl: '',
      fetch: transport,
      getSessionToken: async () => {
        controller.abort();
        return 'secret';
      },
    });
    await expect(client.me(controller.signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not request private data without a session token', async () => {
    const transport = vi.fn();
    const client = createApiClient({ baseUrl: '/api-host', fetch: transport });
    await expect(client.me()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it('gets a fresh bearer token per call and carries abort signals', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: randomUUID(), clerkUserId: 'user_fixture' }),
        ),
      );
    const token = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const client = createApiClient({
      baseUrl: '',
      fetch: transport,
      getSessionToken: token,
    });
    const controller = new AbortController();
    await client.me(controller.signal);
    transport.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: randomUUID(), clerkUserId: 'user_fixture' }),
      ),
    );
    await client.me();
    expect(transport.mock.calls[0]?.[1].headers.Authorization).toBe(
      'Bearer first',
    );
    expect(transport.mock.calls[1]?.[1].headers.Authorization).toBe(
      'Bearer second',
    );
    expect(transport.mock.calls[0]?.[1].signal).toBe(controller.signal);
  });
  it('surfaces structured retryable errors and hides non-JSON provider responses', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Try later.',
            retryable: true,
            requestId: 'fixture',
          },
        }),
        { status: 429 },
      ),
    );
    const client = createApiClient({
      baseUrl: '',
      fetch: transport,
      getSessionToken: async () => 'token',
    });
    await expect(client.me()).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryable: true,
    });
    transport.mockResolvedValueOnce(
      new Response('secret proxy diagnostic', { status: 502 }),
    );
    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
  });
});

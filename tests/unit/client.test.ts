import { describe, expect, it, vi } from 'vitest';
import { createApiClient, ApiError } from '@screenstash/api-client';
import { randomUUID } from 'node:crypto';

describe('API transport', () => {
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

import { describe, expect, it, vi, afterEach } from 'vitest';
import path from 'node:path';
import type { WebContents } from 'electron';
import {
  configuredHttpOrigin,
  trustedRendererUrl,
  resolveRendererAsset,
} from '../../apps/desktop/src/main/security';
import { TokenBroker } from '../../apps/desktop/src/main/auth/broker';

afterEach(() => vi.useRealTimers());
describe('Desktop trust boundaries', () => {
  it('accepts only the exact packaged host or configured development origin', () => {
    expect(trustedRendererUrl('screenstash://renderer/index.html')).toBe(true);
    for (const value of [
      'file:///index.html',
      'screenstash://other/index.html',
      'https://renderer/index.html',
      'screenstash://user@renderer/index.html',
      'screenstash://renderer:42/index.html',
    ])
      expect(trustedRendererUrl(value)).toBe(false);
    expect(
      trustedRendererUrl('http://localhost:5173/a', 'http://localhost:5173'),
    ).toBe(true);
    expect(
      trustedRendererUrl('http://localhost:5174/a', 'http://localhost:5173'),
    ).toBe(false);
  });
  it('blocks encoded traversal and ambiguous asset paths', () => {
    const root = path.resolve('test-results/assets');
    expect(
      resolveRendererAsset(root, 'screenstash://renderer/index.html'),
    ).toBe(path.join(root, 'index.html'));
    for (const value of [
      'screenstash://renderer/%2e%2e%2fsecret',
      'screenstash://renderer/a%5csecret',
      'screenstash://renderer/a%00secret',
      'screenstash://renderer/C%3a/secret',
      'screenstash://other/index.html',
    ])
      expect(() => resolveRendererAsset(root, value)).toThrow();
  });
  it('permits loopback HTTP only in development and rejects credential-bearing service URLs', () => {
    expect(configuredHttpOrigin('http://localhost:4000', true)).toBe(
      'http://localhost:4000',
    );
    for (const value of [
      'http://example.com',
      'https://user:secret@example.com',
      'https://example.com/api',
      'https://example.com?token=secret',
    ])
      expect(() => configuredHttpOrigin(value, false)).toThrow();
  });
  it('correlates ephemeral tokens and drops replies after account generation changes', async () => {
    const send = vi.fn(),
      renderer = { send, isDestroyed: () => false } as unknown as WebContents;
    const broker = new TokenBroker(() => renderer);
    const first = broker.request(),
      firstId = send.mock.calls[0]![1].requestId;
    broker.invalidate();
    broker.accept({ requestId: firstId, token: 'old credential' });
    expect(await first).toBeNull();
    const second = broker.request(),
      id = send.mock.calls[1]![1].requestId;
    broker.accept({ requestId: firstId, token: 'wrong request' });
    broker.accept({ requestId: id, token: 'current credential' });
    expect(await second).toBe('current credential');
  });
  it('bounds token waits when the auth renderer is unavailable', async () => {
    vi.useFakeTimers();
    const broker = new TokenBroker(
      () =>
        ({ send: vi.fn(), isDestroyed: () => false }) as unknown as WebContents,
    );
    const result = broker.request();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeNull();
    expect(await new TokenBroker(() => undefined).request()).toBeNull();
  });
});

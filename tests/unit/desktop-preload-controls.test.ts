import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  queueChannels,
  defaultDesktopSettings,
  type QueueBridge,
} from '../../apps/desktop/src/contracts/queue';

const mocks = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}));
vi.mock('@clerk/electron/preload', () => ({ exposeClerkBridge: vi.fn() }));
await import('../../apps/desktop/src/preload/index');
const bridge = mocks.expose.mock.calls[0]?.[1] as QueueBridge;

describe('Narrow queue preload bridge', () => {
  it('exposes only named operations and validates settings in both directions', async () => {
    expect(Object.isFrozen(bridge)).toBe(true);
    expect('invoke' in bridge).toBe(false);
    mocks.invoke.mockResolvedValueOnce(defaultDesktopSettings);
    await expect(bridge.settings()).resolves.toEqual(defaultDesktopSettings);
    expect(mocks.invoke).toHaveBeenLastCalledWith(queueChannels.settings);
    const before = mocks.invoke.mock.calls.length;
    await expect(
      bridge.updateSettings({ paused: 'yes' } as never),
    ).rejects.toThrow();
    await expect(
      bridge.updateSettings({ owner: 'another-account' } as never),
    ).rejects.toThrow();
    expect(mocks.invoke.mock.calls.length).toBe(before);
    mocks.invoke.mockResolvedValueOnce({ paused: true });
    await expect(bridge.settings()).rejects.toThrow();
  });

  it('rejects arbitrary paths/IDs and unexpected action responses', async () => {
    const before = mocks.invoke.mock.calls.length;
    await expect(bridge.retryCapture('../private.png')).rejects.toThrow();
    await expect(bridge.uploadNow('not-an-id')).rejects.toThrow();
    expect(mocks.invoke.mock.calls.length).toBe(before);
    const id = randomUUID();
    mocks.invoke.mockResolvedValueOnce(undefined);
    await expect(bridge.uploadNow(id)).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenLastCalledWith(queueChannels.uploadNow, id);
    mocks.invoke.mockResolvedValueOnce({ secret: 'not-allowed' });
    await expect(bridge.retryCapture(id)).rejects.toThrow();
  });

  it('discards settings event payloads and unregisters the exact listener', () => {
    const listener = vi.fn();
    const unsubscribe = bridge.onSettingsChanged(listener);
    const [channel, handler] = mocks.on.mock.lastCall as [
      string,
      (...args: unknown[]) => void,
    ];
    expect(channel).toBe(queueChannels.settingsChanged);
    handler({ sender: 'untrusted' }, { token: 'never-forward' });
    expect(listener).toHaveBeenCalledWith();
    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith(channel, handler);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { CaptureShortcuts } from '../../apps/desktop/src/main/capture/shortcuts';

function fixture(supported = true) {
  let saved = false;
  const occupied = new Set<string>();
  const callbacks = new Map<string, () => void>();
  const registry = {
    register: vi.fn((key: string, callback: () => void) => {
      if (occupied.has(key) || callbacks.has(key)) return false;
      callbacks.set(key, callback);
      return true;
    }),
    unregister: vi.fn((key: string) => {
      callbacks.delete(key);
    }),
  };
  const capture = vi.fn();
  const preference = {
    read: () => saved,
    write: vi.fn((enabled: boolean) => {
      saved = enabled;
    }),
  };
  const create = () =>
    new CaptureShortcuts(supported, registry, capture, preference);
  return { create, occupied, callbacks, registry, capture, preference };
}
describe('Print Screen shortcut setup', () => {
  it('opts in, preserves fallback keys, maps capture modes and restores preference on restart', () => {
    const f = fixture(),
      shortcuts = f.create();
    shortcuts.initialize();
    expect([...f.callbacks.keys()]).toEqual([
      'Control+Shift+1',
      'Control+Shift+2',
    ]);
    shortcuts.configure(true);
    f.callbacks.get('PrintScreen')!();
    f.callbacks.get('Shift+PrintScreen')!();
    expect(f.capture.mock.calls).toEqual([['region'], ['display']]);
    shortcuts.dispose();
    const restarted = f.create();
    restarted.initialize();
    expect(restarted.state().printScreen.enabled).toBe(true);
    expect(restarted.state().shortcuts).toHaveLength(4);
    restarted.configure(false);
    expect([...f.callbacks.keys()]).toEqual([
      'Control+Shift+1',
      'Control+Shift+2',
    ]);
    restarted.dispose();
    const disabled = f.create();
    disabled.initialize();
    expect(disabled.state().printScreen.enabled).toBe(false);
  });
  it('reports conflicts, retries without duplicate registration and releases only owned shortcuts', () => {
    const f = fixture(),
      shortcuts = f.create();
    f.occupied.add('PrintScreen');
    shortcuts.initialize();
    shortcuts.configure(true);
    expect(
      shortcuts
        .state()
        .shortcuts.find((value) => value.accelerator === 'PrintScreen')
        ?.registered,
    ).toBe(false);
    shortcuts.dispose();
    expect(f.registry.unregister).not.toHaveBeenCalledWith('PrintScreen');
    shortcuts.initialize();
    f.occupied.clear();
    f.registry.register.mockClear();
    shortcuts.configure(true);
    expect(f.registry.register.mock.calls.map(([key]) => key)).toEqual([
      'PrintScreen',
    ]);
    expect(shortcuts.state().shortcuts.every((value) => value.registered)).toBe(
      true,
    );
  });
  it('rejects unsupported platforms and leaves bindings intact when saving fails', () => {
    const unsupported = fixture(false),
      shortcuts = unsupported.create();
    shortcuts.initialize();
    expect(() => shortcuts.configure(true)).toThrow('requires Windows');
    expect(unsupported.preference.write).not.toHaveBeenCalled();
    const f = fixture(),
      windows = f.create();
    windows.initialize();
    f.preference.write.mockImplementation(() => {
      throw new Error('Disk full');
    });
    expect(() => windows.configure(true)).toThrow('Disk full');
    expect(windows.state().printScreen.enabled).toBe(false);
    expect([...f.callbacks.keys()]).toEqual([
      'Control+Shift+1',
      'Control+Shift+2',
    ]);
  });
});

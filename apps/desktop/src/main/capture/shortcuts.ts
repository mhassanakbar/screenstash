type Mode = 'display' | 'region';
interface Registry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}
export class CaptureShortcuts {
  private enabled = false;
  private bindings = [
    {
      mode: 'display' as Mode,
      accelerator: 'Control+Shift+1',
      registered: false,
    },
    {
      mode: 'region' as Mode,
      accelerator: 'Control+Shift+2',
      registered: false,
    },
    { mode: 'region' as Mode, accelerator: 'PrintScreen', registered: false },
    {
      mode: 'display' as Mode,
      accelerator: 'Shift+PrintScreen',
      registered: false,
    },
  ];
  constructor(
    readonly supported: boolean,
    private registry: Registry,
    private capture: (mode: Mode) => void,
    private preference: { read(): boolean; write(enabled: boolean): void },
  ) {}
  initialize() {
    this.enabled = this.supported && this.preference.read() === true;
    this.register();
  }
  configure(enabled: boolean) {
    if (!this.supported) throw new Error('Print Screen setup requires Windows');
    // Persist first: a failed write must leave the active bindings unchanged.
    this.preference.write(enabled);
    this.enabled = enabled;
    if (!enabled) {
      for (const shortcut of this.bindings.slice(2)) {
        if (shortcut.registered) this.registry.unregister(shortcut.accelerator);
        shortcut.registered = false;
      }
    }
    this.register();
  }
  private register() {
    for (const shortcut of this.activeBindings()) {
      if (shortcut.registered) continue;
      try {
        shortcut.registered = this.registry.register(shortcut.accelerator, () =>
          this.capture(shortcut.mode),
        );
      } catch {
        shortcut.registered = false;
      }
    }
  }
  private activeBindings() {
    return this.enabled ? this.bindings : this.bindings.slice(0, 2);
  }
  state() {
    return {
      printScreen: { supported: this.supported, enabled: this.enabled },
      shortcuts: this.activeBindings().map((shortcut) => ({ ...shortcut })),
    };
  }
  dispose() {
    for (const shortcut of this.bindings) {
      if (shortcut.registered) this.registry.unregister(shortcut.accelerator);
      shortcut.registered = false;
    }
  }
}

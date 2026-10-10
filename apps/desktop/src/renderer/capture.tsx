import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { captureStateSchema, CaptureCode } from '../contracts/capture';

const errors: Record<CaptureCode, string> = {
  CAPTURE_BUSY: 'A capture is already in progress.',
  DISPLAY_CHANGED: 'The display changed during capture. Please try again.',
  SCREEN_LOCKED: 'Unlock Windows before taking a screenshot.',
  SOURCE_UNAVAILABLE: 'This display could not be captured. Please try again.',
  RESOLUTION_UNSUPPORTED:
    'Windows returned a smaller image than this display. Capture was stopped to preserve image quality.',
  CAPTURE_TOO_LARGE: 'This display exceeds the supported capture size.',
  SAVE_FAILED:
    'The screenshot could not be saved. Check free disk space and access to the local capture folder.',
  SELECTION_FAILED: 'The selection window could not open. Please try again.',
};
export function CaptureWorkspace() {
  const [state, setState] = useState<z.infer<typeof captureStateSchema> | null>(
    null,
  );
  const [message, setMessage] = useState(''),
    [loading, setLoading] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const configurePrintScreen = async (enabled: boolean) => {
    setSetupBusy(true);
    setSetupMessage('');
    try {
      const value = await window.screenstash.setPrintScreenEnabled(enabled);
      setState(value);
      const available = value.shortcuts
        .filter((shortcut) => shortcut.accelerator.includes('PrintScreen'))
        .every((shortcut) => shortcut.registered);
      setSetupMessage(
        !enabled
          ? 'Print Screen shortcuts disabled in ScreenStash.'
          : available
            ? 'Print Screen shortcuts registered. Try Print Screen to select a region.'
            : 'A Print Screen shortcut is unavailable. Check the Windows toggle and other screenshot apps, then retry.',
      );
    } catch {
      setSetupMessage('Shortcut setup could not be saved. Please try again.');
    } finally {
      setSetupBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void window.screenstash
        .captureState()
        .then((value) => {
          if (active) setState(value);
        })
        .catch(() => {
          if (active) setMessage('Local screenshots could not be loaded.');
        });
    };
    const unsubscribe = window.screenstash.onCapturesChanged(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const capture = async (mode: 'display' | 'region') => {
    setLoading(true);
    setMessage('');
    try {
      const result = await window.screenstash.capture(mode);
      setMessage(
        result.status === 'saved'
          ? 'Saved locally.'
          : result.status === 'cancelled'
            ? 'Capture cancelled.'
            : errors[result.code],
      );
    } catch {
      setMessage('Capture could not be completed. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <section className="panel" aria-label="Screenshot capture">
        <h2>Take a screenshot</h2>
        <p>
          Capture the display containing your pointer, or select a region on it.
          Screenshots save locally while offline or signed out.
        </p>
        <div className="actions">
          <button
            disabled={loading || state?.busy}
            onClick={() => void capture('display')}
          >
            Capture display
          </button>
          <button
            className="secondary"
            disabled={loading || state?.busy}
            onClick={() => void capture('region')}
          >
            Select region
          </button>
        </div>
        <p className="shortcut-help">
          {state?.shortcuts.map((shortcut) => (
            <span key={shortcut.accelerator}>
              {shortcut.mode === 'display' ? 'Full display' : 'Region'}:{' '}
              <kbd>
                {shortcut.accelerator
                  .replaceAll('Control', 'Ctrl')
                  .replaceAll('+', ' + ')}
              </kbd>
              {!shortcut.registered &&
                ' (unavailable — another app may be using it)'}
              <br />
            </span>
          ))}
        </p>
        {message && <p role="status">{message}</p>}
        {state?.error && !message && <p role="alert">{errors[state.error]}</p>}
        {state?.busy && <p role="status">Capture in progress…</p>}
      </section>
      {state?.printScreen.supported && (
        <section className="panel" aria-label="Print Screen shortcut setup">
          <h2>Use Print Screen</h2>
          <p>
            Print Screen selects a region. Shift + Print Screen captures the
            full display. ScreenStash must be running.
          </p>
          {!setupOpen && !state.printScreen.enabled ? (
            <button onClick={() => setSetupOpen(true)}>
              Set up Print Screen
            </button>
          ) : (
            <>
              <ol>
                <li>Open Windows keyboard settings.</li>
                <li>
                  Turn off “Use the Print Screen button to open screen snipping”
                  (the wording may vary).
                </li>
                <li>Return here and enable the ScreenStash shortcuts.</li>
              </ol>
              <p>
                ScreenStash opens the settings page; you control the Windows
                toggle. Ctrl + Shift + 1/2 remain available.
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={setupBusy}
                  onClick={() => {
                    void window.screenstash
                      .openKeyboardSettings()
                      .catch(() =>
                        setSetupMessage(
                          'Windows settings could not open. Go to Settings → Accessibility → Keyboard.',
                        ),
                      );
                  }}
                >
                  Open Windows keyboard settings
                </button>
                <button
                  disabled={setupBusy}
                  onClick={() => void configurePrintScreen(true)}
                >
                  {state.printScreen.enabled
                    ? 'Retry Print Screen shortcuts'
                    : 'Enable Print Screen shortcuts'}
                </button>
                {state.printScreen.enabled && (
                  <button
                    className="secondary"
                    disabled={setupBusy}
                    onClick={() => void configurePrintScreen(false)}
                  >
                    Disable Print Screen shortcuts
                  </button>
                )}
              </div>
              {state.printScreen.enabled && (
                <p>
                  Disabling these shortcuts in ScreenStash leaves your Windows
                  toggle as you set it.
                </p>
              )}
              {setupMessage && <p role="status">{setupMessage}</p>}
            </>
          )}
        </section>
      )}
      <section className="panel" aria-label="Local screenshots">
        <div className="section-heading">
          <h2>Local screenshots</h2>
          <span>{state?.captures.length ?? 0} saved</span>
        </div>
        <p>
          Original PNGs are retained on this computer. Cloud upload and text
          recognition will be connected in the next steps.
        </p>
        {!!state?.recoveryWarnings && (
          <p role="alert">
            {state.recoveryWarnings} local record(s) need attention. Original
            files have been retained; recovered screenshots with unknown
            ownership stay unassigned.
          </p>
        )}
        {state && (
          <p className="storage-note">
            {(state.localBytes / 1048576).toFixed(1)} MB of 1,024 MB local
            storage used across accounts.
          </p>
        )}
        {!state?.captures.length && (
          <p>Your saved screenshots will appear here.</p>
        )}
        <ul className="capture-list">
          {state?.captures.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>
                  {item.width} × {item.height} pixels ·{' '}
                  {(item.sizeBytes / 1024).toFixed(0)} KB ·{' '}
                  {item.mode === 'region'
                    ? 'Region'
                    : item.mode === 'display'
                      ? 'Full display'
                      : 'Recovered image'}
                </p>
                <p>
                  {item.assigned
                    ? 'Saved for your account'
                    : 'Unassigned — stored locally'}
                  {!item.uploadEligible && ' · Too large for cloud upload'}
                </p>
              </div>
              <button
                className="secondary"
                onClick={() =>
                  void window.screenstash
                    .revealCapture(item.id)
                    .catch(() =>
                      setMessage('This local file is missing or damaged.'),
                    )
                }
              >
                Show in folder
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

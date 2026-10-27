import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { captureStateSchema, CaptureCode } from '../contracts/capture';
import { isTerminalUploadError } from '../contracts/capture';
import type { DesktopBridge } from '../contracts/bridge';
import type {
  DesktopSettings,
  DesktopSettingsPatch,
  QueueBridge,
} from '../contracts/queue';
import { Icon } from './icons';

const desktop = window.screenstash as DesktopBridge & QueueBridge;
const statusLabels: Record<string, string> = {
  pending: 'Queued',
  processing: 'Recognizing text',
  complete: 'Complete',
  authorizing: 'Preparing upload',
  uploading: 'Uploading image',
  finalizing: 'Confirming upload',
  retry_wait: 'Waiting to retry',
  auth_required: 'Reconnect your account',
  paused: 'Paused',
  failed: 'Needs attention',
  synced: 'Synced to vault',
};

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
  const [stateLoadError, setStateLoadError] = useState(false);
  const [message, setMessage] = useState(''),
    [loading, setLoading] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [queueMessage, setQueueMessage] = useState('');
  const updateSettings = async (patch: DesktopSettingsPatch) => {
    setSettingsBusy(true);
    setSettingsMessage('');
    try {
      setSettings(await desktop.updateSettings(patch));
      setSettingsMessage('Settings saved.');
    } catch {
      setSettingsMessage(
        'Settings could not be saved. Startup requires the installed Windows app.',
      );
    } finally {
      setSettingsBusy(false);
    }
  };
  const queueAction = async (id: string, action: 'retry' | 'upload') => {
    setPendingAction(id);
    setQueueMessage('');
    try {
      if (action === 'retry') await desktop.retryCapture(id);
      else await desktop.uploadNow(id);
      setQueueMessage(
        'Request queued. Processing resumes when your account is connected and processing is not paused.',
      );
    } catch {
      setQueueMessage(
        'This request could not be completed. Reconnect your account and try again.',
      );
    } finally {
      setPendingAction(null);
    }
  };
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void desktop
        .settings()
        .then((value) => {
          if (active && current === request) setSettings(value);
        })
        .catch(() => {
          if (active && current === request)
            setSettingsMessage('Settings could not be loaded.');
        });
    };
    const unsubscribe = desktop.onSettingsChanged(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const configurePrintScreen = async (enabled: boolean) => {
    setSetupBusy(true);
    setSetupMessage('');
    try {
      const value = await window.screenstash.setPrintScreenEnabled(enabled);
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
    let request = 0;
    const refresh = () => {
      const current = ++request;
      setState(null);
      setStateLoadError(false);
      void window.screenstash
        .captureState()
        .then((value) => {
          if (active && current === request) setState(value);
        })
        .catch(() => {
          if (active && current === request) {
            setStateLoadError(true);
            setMessage('Local screenshots could not be loaded.');
          }
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
      <section
        className="capture-panel"
        id="capture"
        aria-label="Screenshot capture"
      >
        <div className="capture-panel-top">
          <span className="capture-symbol">
            <Icon name="capture" size={22} />
          </span>
          <span className="section-kicker">READY WHEN YOU ARE</span>
        </div>
        <h2>
          Capture your screen.
          <br />
          <em>Keep your flow.</em>
        </h2>
        <p className="capture-intro">
          Capture the display containing your pointer, or select a region on it.
          Screenshots save locally while offline or signed out.
        </p>
        <div className="capture-actions">
          <button
            className="capture-action capture-action-primary"
            aria-label="Capture display"
            disabled={loading || state?.busy}
            onClick={() => void capture('display')}
          >
            <span className="action-icon">
              <Icon name="capture" size={24} />
            </span>
            <span>
              Capture display<small>Everything in view</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
          <button
            className="capture-action capture-action-secondary"
            aria-label="Select region"
            disabled={loading || state?.busy}
            onClick={() => void capture('region')}
          >
            <span className="action-icon">
              <Icon name="region" size={24} />
            </span>
            <span>
              Select region<small>Just what matters</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        </div>
        <div className="shortcut-help">
          <span className="shortcut-title">
            <Icon name="keyboard" size={17} /> KEYBOARD SHORTCUTS
          </span>
          <div className="shortcut-values">
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
          </div>
        </div>
        {message && <p role="status">{message}</p>}
        {state?.error && !message && <p role="alert">{errors[state.error]}</p>}
        {state?.busy && <p role="status">Capture in progress…</p>}
      </section>
      {state?.printScreen.supported && (
        <section
          className="print-panel"
          aria-label="Print Screen shortcut setup"
        >
          <div className="side-heading">
            <span className="side-icon">
              <Icon name="keyboard" size={19} />
            </span>
            <h2>Use Print Screen</h2>
          </div>
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
      <section
        className="queue-panel"
        id="queue"
        aria-label="Local screenshots"
      >
        <div className="section-heading">
          <div>
            <p className="section-kicker">YOUR LOCAL LIBRARY</p>
            <h2>Capture queue</h2>
          </div>
          <span className="count-pill">
            {state?.captures.length ?? 0} saved
          </span>
        </div>
        <p>
          Original PNGs stay on this computer after sync. Unassigned screenshots
          remain local; no account is assigned automatically.
        </p>
        {settings?.paused && (
          <p className="queue-notice" role="status">
            Background processing is paused. Resume it in Desktop settings or
            the tray.
          </p>
        )}
        {queueMessage && <p role="status">{queueMessage}</p>}
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
        {!state && !stateLoadError && (
          <div className="queue-empty" role="status">
            <span className="empty-art">
              <Icon name="image" size={28} />
            </span>
            <strong>Loading local screenshots…</strong>
          </div>
        )}
        {state && !state.captures.length && (
          <div className="queue-empty">
            <span className="empty-art">
              <Icon name="image" size={28} />
            </span>
            <strong>Nothing in your queue yet</strong>
            <p>
              Your saved screenshots will appear here after your first capture.
            </p>
          </div>
        )}
        {!state && stateLoadError && (
          <div className="queue-empty error">
            <span className="empty-art">
              <Icon name="image" size={28} />
            </span>
            <strong>Couldn’t load local screenshots</strong>
            <p>Local screenshots could not be loaded.</p>
          </div>
        )}
        <ul className="capture-list">
          {state?.captures.map((item) => (
            <li key={item.id}>
              <span className="list-image">
                <Icon name="image" size={22} />
              </span>
              <div className="capture-details">
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
                <div
                  className="capture-statuses"
                  aria-label="Processing status"
                >
                  <span className={`status-badge status-${item.ocrStatus}`}>
                    OCR: {statusLabels[item.ocrStatus] ?? 'Queued'}
                  </span>
                  <span
                    className={`status-badge status-${item.assigned ? item.uploadStatus : 'unassigned'}`}
                  >
                    Upload:{' '}
                    {item.assigned
                      ? (statusLabels[item.uploadStatus] ?? 'Queued')
                      : 'Unassigned'}
                  </span>
                </div>
                {item.uploadRetryAt && (
                  <p>
                    Next upload attempt:{' '}
                    {new Date(item.uploadRetryAt).toLocaleString()}
                  </p>
                )}
                {item.uploadAttempts > 0 && (
                  <p>Upload attempts: {item.uploadAttempts}</p>
                )}
                {item.ocrTruncated && (
                  <p>
                    Recognized text reached the supported limit; the original
                    image is unchanged.
                  </p>
                )}
                {isTerminalUploadError(item.uploadError) && (
                  <p className="queue-error">
                    Cloud upload is unavailable for this capture. Your local
                    original is retained.
                  </p>
                )}
                {!isTerminalUploadError(item.uploadError) &&
                  (String(item.ocrStatus) === 'failed' ||
                    String(item.uploadStatus) === 'failed') && (
                    <p className="queue-error">
                      Processing failed. Your original is retained; retry when
                      ready.
                    </p>
                  )}
              </div>
              <div className="queue-actions">
                {!isTerminalUploadError(item.uploadError) &&
                  (String(item.ocrStatus) === 'failed' ||
                    ['failed', 'retry_wait', 'auth_required'].includes(
                      item.uploadStatus,
                    )) && (
                    <button
                      className="secondary"
                      disabled={
                        pendingAction !== null || settings?.paused || !settings
                      }
                      onClick={() => void queueAction(item.id, 'retry')}
                    >
                      Retry processing
                    </button>
                  )}
                {!isTerminalUploadError(item.uploadError) &&
                  item.assigned &&
                  item.uploadEligible &&
                  [
                    'pending',
                    'paused',
                    'retry_wait',
                    'failed',
                    'auth_required',
                  ].includes(item.uploadStatus) && (
                    <button
                      disabled={
                        pendingAction !== null || settings?.paused || !settings
                      }
                      onClick={() => void queueAction(item.id, 'upload')}
                    >
                      Upload now
                    </button>
                  )}
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
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section
        className="settings-panel"
        id="desktop-settings"
        aria-label="Desktop settings"
        tabIndex={-1}
      >
        <p className="section-kicker">MAKE IT YOURS</p>
        <h2>Desktop settings</h2>
        <p>
          Closing this window keeps ScreenStash running in the tray. Use the
          tray menu to quit.
        </p>
        <div className="settings-controls" aria-busy={settingsBusy}>
          <label>
            <input
              type="checkbox"
              checked={settings?.autoUpload ?? true}
              disabled={!settings || settingsBusy}
              onChange={(event) =>
                void updateSettings({ autoUpload: event.target.checked })
              }
            />{' '}
            Automatically upload new screenshots
          </label>
          <p>
            Turning this off keeps captures local until you choose Upload now.
          </p>
          <label>
            <input
              type="checkbox"
              checked={settings?.paused ?? false}
              disabled={!settings || settingsBusy}
              onChange={(event) =>
                void updateSettings({ paused: event.target.checked })
              }
            />{' '}
            Pause background processing
          </label>
          <p>Local capture stays available while processing is paused.</p>
          <label>
            <input
              type="checkbox"
              checked={settings?.startup ?? false}
              disabled={!settings || settingsBusy}
              onChange={(event) =>
                void updateSettings({ startup: event.target.checked })
              }
            />{' '}
            Start ScreenStash in the tray when I sign in to Windows
          </label>
          <p>Optional. Off by default; requires the installed Windows app.</p>
        </div>
        {settingsMessage && <p role="status">{settingsMessage}</p>}
      </section>
    </>
  );
}

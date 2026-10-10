import { createRoot } from 'react-dom/client';
import { useState, useEffect, useRef } from 'react';
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
} from '@clerk/electron/react';
import { APP_NAME } from '@screenstash/shared';
import type { z } from 'zod';
import type { captureProbeSchema } from '../contracts/bridge';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');
function Authentication() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [state, setState] = useState('Checking your session…');
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(
    () => window.screenstash.onTokenRequest(() => getToken()),
    [getToken],
  );
  useEffect(() => {
    if (!isLoaded || previous.current === userId) return;
    previous.current = userId;
    let cancelled = false;
    void window.screenstash.invalidateAuthentication().then(async () => {
      if (!isSignedIn) {
        if (!cancelled) setState('Sign in to connect your private vault.');
        return;
      }
      if (!cancelled) setState('Connecting to your vault…');
      try {
        await window.screenstash.authenticate();
        if (!cancelled) setState('Your private vault is connected.');
      } catch {
        if (!cancelled)
          setState('Your session is ready, but the vault could not connect.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, userId]);
  return (
    <section className="panel" aria-label="Account">
      <h2>Account</h2>
      <p role="status">{state}</p>
      {isLoaded &&
        (isSignedIn ? (
          <div className="actions">
            <UserButton />
            <button
              onClick={async () => {
                try {
                  await window.screenstash.authenticate();
                  setState('Your private vault is connected.');
                } catch {
                  setState('The vault could not connect. Please try again.');
                }
              }}
            >
              Reconnect
            </button>
          </div>
        ) : (
          <div className="actions">
            <SignInButton mode="modal">
              <button>Sign in</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="secondary">Create account</button>
            </SignUpButton>
          </div>
        ))}
    </section>
  );
}
function LocalShell() {
  const [probe, setProbe] = useState<z.infer<typeof captureProbeSchema> | null>(
      null,
    ),
    [probing, setProbing] = useState(false),
    [message, setMessage] = useState('');
  return (
    <main>
      <header>
        <p className="eyebrow">Your private screenshot workspace</p>
        <h1>{APP_NAME}</h1>
        <p>Desktop setup</p>
      </header>
      <section className="panel">
        <h2>Display capture check</h2>
        <p>
          Check the resolution of the display containing your pointer. This
          check does not save or upload an image.
        </p>
        <button
          disabled={probing}
          onClick={async () => {
            setProbing(true);
            setMessage('');
            try {
              setProbe(await window.screenstash.probeCapture());
            } catch {
              setMessage('The display could not be checked. Please try again.');
            } finally {
              setProbing(false);
            }
          }}
        >
          {probing ? 'Checking display…' : 'Check display capture'}
        </button>
        {probe && (
          <p role="status">
            {probe.actualWidth} × {probe.actualHeight} pixels ·{' '}
            {Math.round(probe.scaleFactor * 100)}% scaling ·{' '}
            {probe.nativeResolution
              ? 'Native resolution verified'
              : 'Native resolution requires a fallback'}
          </p>
        )}
        {message && <p role="alert">{message}</p>}
      </section>
      <section className="panel">
        <h2>Local capture works independently</h2>
        <p>
          Capture, OCR and queue controls are the next implementation steps.
          Account loading will not block this local workspace.
        </p>
        <button
          className="secondary"
          onClick={() => void window.screenstash.openVault()}
        >
          Open web vault
        </button>
      </section>
      <div id="account-root" />
    </main>
  );
}
createRoot(root).render(<LocalShell />);
const mountAccount = () => {
  const account = document.getElementById('account-root');
  if (!account) {
    requestAnimationFrame(mountAccount);
    return;
  }
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  createRoot(account).render(
    key ? (
      <ClerkProvider publishableKey={key}>
        <Authentication />
      </ClerkProvider>
    ) : (
      <section className="panel">
        <h2>Account</h2>
        <p>Authentication is not configured. Local tools remain available.</p>
      </section>
    ),
  );
};
requestAnimationFrame(mountAccount);

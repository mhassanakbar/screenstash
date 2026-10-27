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
import './styles.css';
import { CaptureWorkspace } from './capture';
import { Icon } from './icons';

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
    <section className="account-panel" aria-label="Account">
      <div className="account-emblem">
        <Icon name="account" size={22} />
      </div>
      <div className="account-copy">
        <p className="section-kicker">YOUR ACCOUNT</p>
        <h2>Private vault</h2>
        <p role="status">{state}</p>
      </div>
      {isLoaded &&
        (isSignedIn ? (
          <div className="actions account-actions">
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
          <div className="actions account-actions">
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
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <a className="brand" href="#capture">
          <span className="brand-mark">
            <Icon name="brand" size={23} />
          </span>
          <span>
            {APP_NAME}
            <small>DESKTOP WORKSPACE</small>
          </span>
        </a>
        <div className="sidebar-divider" />
        <p className="sidebar-label">WORKSPACE</p>
        <nav aria-label="Sections">
          <a href="#capture">
            <Icon name="capture" size={18} />
            Capture
          </a>
          <a href="#queue">
            <Icon name="queue" size={18} />
            Queue
          </a>
          <a href="#desktop-settings">
            <Icon name="settings" size={18} />
            Settings
          </a>
          <a href="#account">
            <Icon name="account" size={18} />
            Account
          </a>
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-bottom-mark">
            <Icon name="image" size={18} />
          </span>
          <p>
            Keep what matters.
            <br />
            <strong>Find it when you need it.</strong>
          </p>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">SCREENSTASH / DESKTOP</p>
            <h1>Your capture workspace</h1>
            <p>Save the moment. Keep the details close.</p>
          </div>
          <button
            className="vault-button secondary"
            onClick={() => void window.screenstash.openVault()}
          >
            Open web vault <Icon name="external" size={16} />
          </button>
        </header>
        <CaptureWorkspace />
        <div id="account" className="account-section">
          <div id="account-root" />
        </div>
      </main>
    </div>
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
      <section className="account-panel" aria-label="Account">
        <div className="account-emblem">
          <Icon name="account" size={22} />
        </div>
        <div className="account-copy">
          <p className="section-kicker">YOUR ACCOUNT</p>
          <h2>Private vault</h2>
          <p>Authentication is not configured. Local tools remain available.</p>
        </div>
      </section>
    ),
  );
};
requestAnimationFrame(mountAccount);

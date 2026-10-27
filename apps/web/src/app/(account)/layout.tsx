import { ClerkProvider } from '@clerk/nextjs';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/vault"
      signUpFallbackRedirectUrl="/vault"
    >
      <main className="account-shell">
        <section className="account-story">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            ScreenStash
          </Link>
          <div className="account-story-content">
            <p className="eyebrow">Your personal screenshot vault</p>
            <h1>
              Keep what
              <br />
              matters <em>close.</em>
            </h1>
            <p>
              Capture on your desktop, find anything by its text, and share only
              when you choose.
            </p>
          </div>
          <p className="account-story-footer">
            A calmer place for everything you capture.
          </p>
        </section>
        <div className="account-form-area">
          <div className="account-form-wrap">
            <p>Welcome to your workspace</p>
            {children}
          </div>
        </div>
      </main>
    </ClerkProvider>
  );
}

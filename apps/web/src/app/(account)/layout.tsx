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
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        <Link href="/" className="w-fit text-xl font-semibold tracking-tight">
          ScreenStash<span className="text-emerald-700">.</span>
        </Link>
        <div className="grid flex-1 items-center gap-12 py-12 md:grid-cols-2">
          <section>
            <p className="eyebrow">Your personal screenshot vault</p>
            <h1 className="mt-5 max-w-lg text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              Keep the things
              <br />
              worth remembering.
            </h1>
            <p className="mt-5 max-w-sm text-lg leading-relaxed text-neutral-500">
              Save screenshots from your desktop, find them by their text, and
              share only what you choose.
            </p>
          </section>
          <div className="flex justify-center">{children}</div>
        </div>
      </main>
    </ClerkProvider>
  );
}

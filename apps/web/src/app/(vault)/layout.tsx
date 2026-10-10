import { ClerkProvider, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PrivateProviders } from '../../features/providers';

export default async function VaultLayout({
  children,
}: {
  children: ReactNode;
}) {
  await auth.protect();
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/"
    >
      <PrivateProviders>
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex min-h-18 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:gap-6 sm:px-6">
            <Link
              href="/vault"
              className="text-xl font-semibold tracking-tight"
            >
              ScreenStash<span className="text-emerald-700">.</span>
            </Link>
            <nav
              aria-label="Main navigation"
              className="flex items-center gap-3 text-sm text-neutral-600 sm:gap-6"
            >
              <Link href="/vault" className="font-medium text-neutral-900">
                Library
              </Link>
              <Link href="/vault/account">Account</Link>
              <UserButton />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
      </PrivateProviders>
    </ClerkProvider>
  );
}

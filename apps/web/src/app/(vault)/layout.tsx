import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import type { ReactNode } from 'react';
import { PrivateProviders } from '../../features/providers';
import { VaultNavigation } from '../../features/vault-navigation';

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
        <div className="vault-shell">
          <VaultNavigation />
          <div className="vault-main">
            <div className="vault-topbar">
              <span className="vault-breadcrumb">
                Workspace&nbsp; / &nbsp;<strong>ScreenStash</strong>
              </span>
              <span className="vault-top-note">
                Your private screenshot space
              </span>
            </div>
            <main className="vault-content">{children}</main>
          </div>
        </div>
      </PrivateProviders>
    </ClerkProvider>
  );
}

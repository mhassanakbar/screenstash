'use client';
import { UserButton } from '@clerk/nextjs';
import { Images, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function VaultNavigation() {
  const pathname = usePathname();
  const account = pathname.startsWith('/vault/account');
  return (
    <>
      <aside className="vault-sidebar">
        <Link href="/vault" className="brand" aria-label="ScreenStash library">
          <span className="brand-mark" aria-hidden="true" />
          ScreenStash
        </Link>
        <p className="sidebar-group">Workspace</p>
        <nav aria-label="Main navigation">
          <Link
            href="/vault"
            className="sidebar-link"
            data-active={!account}
            aria-current={!account ? 'page' : undefined}
          >
            <Images size={17} strokeWidth={1.8} aria-hidden="true" />
            Library
          </Link>
          <Link
            href="/vault/account"
            className="sidebar-link"
            data-active={account}
            aria-current={account ? 'page' : undefined}
          >
            <UserRound size={17} strokeWidth={1.8} aria-hidden="true" />
            Account
          </Link>
        </nav>
        <div className="sidebar-footer">
          <p>
            Capture on your desktop.
            <br />
            Find it here when you need it.
          </p>
          <div className="sidebar-user">
            <UserButton />
            <span>Your workspace</span>
          </div>
        </div>
      </aside>
      <div className="mobile-nav">
        <Link href="/vault" className="brand" aria-label="ScreenStash library">
          <span className="brand-mark" aria-hidden="true" />
          ScreenStash
        </Link>
        <nav className="mobile-nav-links" aria-label="Mobile navigation">
          <Link
            href="/vault"
            data-active={!account}
            aria-current={!account ? 'page' : undefined}
          >
            Library
          </Link>
          <Link
            href="/vault/account"
            data-active={account}
            aria-current={account ? 'page' : undefined}
          >
            Account
          </Link>
          <UserButton />
        </nav>
      </div>
    </>
  );
}

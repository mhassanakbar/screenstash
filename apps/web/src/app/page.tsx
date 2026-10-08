import Link from 'next/link';
import { APP_NAME } from '@screenstash/shared';
import { ArrowUpRight, ScanText, ShieldCheck, FolderOpen } from 'lucide-react';
import { Button } from '../components/ui/button';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center justify-between">
        <span className="text-xl font-semibold tracking-tight">
          {APP_NAME}
          <span className="text-emerald-700">.</span>
        </span>
        <Button asChild variant="ghost">
          <Link href="/sign-in">
            Sign in <ArrowUpRight size={16} />
          </Link>
        </Button>
      </header>
      <section className="max-w-3xl py-24 md:py-32">
        <p className="eyebrow">A home for your screenshots</p>
        <h1 className="mt-6 text-5xl font-semibold leading-[1.08] tracking-tight md:text-7xl">
          Save the moment.
          <br />
          <span className="text-emerald-700">Find the detail.</span>
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-neutral-500">
          A private library for the screenshots you want to keep. Capture on
          your desktop, search their text, and share a single moment when you
          choose.
        </p>
        <Button asChild className="mt-9 h-12 px-6">
          <Link href="/vault">
            Open your library <ArrowUpRight size={18} />
          </Link>
        </Button>
      </section>
      <section
        aria-label="What you can do"
        className="grid gap-8 border-t border-neutral-200 py-10 sm:grid-cols-3"
      >
        {[
          {
            icon: FolderOpen,
            title: 'Keep it together',
            text: 'Your captures, organized with titles, tags, and dates.',
          },
          {
            icon: ScanText,
            title: 'Find what you saw',
            text: 'Search the words inside your screenshots.',
          },
          {
            icon: ShieldCheck,
            title: 'Private by default',
            text: 'Your vault stays yours. Sharing is always your choice.',
          },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title}>
            <Icon className="mb-4 text-emerald-700" size={22} />
            <h2 className="font-medium">{title}</h2>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-neutral-500">
              {text}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}

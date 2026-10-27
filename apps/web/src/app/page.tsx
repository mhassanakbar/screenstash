import Link from 'next/link';
import { APP_NAME } from '@screenstash/shared';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import './landing.css';

function LibraryPreview() {
  return (
    <div
      className="landing-preview"
      aria-label="Illustrative preview of a screenshot library"
    >
      <div className="preview-orbit" aria-hidden="true" />
      <div className="preview-window">
        <div className="preview-window-bar">
          <span className="preview-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <ShieldCheck size={12} /> Your private space
          </span>
          <span className="preview-window-label">LIBRARY PREVIEW</span>
        </div>
        <div className="preview-body">
          <div className="preview-heading">
            <span>Collected, not forgotten.</span>
            <span>3 captures</span>
          </div>
          <div className="preview-grid">
            <div className="preview-card preview-code">
              <div className="preview-code-label">
                <span className="preview-dot" /> A little inspiration.ts
              </div>
              <div className="preview-code-content">
                <span className="code-purple">const</span> goodIdeas = {'{'}
                <br />
                &nbsp; capture: <span className="code-gold">'a moment'</span>,
                <br />
                &nbsp; keep: <span className="code-gold">'the details'</span>,
                <br />
                &nbsp; find: <span className="code-gold">'your next idea'</span>
                <br />
                {'}'};
              </div>
              <div className="preview-card-meta">
                <span>That useful code snippet</span>
                <span>development</span>
              </div>
            </div>
            <div className="preview-card preview-poster">
              <div className="poster-topline">
                A NOTE TO SELF <ArrowUpRight size={14} />
              </div>
              <div className="poster-type">
                Less noise.
                <br />
                <em>More signal.</em>
              </div>
              <div className="poster-rule" />
              <div className="poster-caption">Keep what moves you forward.</div>
              <div className="preview-card-meta">
                <span>A thought worth keeping</span>
                <span>inspiration</span>
              </div>
            </div>
            <div className="preview-card preview-note">
              <span className="note-number">01 / THE SMALL DETAILS</span>
              <span className="note-title">
                The best ideas rarely
                <br />
                arrive on schedule.
              </span>
              <span className="note-underline" />
              <span className="note-description">
                Make a little room for them.
              </span>
              <div className="preview-card-meta">
                <span>For the next big thing</span>
                <span>ideas</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="preview-search">
        <Search size={18} />
        <span>that idea you saw last week</span>
        <span className="preview-search-match">
          <Sparkles size={13} /> Found it
        </span>
      </div>
      <div className="preview-caption">
        <span /> A second home for your first impressions.
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="landing">
      <header className="landing-header">
        <Link href="/" className="landing-brand" aria-label="ScreenStash home">
          <span className="landing-brand-mark">
            <ScanLine size={22} strokeWidth={1.8} />
          </span>
          {APP_NAME}
        </Link>
        <nav aria-label="Main navigation" className="landing-nav">
          <a href="#workflow" className="landing-how-link">
            How it works
          </a>
          <Button asChild variant="ghost">
            <Link href="/sign-in">
              Sign in <ArrowUpRight size={15} />
            </Link>
          </Button>
        </nav>
      </header>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-kicker">
            <span /> A LITTLE SPACE FOR WHAT MATTERS
          </p>
          <h1>
            Save the moment.
            <br />
            <span>Find the detail.</span>
          </h1>
          <p className="landing-description">
            Good ideas, useful details, things you don’t want to lose. Give your
            screenshots a home—and find them by the words inside.
          </p>
          <div className="landing-hero-actions">
            <Button asChild className="landing-primary">
              <Link href="/vault">
                Open your library <ArrowRight size={17} />
              </Link>
            </Button>
            <span className="landing-private-note">
              <ShieldCheck size={15} /> Private. By default.
            </span>
          </div>
          <div className="landing-points">
            <span>
              <Check size={13} /> Capture on desktop
            </span>
            <span>
              <Check size={13} /> Search the text
            </span>
            <span>
              <Check size={13} /> Share on your terms
            </span>
          </div>
        </div>
        <LibraryPreview />
      </section>
      <section
        id="workflow"
        className="landing-workflow"
        aria-label="What you can do"
      >
        <div className="landing-section-label">
          <span>LESS FILING. MORE FINDING.</span>
          <p>
            From “I should save this”
            <br />
            to “there it is.”
          </p>
        </div>
        <article className="landing-step">
          <span className="landing-step-number">01</span>
          <div>
            <h2>Catch the good stuff.</h2>
            <p>
              A whole display or just the detail. Capture from your desktop,
              even when you’re offline.
            </p>
          </div>
        </article>
        <article className="landing-step">
          <span className="landing-step-number">02</span>
          <div>
            <h2>Find it in a few words.</h2>
            <p>
              Search the text inside your captures. Add a title or a tag when a
              little context helps.
            </p>
          </div>
        </article>
        <article className="landing-step">
          <span className="landing-step-number">03</span>
          <div>
            <h2>Keep the choice yours.</h2>
            <p>
              A private vault, with shareable links you control. Share a
              moment—not your whole library.
            </p>
          </div>
        </article>
      </section>
      <footer className="landing-footer">
        <span>
          {APP_NAME}
          <span className="landing-footer-dot">.</span>
        </span>
        <p>Your screen is busy. Your screenshot library shouldn’t be.</p>
        <Link href="/vault">
          Make yourself at home <ArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}

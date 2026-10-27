'use client';
export default function ShareError({ reset }: { reset: () => void }) {
  return (
    <main className="share-page">
      <div className="share-page-header">
        <a href="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          ScreenStash
        </a>
      </div>
      <div className="share-message">
        <span className="eyebrow">Temporary issue</span>
        <h1>Sharing is temporarily unavailable</h1>
        <p>Please try loading this screenshot again.</p>
        <button
          onClick={reset}
          className="mt-6 rounded-[9px] bg-[#d45535] px-5 py-3 text-[13px] font-semibold text-white hover:bg-[#b84327] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d45535]"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

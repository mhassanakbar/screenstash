export default function ShareNotFound() {
  return (
    <main className="share-page">
      <div className="share-page-header">
        <a href="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          ScreenStash
        </a>
      </div>
      <div className="share-message">
        <span className="eyebrow">Link unavailable</span>
        <h1>This shared screenshot is unavailable</h1>
        <p>The link may have expired or been revoked.</p>
      </div>
    </main>
  );
}

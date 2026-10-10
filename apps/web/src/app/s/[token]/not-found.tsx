export default function ShareNotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-20">
      <a href="/" className="eyebrow">
        ScreenStash
      </a>
      <h1 className="mt-6 text-2xl font-semibold">
        This shared screenshot is unavailable
      </h1>
      <p className="mt-4 text-neutral-600">
        The link may have expired or been revoked.
      </p>
    </main>
  );
}

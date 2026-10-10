'use client';
export default function ShareError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-20">
      <h1 className="text-2xl font-semibold">
        Sharing is temporarily unavailable
      </h1>
      <p className="mt-4 text-neutral-600">
        Please try loading this screenshot again.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-emerald-800 px-5 py-3 text-white"
      >
        Try again
      </button>
    </main>
  );
}

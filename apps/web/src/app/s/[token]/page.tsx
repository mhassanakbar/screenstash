import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { publicShareSchema, shareTokenSchema } from '@screenstash/shared';

export const dynamic = 'force-dynamic';
const lookup = cache(async (token: string) => {
  if (!shareTokenSchema.safeParse(token).success) notFound();
  const origin = process.env.EXPRESS_API_ORIGIN ?? 'http://127.0.0.1:4000';
  let response: Response;
  try {
    response = await fetch(`${origin}/api/public/shares/${token}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Sharing is temporarily unavailable.');
  }
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Sharing is temporarily unavailable.');
  try {
    return publicShareSchema.parse(await response.json());
  } catch {
    throw new Error('Sharing is temporarily unavailable.');
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await lookup(token);
  const canonical = new URL(`/s/${token}`, share.imageUrl).href;
  return {
    title: share.publicTitle,
    description: 'A screenshot shared with ScreenStash.',
    alternates: { canonical },
    robots: { index: false, follow: false, noarchive: true },
    referrer: 'no-referrer',
    openGraph: {
      title: share.publicTitle,
      siteName: 'ScreenStash',
      description: 'A screenshot shared with ScreenStash.',
      type: 'website',
      url: canonical,
      images: [
        {
          url: share.previewUrl,
          width: 1200,
          height: 630,
          type: 'image/jpeg',
          alt: 'Shared screenshot preview',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: share.publicTitle,
      description: 'A screenshot shared with ScreenStash.',
      images: [{ url: share.previewUrl, alt: 'Shared screenshot preview' }],
    },
  };
}

export default async function SharedScreenshot({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const share = await lookup((await params).token);
  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-10">
      <a href="/" className="eyebrow">
        ScreenStash
      </a>
      <h1 className="mt-6 break-words text-3xl font-semibold tracking-tight">
        {share.publicTitle}
      </h1>
      <p className="mt-3 text-neutral-500">Shared screenshot</p>
      <img
        src={share.imageUrl}
        alt={share.publicTitle}
        width={share.width}
        height={share.height}
        className="mt-8 h-auto max-h-[75vh] w-full rounded-xl border border-neutral-200 bg-white object-contain"
      />
      <a
        className="mt-6 inline-block font-medium text-emerald-800 underline underline-offset-4"
        href={share.imageUrl}
      >
        View original PNG
      </a>
    </main>
  );
}

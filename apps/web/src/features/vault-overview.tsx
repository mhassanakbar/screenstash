'use client';
import { useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import * as Dialog from '@radix-ui/react-dialog';
import { Download, ImageIcon, Trash2, X } from 'lucide-react';
import { screenshotQuerySchema, type Screenshot } from '@screenstash/shared';
import { LibraryFilters } from './library-filters';
import { ScreenshotEditor } from './screenshot-editor';
import { useApi } from './providers';
import { Button } from '../components/ui/button';

export function VaultOverview() {
  const api = useApi();
  const { userId } = useAuth();
  const [selected, setSelected] = useState<Screenshot | null>(null);
  const opener = useRef<HTMLElement | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const params = useSearchParams();
  const parsed = screenshotQuerySchema.safeParse({ ...(params.get('q') ? { q: params.get('q') } : {}), ...(params.getAll('tagId').length ? { tagId: params.getAll('tagId') } : {}), ...(params.get('from') ? { from: params.get('from') } : {}), ...(params.get('to') ? { to: params.get('to') } : {}) });
  const filters = parsed.success ? parsed.data : {};
  const library = useInfiniteQuery({
    queryKey: ['screenshots', userId, filters],
    enabled: parsed.success,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.screenshots(pageParam ? { ...filters, cursor: pageParam } : filters, signal),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const items = library.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your private space</p>
          <h1 ref={heading} tabIndex={-1} className="mt-3 text-3xl font-semibold tracking-tight">
            Your library
          </h1>
          <p className="mt-3 text-neutral-500">
            Screenshots from your desktop, always within reach.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void library.refetch()}
          disabled={library.isFetching}
        >
          Refresh
        </Button>
      </div>
      <LibraryFilters/>
      {!parsed.success ? <p role="alert" className="mt-8 text-red-700">These filters are invalid. Check the dates or clear the filters.</p> : library.isPending ? (
        <p role="status" className="mt-12 text-neutral-500">
          Loading your screenshots…
        </p>
      ) : library.isError ? (
        <div
          role="alert"
          className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6"
        >
          <p>We couldn’t load your library.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void library.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-neutral-300 bg-white px-8 py-20 text-center">
          <ImageIcon
            className="mx-auto h-9 w-9 text-emerald-700"
            aria-hidden="true"
          />
          <h2 className="mt-5 text-xl font-medium">
            Your account is connected.
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-neutral-500">
            {params.toString() ? 'No screenshots match these filters. Try another search.' : 'Capture a screenshot with the desktop app to start your library.'}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((image) => (
              <button
                key={image.id}
                onClick={event => { opener.current = event.currentTarget; setSelected(image); }}
                className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left shadow-sm outline-none transition hover:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-4"
                aria-label={`Open ${image.title}`}
              >
                <div className="aspect-[4/3] bg-neutral-100 p-3">
                  <img
                    src={`/api/screenshots/${image.id}/image`}
                    alt={image.title}
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="p-4">
                  <h2 className="truncate font-medium">{image.title}</h2>
                  <p className="mt-2 text-xs text-neutral-500">
                    {new Date(image.capturedAt).toLocaleString()}
                  </p>
                  {image.ocrStatus === 'failed' && (
                    <p className="mt-2 text-xs text-amber-700">
                      Text recognition unavailable
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
          {library.hasNextPage && (
            <div className="mt-8 text-center">
              <Button
                variant="outline"
                onClick={() => void library.fetchNextPage()}
                disabled={library.isFetchingNextPage}
              >
                {library.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected && (
          <ScreenshotDetail
            image={selected}
            onDeleted={() => setSelected(null)}
            restoreFocus={() => (opener.current?.isConnected ? opener.current : heading.current)?.focus()}
          />
        )}
      </Dialog.Root>
    </section>
  );
}
function ScreenshotDetail({
  image,
  onDeleted,
  restoreFocus,
}: {
  image: Screenshot;
  onDeleted: () => void;
  restoreFocus: () => void;
}) {
  const api = useApi(),
    cache = useQueryClient();
  const { userId } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const detail = useQuery({
    queryKey: ['screenshot', userId, image.id],
    queryFn: ({ signal }) => api.screenshot(image.id, signal),
  });
  const deletion = useMutation({
    mutationFn: () => api.deleteScreenshot(image.id),
    onSuccess: async () => {
      cache.removeQueries({ queryKey: ['screenshot', userId, image.id] });
      await cache.invalidateQueries({ queryKey: ['screenshots', userId] });
      onDeleted();
    },
  });
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-neutral-950/50 backdrop-blur-sm" />
      <Dialog.Content onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} className="fixed inset-x-3 top-[5vh] z-50 mx-auto max-h-[90vh] max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl outline-none sm:p-8">
        <div className="flex items-start justify-between gap-5">
          <div>
            <Dialog.Title className="break-words text-xl font-semibold">
              {image.title}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-neutral-500">
              {new Date(image.capturedAt).toLocaleString()} · {image.width} ×{' '}
              {image.height} · {(image.sizeBytes / 1024 / 1024).toFixed(1)} MB
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close screenshot">
              <X className="h-5 w-5" />
            </Button>
          </Dialog.Close>
        </div>
        <img
          src={`/api/screenshots/${image.id}/image`}
          alt={image.title}
          className="mt-6 max-h-[55vh] w-full rounded-lg bg-neutral-100 object-contain"
        />
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <a href={`/api/screenshots/${image.id}/download`}>
              <Download className="mr-2 h-4 w-4" />
              Download PNG
            </a>
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete screenshot
          </Button>
        </div>
        {detail.data && <ScreenshotEditor key={image.id} image={detail.data}/>}
        {confirming && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="font-medium">Permanently delete this screenshot?</p>
            <p className="mt-2 text-sm text-neutral-600">
              It will leave your library and any public link will stop working.
            </p>
            <div className="mt-4 flex gap-3">
              <Button
                variant="destructive"
                onClick={() => deletion.mutate()}
                disabled={deletion.isPending}
              >
                {deletion.isPending ? 'Deleting…' : 'Delete permanently'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={deletion.isPending}
              >
                Cancel
              </Button>
            </div>
            {deletion.isError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                We couldn’t delete this screenshot. Please try again.
              </p>
            )}
          </div>
        )}
        <section className="mt-8 border-t border-neutral-200 pt-6">
          <h3 className="font-medium">Recognized text</h3>
          {detail.isPending ? (
            <p role="status" className="mt-3 text-sm text-neutral-500">
              Loading text…
            </p>
          ) : detail.isError ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              We couldn’t load the screenshot details.
            </p>
          ) : (
            <>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-600">
                {detail.data.ocrText ||
                  (image.ocrStatus === 'failed'
                    ? 'Text recognition failed for this screenshot.'
                    : 'No text was found in this screenshot.')}
              </p>
              {detail.data.ocrTruncated && (
                <p className="mt-3 text-xs text-amber-700">
                  Recognized text was shortened to fit the storage limit.
                </p>
              )}
            </>
          )}
        </section>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

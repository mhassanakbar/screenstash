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
import { Download, ImageIcon, RefreshCw, Trash2, X } from 'lucide-react';
import { screenshotQuerySchema, type Screenshot } from '@screenstash/shared';
import { LibraryFilters } from './library-filters';
import { ScreenshotEditor } from './screenshot-editor';
import { ScreenshotSharing } from './screenshot-sharing';
import { useApi } from './providers';
import { Button } from '../components/ui/button';

export function VaultOverview() {
  const api = useApi();
  const { userId } = useAuth();
  const [selected, setSelected] = useState<Screenshot | null>(null);
  const opener = useRef<HTMLElement | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const params = useSearchParams();
  const parsed = screenshotQuerySchema.safeParse({
    ...(params.get('q') ? { q: params.get('q') } : {}),
    ...(params.getAll('tagId').length ? { tagId: params.getAll('tagId') } : {}),
    ...(params.get('from') ? { from: params.get('from') } : {}),
    ...(params.get('to') ? { to: params.get('to') } : {}),
  });
  const filters = parsed.success ? parsed.data : {};
  const library = useInfiniteQuery({
    queryKey: ['screenshots', userId, filters],
    enabled: parsed.success,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.screenshots(
        pageParam ? { ...filters, cursor: pageParam } : filters,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const items = library.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section aria-label="Screenshot library">
      <div className="vault-heading">
        <div>
          <p className="eyebrow">Your private space</p>
          <h1 ref={heading} tabIndex={-1}>
            Your library
          </h1>
          <p>Screenshots from your desktop, always within reach.</p>
        </div>
        <Button
          variant="outline"
          className="vault-heading-action"
          onClick={() => void library.refetch()}
          disabled={library.isFetching}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </Button>
      </div>
      <LibraryFilters />
      {!parsed.success ? (
        <p role="alert" className="notice notice-danger mt-6">
          These filters are invalid. Check the dates or clear the filters.
        </p>
      ) : library.isPending ? (
        <div role="status" className="library-state mt-7">
          <span className="library-state-icon">
            <ImageIcon size={22} aria-hidden="true" />
          </span>
          <h2>Opening your library</h2>
          <p>Loading your screenshots…</p>
        </div>
      ) : library.isError ? (
        <div role="alert" className="library-state state-error mt-7">
          <span className="library-state-icon">
            <ImageIcon size={22} aria-hidden="true" />
          </span>
          <h2>We couldn’t load your library.</h2>
          <p>
            There was a problem reaching your screenshots. Try again in a
            moment.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void library.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="library-state mt-7">
          <span className="library-state-icon">
            <ImageIcon size={23} aria-hidden="true" />
          </span>
          <h2>
            {params.toString()
              ? 'No matching screenshots'
              : 'Your account is connected.'}
          </h2>
          <p>
            {params.toString()
              ? 'No screenshots match these filters. Try another search.'
              : 'Capture a screenshot with the desktop app to start your library.'}
          </p>
        </div>
      ) : (
        <>
          <div className="library-section-head">
            <h2>All captures</h2>
            <span>{items.length} shown</span>
          </div>
          <div className="capture-grid">
            {items.map((image) => (
              <button
                key={image.id}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setSelected(image);
                }}
                className="capture-tile"
                aria-label={`Open ${image.title}`}
              >
                <div className="capture-preview">
                  <img
                    src={`/api/screenshots/${image.id}/image`}
                    alt={image.title}
                    loading="lazy"
                  />
                </div>
                <div className="capture-body">
                  <span className="capture-title">{image.title}</span>
                  <span className="capture-date">
                    {new Date(image.capturedAt).toLocaleString()}
                  </span>
                  {image.ocrStatus === 'failed' && (
                    <span className="capture-warning">
                      Text recognition unavailable
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
          {library.hasNextPage && (
            <div className="load-more">
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
            restoreFocus={() =>
              (opener.current?.isConnected
                ? opener.current
                : heading.current
              )?.focus()
            }
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
      <Dialog.Overlay className="detail-overlay" />
      <Dialog.Content
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
        className="detail-dialog"
      >
        <div className="detail-header">
          <div>
            <Dialog.Title className="break-words">
              {detail.data?.title ?? image.title}
            </Dialog.Title>
            <Dialog.Description>
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
        <div className="detail-content">
          <div className="detail-image-wrap">
            <img src={`/api/screenshots/${image.id}/image`} alt={image.title} />
          </div>
          <div className="detail-actions">
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
          {confirming && (
            <div className="notice notice-danger mt-4">
              <p className="font-medium">Permanently delete this screenshot?</p>
              <p className="mt-2 text-sm text-neutral-600">
                It will leave your library and any public link will stop
                working.
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
          <div className="detail-columns">
            {detail.data && (
              <ScreenshotEditor key={image.id} image={detail.data} />
            )}
            {detail.data && (
              <ScreenshotSharing key={`share-${image.id}`} id={image.id} />
            )}
          </div>
          <section className="detail-panel detail-ocr">
            <h3>Recognized text</h3>
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
                <p className="detail-ocr-text">
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
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

'use client';
import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { publicTitleSchema, limits } from '@screenstash/shared';
import { useApi } from './providers';
import { Button } from '../components/ui/button';

export function ScreenshotSharing({ id }: { id: string }) {
  const api = useApi(),
    cache = useQueryClient();
  const { userId } = useAuth();
  const key = ['share', userId, id];
  const status = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.shareStatus(id, signal),
  });
  const [title, setTitle] = useState('Screenshot shared with ScreenStash');
  const [url, setUrl] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const creation = useMutation({
    mutationFn: (replaceActive: boolean) =>
      api.createShare(id, { publicTitle: title, replaceActive }),
    onSuccess: async (result) => {
      setUrl(result.url);
      setCopyStatus('');
      setConfirmReplace(false);
      await cache.invalidateQueries({ queryKey: key });
    },
    onError: async () => {
      await cache.invalidateQueries({ queryKey: key });
    },
  });
  const revocation = useMutation({
    mutationFn: () => api.revokeShare(id),
    onSuccess: async () => {
      setUrl(null);
      setCopyStatus('');
      setConfirmReplace(false);
      creation.reset();
      await cache.invalidateQueries({ queryKey: key });
    },
  });
  const busy = creation.isPending || revocation.isPending;
  const valid = publicTitleSchema.safeParse(title).success;
  return (
    <section
      className="mt-8 border-t border-neutral-200 pt-6"
      aria-label="Public sharing"
    >
      <h3 className="font-medium">Public sharing</h3>
      <p className="mt-2 text-sm text-neutral-600">
        Anyone with the link can view and save the image. Only the public title
        appears in the preview. Review the screenshot before sharing it.
      </p>
      <p className="mt-2 text-sm text-neutral-500">
        Revoking a link stops future access. Copies and previews already saved
        by other services may remain.
      </p>
      {status.isPending ? (
        <p role="status" className="mt-4">
          Loading sharing status…
        </p>
      ) : status.isError ? (
        <div role="alert" className="mt-4">
          <p>Sharing status could not be loaded.</p>
          <Button variant="outline" onClick={() => void status.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {status.data.active && (
            <p className="mt-4 text-sm">
              An active public link exists. Public title:{' '}
              <strong className="break-words">{status.data.publicTitle}</strong>
            </p>
          )}
          <label
            className="mt-4 block text-sm font-medium"
            htmlFor={`public-title-${id}`}
          >
            Public title
          </label>
          <input
            id={`public-title-${id}`}
            value={title}
            maxLength={limits.publicTitle}
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value);
              creation.reset();
            }}
            className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            {!status.data.active ? (
              <Button
                disabled={busy || !valid}
                onClick={() => {
                  revocation.reset();
                  creation.mutate(false);
                }}
              >
                {creation.isPending ? 'Creating…' : 'Create public link'}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmReplace(true)}
                >
                  Replace link
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => revocation.mutate()}
                >
                  {revocation.isPending ? 'Revoking…' : 'Revoke link'}
                </Button>
              </>
            )}
          </div>
          {confirmReplace && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p>
                The previous link will stop working when a new link is created.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  disabled={busy || !valid}
                  onClick={() => creation.mutate(true)}
                >
                  Confirm replacement
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmReplace(false)}
                >
                  Cancel replacement
                </Button>
              </div>
            </div>
          )}
          {url ? (
            <div className="mt-4">
              <label
                htmlFor={`share-link-${id}`}
                className="text-sm font-medium"
              >
                Public link
              </label>
              <input
                id={`share-link-${id}`}
                readOnly
                value={url}
                className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                className="mt-3"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopyStatus('Link copied.');
                  } catch {
                    setCopyStatus('Select the link above to copy it.');
                  }
                }}
              >
                Copy link
              </Button>
              <p role="status" className="mt-2 text-sm">
                {copyStatus}
              </p>
            </div>
          ) : (
            status.data.active && (
              <p className="mt-4 text-sm text-neutral-600">
                The link is shown only when created. Replace it if you need a
                new copy.
              </p>
            )
          )}
          {creation.isError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              The public link could not be created. Check sharing status and try
              again.
            </p>
          )}
          {revocation.isError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              The link could not be revoked. Please try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}

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
    <section className="detail-panel" aria-label="Public sharing">
      <h3>Public sharing</h3>
      <p className="text-[#62645e]">
        Anyone with the link can view and save the image. Only the public title
        appears in the preview. Review the screenshot before sharing it.
      </p>
      <p className="mt-2 text-[#6b6e65]">
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
            <p className="notice mt-4">
              An active public link exists. Public title:{' '}
              <strong className="break-words">{status.data.publicTitle}</strong>
            </p>
          )}
          <label className="field-label mt-5" htmlFor={`public-title-${id}`}>
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
            className="field-control"
            aria-invalid={!valid}
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
            <div className="notice mt-4">
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
              <label htmlFor={`share-link-${id}`} className="field-label">
                Public link
              </label>
              <input
                id={`share-link-${id}`}
                readOnly
                value={url}
                className="field-control"
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

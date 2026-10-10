'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useApi } from './providers';
import { Button } from '../components/ui/button';
export function LibraryFilters() {
  const api = useApi(),
    { userId } = useAuth();
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const currentSearch = params.get('q') ?? '';
  const [search, setSearch] = useState(currentSearch);
  const tags = useQuery({
    queryKey: ['tags', userId],
    queryFn: ({ signal }) => api.tags(signal),
  });
  useEffect(() => setSearch(currentSearch), [currentSearch]);
  useEffect(() => {
    if (search.trim() === currentSearch) return;
    const timeout = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      next.delete('cursor');
      if (search.trim()) next.set('q', search.trim());
      else next.delete('q');
      router.replace(`${pathname}?${next}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, currentSearch, params, router, pathname]);
  function update(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete('cursor');
    if (value) next.set(name, value);
    else next.delete(name);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  function toggleTag(id: string) {
    const next = new URLSearchParams(params.toString()),
      ids = new Set(next.getAll('tagId'));
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    next.delete('tagId');
    next.delete('cursor');
    for (const tag of ids) next.append('tagId', tag);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  const inputClass =
    'mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-700';
  return (
    <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="text-sm font-medium">
          Search screenshots
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title, tags, or recognized text"
            maxLength={500}
            className={inputClass}
          />
        </label>
        <label className="text-sm font-medium">
          From (UTC)
          <input
            type="date"
            value={(params.get('from') ?? '').slice(0, 10)}
            onChange={(event) =>
              update(
                'from',
                event.target.value ? `${event.target.value}T00:00:00.000Z` : '',
              )
            }
            className={inputClass}
          />
        </label>
        <label className="text-sm font-medium">
          Before (UTC)
          <input
            type="date"
            value={(params.get('to') ?? '').slice(0, 10)}
            onChange={(event) =>
              update(
                'to',
                event.target.value ? `${event.target.value}T00:00:00.000Z` : '',
              )
            }
            className={inputClass}
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tags.data?.map((tag) => (
          <Button
            key={tag.id}
            size="sm"
            variant={
              params.getAll('tagId').includes(tag.id) ? 'default' : 'outline'
            }
            aria-pressed={params.getAll('tagId').includes(tag.id)}
            onClick={() => toggleTag(tag.id)}
          >
            {tag.name}
          </Button>
        ))}
        {params.toString() && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.replace(pathname, { scroll: false })}
          >
            Clear filters
          </Button>
        )}
      </div>
      {tags.isError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          We couldn’t load tag filters.
        </p>
      )}
    </div>
  );
}

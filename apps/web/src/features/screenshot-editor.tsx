'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import type { Screenshot } from '@screenstash/shared';
import { useApi } from './providers';
import { Button } from '../components/ui/button';
export function ScreenshotEditor({ image }: { image: Screenshot }) {
  const api = useApi(), cache = useQueryClient(), { userId } = useAuth();
  const [title, setTitle] = useState(image.title), [selectedTags, setSelectedTags] = useState(image.tags.map(tag => tag.id)), [tagName, setTagName] = useState('');
  const tags = useQuery({ queryKey: ['tags', userId], queryFn: ({ signal }) => api.tags(signal) });
  const save = useMutation({ mutationFn: () => api.updateScreenshot(image.id, { title, tagIds: selectedTags }), onSuccess: async updated => { cache.setQueryData(['screenshot', userId, image.id], updated); await cache.invalidateQueries({ queryKey: ['screenshots', userId] }); } });
  const create = useMutation({ mutationFn: () => api.createTag({ name: tagName }), onSuccess: async tag => { setSelectedTags(ids => ids.includes(tag.id) ? ids : [...ids, tag.id]); setTagName(''); await cache.invalidateQueries({ queryKey: ['tags', userId] }); } });
  const inputClass = 'mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-700';
  return <section className="mt-6 rounded-xl border border-neutral-200 p-4"><form onSubmit={event => { event.preventDefault(); save.mutate(); }}><label className="text-sm font-medium">Screenshot title<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} className={inputClass}/></label><fieldset className="mt-4"><legend className="text-sm font-medium">Tags</legend><div className="mt-3 flex flex-wrap gap-4">{tags.data?.map(tag => <label key={tag.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={event => setSelectedTags(ids => event.target.checked ? [...ids, tag.id] : ids.filter(id => id !== tag.id))}/>{tag.name}</label>)}</div></fieldset><Button type="submit" className="mt-4" disabled={save.isPending || !title.trim() || selectedTags.length > 20}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>{save.isSuccess && <p role="status" className="mt-3 text-sm text-emerald-700">Changes saved.</p>}{save.isError && <p role="alert" className="mt-3 text-sm text-red-700">We couldn’t save these changes. Please try again.</p>}</form><form onSubmit={event => { event.preventDefault(); create.mutate(); }} className="mt-5 border-t border-neutral-200 pt-4"><label className="text-sm font-medium">New tag<input value={tagName} onChange={event => setTagName(event.target.value)} required maxLength={40} className={inputClass}/></label><Button type="submit" variant="outline" className="mt-3" disabled={create.isPending || !tagName.trim() || selectedTags.length >= 20}>Add tag</Button>{create.isError && <p role="alert" className="mt-3 text-sm text-red-700">We couldn’t create this tag.</p>}</form></section>;
}

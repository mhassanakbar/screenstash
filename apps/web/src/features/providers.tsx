'use client';

import { useAuth } from '@clerk/nextjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@screenstash/api-client';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

const ApiContext = createContext<ReturnType<typeof createApiClient> | null>(
  null,
);
export function PrivateProviders({ children }: { children: ReactNode }) {
  const { getToken, userId, isLoaded } = useAuth();
  // A new cache per account prevents a previous account's private data from rendering.
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 10000 } },
      }),
    [userId],
  );
  const api = useMemo(
    () => createApiClient({ baseUrl: '', getSessionToken: () => getToken() }),
    [getToken],
  );
  useEffect(
    () => () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient],
  );
  if (!isLoaded || !userId)
    return (
      <p role="status" className="p-8 text-neutral-500">
        Loading your account…
      </p>
    );
  return (
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}
export function useApi() {
  const client = useContext(ApiContext);
  if (!client)
    throw new Error('Private API must be used inside the account provider');
  return client;
}

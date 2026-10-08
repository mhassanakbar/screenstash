import { healthResponseSchema, type HealthResponse } from '@screenstash/shared';

export type SessionTokenProvider = () => Promise<string | null>;
export interface ApiClientOptions {
  baseUrl: string;
  getSessionToken?: SessionTokenProvider;
}
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  return {
    async health(signal?: AbortSignal): Promise<HealthResponse> {
      const response = await fetch(`${baseUrl}/api/health`, {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new Error(`API health request failed: ${response.status}`);
      return healthResponseSchema.parse(await response.json());
    },
  };
}

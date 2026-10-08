import { z } from 'zod';

export const APP_NAME = 'ScreenStash';
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('screenstash-api'),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

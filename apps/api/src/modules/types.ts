import type { z } from 'zod';
import type { deviceInputSchema } from '@screenstash/shared';
export type DeviceInput = z.infer<typeof deviceInputSchema>;

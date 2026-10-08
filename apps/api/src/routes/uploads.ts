import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { idSchema, meSchema, uploadInputSchema } from '@screenstash/shared';
import type { Database } from '@screenstash/db';
import type { Environment } from '../config/environment.js';
import type { ObjectStore } from '../storage/r2.js';
import { HttpError } from '../middleware/errors.js';
import { UploadService } from '../modules/uploads.js';
import { runMaintenance } from '../modules/cleanup.js';
import { throttle } from '../modules/policy.js';

export function uploadRoutes(
  environment: Environment,
  database?: Database,
  store?: ObjectStore,
) {
  const router = Router();
  const service = () => {
    if (!database || !store)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Upload services are unavailable.',
        true,
      );
    return new UploadService(database, store, environment);
  };
  router.post('/api/upload-sessions', async (req, res) =>
    res
      .status(200)
      .json(
        await service().authorize(
          meSchema.parse(res.locals.owner).id,
          uploadInputSchema.parse(req.body),
        ),
      ),
  );
  router.get('/api/upload-sessions/:id', async (req, res) => {
    const upload = service();
    res.json(
      upload.dto(
        await upload.get(
          meSchema.parse(res.locals.owner).id,
          idSchema.parse(req.params.id),
        ),
      ),
    );
  });
  router.post('/api/upload-sessions/:id/renew', async (req, res) => {
    const owner = meSchema.parse(res.locals.owner);
    if (database) await throttle(database, `renew:${owner.id}`, 30);
    res.json(await service().renew(owner.id, idSchema.parse(req.params.id)));
  });
  router.post('/api/upload-sessions/:id/finalize', async (req, res) =>
    res.json(
      await service().finalize(
        meSchema.parse(res.locals.owner).id,
        idSchema.parse(req.params.id),
      ),
    ),
  );
  return router;
}
export function maintenanceRoute(
  environment: Environment,
  database?: Database,
  store?: ObjectStore,
) {
  const router = Router();
  router.get('/api/internal/maintenance', async (req, res) => {
    if (!environment.CRON_SECRET || !database || !store)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Maintenance is unavailable.',
        true,
      );
    const supplied = Buffer.from(req.get('Authorization') ?? ''),
      expected = Buffer.from(`Bearer ${environment.CRON_SECRET}`);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new HttpError(
        401,
        'UNAUTHENTICATED',
        'Maintenance authorization is required.',
      );
    res.json(await runMaintenance(database, store));
  });
  return router;
}

import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  healthResponseSchema,
  meSchema,
  deviceInputSchema,
  deviceSchema,
} from '@screenstash/shared';
import type { Database } from '@screenstash/db';
import { authenticatedRoutes } from './middleware/auth.js';
import { clerkWebhook } from './webhooks/clerk.js';
import { registerDevice } from './modules/users.js';
import type { ObjectStore } from './storage/r2.js';
import { uploadRoutes, maintenanceRoute } from './routes/uploads.js';
import { privateMedia } from './routes/media.js';
import { screenshotRoutes } from './routes/screenshots.js';
import { shareRoutes } from './routes/shares.js';
import {
  configuredDependencies,
  type Environment,
} from './config/environment.js';
import { errorHandler, HttpError } from './middleware/errors.js';

export interface ApplicationServices {
  database?: Database;
  store?: ObjectStore;
  ready?: () => Promise<boolean>;
}
export function createApp(
  environment: Environment,
  services: ApplicationServices = {},
) {
  const app = express();
  app.disable('x-powered-by');
  // Vercel and Next rewrites are known hops; never trust arbitrary X-Forwarded-For.
  app.set('trust proxy', false);
  app.set('query parser', 'simple');
  app.use((req, res, next) => {
    const incoming = req.get('X-Request-ID');
    res.locals.requestId =
      incoming && /^[a-f0-9-]{36}$/i.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json(
      healthResponseSchema.parse({ status: 'ok', service: 'screenstash-api' }),
    ),
  );
  app.get('/api/ready', async (_req, res) => {
    const dependencies = configuredDependencies(environment);
    let databaseReady = false;
    if (dependencies.database && services.ready) {
      try {
        databaseReady = await services.ready();
      } catch {
        /* Report only availability, never provider errors. */
      }
    }
    const ready =
      databaseReady && dependencies.authentication && dependencies.storage;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'unavailable',
      dependencies: {
        database: databaseReady ? 'ready' : 'unavailable',
        authentication: dependencies.authentication
          ? 'configured'
          : 'unconfigured',
        storage: dependencies.storage ? 'configured' : 'unconfigured',
      },
    });
  });
  app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const requestOrigin = req.get('Origin');
      if (
        requestOrigin &&
        requestOrigin !== new URL(environment.WEB_ORIGIN).origin
      )
        throw new HttpError(
          403,
          'FORBIDDEN',
          'This request origin is not allowed.',
        );
    }
    next();
  });
  app.use(clerkWebhook(environment, services.database));
  app.use(maintenanceRoute(environment, services.database, services.store));
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(
    [
      '/api/me',
      '/api/devices',
      '/api/screenshots',
      '/api/tags',
      '/api/upload-sessions',
    ],
    ...authenticatedRoutes(environment, services.database),
  );
  app.get('/api/me', (_req, res) => res.json(meSchema.parse(res.locals.owner)));
  app.use(uploadRoutes(environment, services.database, services.store));
  app.use(privateMedia(services.database, services.store));
  app.use(screenshotRoutes(services.database));
  app.use(shareRoutes(environment, services.database, services.store));
  app.post('/api/devices', async (req, res) => {
    if (!services.database)
      throw new HttpError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Account services are unavailable.',
        true,
      );
    const owner = meSchema.parse(res.locals.owner);
    const device = await registerDevice(
      services.database,
      owner.id,
      deviceInputSchema.parse(req.body),
    );
    res.status(200).json(deviceSchema.parse(device));
  });
  app.use((_req, _res, next) =>
    next(new HttpError(404, 'NOT_FOUND', 'Route not found')),
  );
  app.use(errorHandler);
  return app;
}

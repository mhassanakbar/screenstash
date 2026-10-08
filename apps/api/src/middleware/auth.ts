import type { RequestHandler } from 'express';
import { clerkMiddleware, getAuth } from '@clerk/express';
import type { Database } from '@screenstash/db';
import type { Environment } from '../config/environment.js';
import { resolveOwner } from '../modules/users.js';
import { HttpError } from './errors.js';

export function authenticatedRoutes(
  environment: Environment,
  database?: Database,
): RequestHandler[] {
  if (
    !environment.CLERK_SECRET_KEY ||
    !environment.CLERK_PUBLISHABLE_KEY ||
    !database
  ) {
    return [
      (_req, _res, next) =>
        next(
          new HttpError(
            503,
            'DEPENDENCY_UNAVAILABLE',
            'Account services are unavailable.',
            true,
          ),
        ),
    ];
  }
  return [
    (req, _res, next) => {
      const mediaRead =
        ['GET', 'HEAD'].includes(req.method) &&
        /\/(image|download)$/.test(req.path);
      if (!mediaRead && !/^Bearer \S+$/i.test(req.get('Authorization') ?? '')) {
        next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.'));
        return;
      }
      if (
        !['GET', 'HEAD'].includes(req.method) &&
        !req.is('application/json')
      ) {
        next(new HttpError(400, 'INVALID_INPUT', 'Use a JSON request body.'));
        return;
      }
      next();
    },
    clerkMiddleware({
      ...(environment.CLERK_JWT_KEY ? { jwtKey: environment.CLERK_JWT_KEY } : {}),
      secretKey: environment.CLERK_SECRET_KEY,
      publishableKey: environment.CLERK_PUBLISHABLE_KEY,
      authorizedParties: [new URL(environment.WEB_ORIGIN).origin],
    }),
    async (req, res, next) => {
      try {
        const auth = getAuth(req, { acceptsToken: 'session_token' });
        if (!auth.userId)
          throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
        const owner = await resolveOwner(database, auth.userId);
        res.locals.owner = { id: owner.id, clerkUserId: owner.clerkUserId };
        next();
      } catch (error) {
        next(error);
      }
    },
  ];
}

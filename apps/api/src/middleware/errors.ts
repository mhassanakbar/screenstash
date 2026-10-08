import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ErrorCode } from '@screenstash/shared';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const parser = error as { type?: string };
  const known =
    error instanceof HttpError
      ? error
      : error instanceof ZodError
        ? new HttpError(
            400,
            'INVALID_INPUT',
            'The request contains invalid fields.',
          )
        : parser?.type === 'entity.too.large'
          ? new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.')
          : parser?.type === 'entity.parse.failed'
            ? new HttpError(
                400,
                'INVALID_INPUT',
                'The request body must be valid JSON.',
              )
            : new HttpError(
                500,
                'INTERNAL_ERROR',
                'The request could not be completed.',
                true,
              );
  if (known.status === 429) res.setHeader('Retry-After', '60');
  res.status(known.status).json({
    error: {
      code: known.code,
      message: known.message,
      retryable: known.retryable,
      requestId: res.locals.requestId,
    },
  });
};

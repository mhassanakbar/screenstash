import { z } from 'zod';

export const limits = Object.freeze({
  uploadBytes: 20 * 1024 * 1024,
  imagePixels: 40_000_000,
  imageSide: 16_384,
  privateTitle: 200,
  publicTitle: 120,
  tagName: 40,
  tagsPerScreenshot: 20,
  ocrText: 200_000,
  pageSize: 50,
  maxPageSize: 100,
});
export const idSchema = z.uuid();
export const timestampSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
export const titleSchema = z.string().trim().min(1).max(limits.privateTitle);
export const publicTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(limits.publicTitle);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const tagSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(limits.tagName),
});
const tagIdsSchema = z
  .array(idSchema)
  .max(limits.tagsPerScreenshot)
  .refine((ids) => new Set(ids).size === ids.length, 'Tag IDs must be unique');
export const errorCodeSchema = z.enum([
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
  'UPLOAD_NOT_READY',
  'UPLOAD_EXPIRED',
  'UPLOAD_INVALID',
  'CAPTURE_DELETED',
  'QUOTA_EXCEEDED',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    retryable: z.boolean(),
  }),
});
export const meSchema = z.object({
  id: idSchema,
  clerkUserId: z.string().min(1),
});
export const deviceInputSchema = z.strictObject({
  installationId: idSchema,
  name: z.string().trim().min(1).max(100),
});
export const deviceSchema = z.object({
  id: idSchema,
  installationId: idSchema,
  name: z.string(),
  lastSeenAt: timestampSchema,
});
export const uploadInputSchema = z
  .strictObject({
    captureId: idSchema,
    deviceId: idSchema.optional(),
    title: titleSchema,
    capturedAt: timestampSchema,
    mimeType: z.literal('image/png'),
    sizeBytes: z.number().int().positive().max(limits.uploadBytes),
    width: z.number().int().positive().max(limits.imageSide),
    height: z.number().int().positive().max(limits.imageSide),
    sha256: sha256Schema,
    ocrStatus: z.enum(['complete', 'failed']),
    ocrText: z.string().max(limits.ocrText),
    ocrTruncated: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.width * value.height > limits.imagePixels)
      ctx.addIssue({
        code: 'custom',
        message: 'Pixel limit exceeded',
        path: ['width'],
      });
    if (value.ocrStatus === 'failed' && value.ocrText !== '')
      ctx.addIssue({
        code: 'custom',
        message: 'Failed OCR must have empty text',
        path: ['ocrText'],
      });
  });
export const screenshotSchema = z.object({
  id: idSchema,
  captureId: idSchema,
  title: titleSchema,
  mimeType: z.literal('image/png'),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  capturedAt: timestampSchema,
  createdAt: timestampSchema,
  ocrStatus: z.enum(['complete', 'failed']),
  ocrTruncated: z.boolean(),
  tags: z.array(tagSchema),
});
export const screenshotDetailSchema = screenshotSchema.extend({
  ocrText: z.string().max(limits.ocrText),
});
export const screenshotPatchSchema = z
  .strictObject({
    title: titleSchema.optional(),
    tagIds: tagIdsSchema.optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.tagIds !== undefined,
    'At least one change is required',
  );
export const tagInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(limits.tagName),
});
const pageSizeSchema = z
  .union([
    z.number().int(),
    z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .transform(Number),
  ])
  .pipe(z.number().int().min(1).max(limits.maxPageSize));
export const screenshotQuerySchema = z
  .strictObject({
    q: z.string().trim().max(500).optional(),
    tagId: z
      .union([idSchema, tagIdsSchema])
      .transform((value) => (typeof value === 'string' ? [value] : value))
      .optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: pageSizeSchema.default(limits.pageSize),
  })
  .refine(
    (value) => !value.from || !value.to || value.from < value.to,
    'Date interval must have from before to',
  );
export const screenshotPageSchema = z.object({
  items: z.array(screenshotSchema),
  nextCursor: z.string().nullable(),
});
export const uploadSessionSchema = z.object({
  id: idSchema,
  screenshotId: idSchema,
  status: z.enum(['pending', 'finalized', 'expired', 'rejected', 'deleted']),
  expiresAt: timestampSchema,
  putUrl: z.url().optional(),
  requiredHeaders: z.record(z.string(), z.string()).optional(),
  putExpiresAt: timestampSchema.optional(),
});
export const shareInputSchema = z.strictObject({
  publicTitle: publicTitleSchema,
  replaceActive: z.boolean().default(false),
});
export const shareStatusSchema = z.object({
  active: z.boolean(),
  publicTitle: publicTitleSchema.nullable(),
  createdAt: timestampSchema.nullable(),
});
export const shareCreatedSchema = z.object({
  url: z.url(),
  publicTitle: publicTitleSchema,
  createdAt: timestampSchema,
});
export const publicShareSchema = z.object({
  publicTitle: publicTitleSchema,
  imageUrl: z.url(),
  previewUrl: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.literal('image/png'),
});
export type UploadInput = z.infer<typeof uploadInputSchema>;
export type Screenshot = z.infer<typeof screenshotSchema>;
export type ScreenshotDetail = z.infer<typeof screenshotDetailSchema>;
export type ScreenshotQuery = z.input<typeof screenshotQuerySchema>;
export type ScreenshotPatch = z.infer<typeof screenshotPatchSchema>;
export type Me = z.infer<typeof meSchema>;

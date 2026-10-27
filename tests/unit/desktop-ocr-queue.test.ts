import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptureRepository } from '../../apps/desktop/src/main/capture/repository';
import {
  LocalOcrQueue,
  type LocalRecognizer,
} from '../../apps/desktop/src/main/ocr/queue';

const base = path.resolve('test-results');
const directories: string[] = [];
const queues: LocalOcrQueue[] = [];
async function fixture() {
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'ocr-queue-'));
  directories.push(directory);
  const repository = new CaptureRepository(directory);
  await repository.initialize();
  const bytes = await sharp({
    create: { width: 24, height: 16, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const capture = await repository.save(
    bytes,
    'display',
    new Date().toISOString(),
    null,
  );
  const recognizer: LocalRecognizer = {
    recognize: vi
      .fn()
      .mockResolvedValue({ text: 'Searchable invoice', truncated: false }),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
  const queue = new LocalOcrQueue(repository, recognizer, () => {});
  queues.push(queue);
  return { directory, repository, capture, recognizer, queue };
}
afterEach(async () => {
  await Promise.all(queues.splice(0).map((queue) => queue.stop()));
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== base ||
      !path.basename(directory).startsWith('ocr-queue-')
    )
      throw new Error('Unexpected cleanup target');
    await rm(directory, { recursive: true, force: true });
  }
});
it('persists OCR before making the screenshot eligible for sync', async () => {
  const { directory, repository, capture, recognizer, queue } = await fixture();
  queue.wake();
  queue.wake();
  await vi.waitFor(() =>
    expect(repository.get(capture.id)?.ocrStatus).toBe('complete'),
  );
  expect(recognizer.recognize).toHaveBeenCalledTimes(1);
  const restarted = new CaptureRepository(directory);
  await restarted.initialize();
  expect(restarted.get(capture.id)?.ocrText).toBe('Searchable invoice');
});
it('settles recognition failure with empty text so image upload can proceed', async () => {
  const { repository, capture, recognizer, queue } = await fixture();
  vi.mocked(recognizer.recognize).mockRejectedValue(new Error('Worker failed'));
  queue.wake();
  await vi.waitFor(() =>
    expect(repository.get(capture.id)?.ocrStatus).toBe('failed'),
  );
  expect(repository.get(capture.id)?.ocrText).toBe('');
  expect(repository.get(capture.id)?.uploadStatus).toBe('pending');
});
it('does not schedule recognition after upload metadata is locked', async () => {
  const { repository, capture, recognizer, queue } = await fixture();
  await repository.update(capture.id, { uploadMetadataLocked: true });
  queue.wake();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(recognizer.recognize).not.toHaveBeenCalled();
  expect(repository.get(capture.id)?.ocrStatus).toBe('pending');
});
it('recovers interrupted recognition but never rewrites frozen upload metadata', async () => {
  const { repository, capture, recognizer, queue } = await fixture();
  await repository.update(capture.id, { ocrStatus: 'processing' });
  queue.wake();
  await vi.waitFor(() =>
    expect(repository.get(capture.id)?.ocrStatus).toBe('complete'),
  );
  await repository.update(capture.id, {
    uploadAttempts: 1,
    uploadSessionId: randomUUID(),
  });
  queue.wake();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(recognizer.recognize).toHaveBeenCalledTimes(1);
});

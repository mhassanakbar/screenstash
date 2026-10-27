import type { CaptureRepository } from '../capture/repository';

export interface LocalRecognizer {
  recognize(bytes: Buffer): Promise<{ text: string; truncated: boolean }>;
  terminate(): Promise<void>;
}

export class LocalOcrQueue {
  private stopped = false;
  private paused = false;
  private running: Promise<void> | null = null;
  constructor(
    private repository: CaptureRepository,
    private recognizer: LocalRecognizer,
    private changed: () => void,
  ) {}
  wake() {
    if (this.stopped || this.paused || this.running) return;
    this.running = this.process()
      .catch(() => {})
      .finally(() => {
        this.running = null;
      });
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.wake();
  }
  private async process() {
    while (!this.stopped && !this.paused) {
      const capture = this.repository
        .all()
        .find(
          (record) =>
            ['pending', 'processing'].includes(record.ocrStatus) &&
            !record.uploadMetadataLocked &&
            record.uploadStage === 'create' &&
            record.uploadAttempts === 0 &&
            !record.uploadSessionId,
        );
      if (!capture) return;
      await this.repository.update(capture.id, {
        ocrStatus: 'processing',
        ocrError: null,
      });
      this.changed();
      let result: { text: string; truncated: boolean };
      try {
        result = await this.recognizer.recognize(
          await this.repository.readVerifiedBytes(capture.id),
        );
      } catch {
        if (this.stopped) return;
        if (!this.repository.get(capture.id)) continue;
        await this.repository.update(capture.id, {
          ocrStatus: 'failed',
          ocrText: '',
          ocrTruncated: false,
          ocrError: 'Local recognition failed. The image can still sync.',
        });
        this.changed();
        continue;
      }
      if (this.stopped) return;
      if (!this.repository.get(capture.id)) continue;
      await this.repository.update(capture.id, {
        ocrStatus: 'complete',
        ocrText: result.text,
        ocrTruncated: result.truncated,
        ocrError: null,
      });
      this.changed();
    }
  }
  async stop() {
    this.stopped = true;
    await this.recognizer.terminate();
    await this.running;
  }
}

import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { bridgeChannels, tokenReplySchema } from '../../contracts/bridge';

export class TokenBroker {
  private generation = 0;
  private pending = new Map<
    string,
    {
      generation: number;
      resolve: (token: string | null) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private renderer: () => WebContents | undefined) {}
  epoch() {
    return this.generation;
  }
  invalidate() {
    this.generation++;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.resolve(null);
    }
    this.pending.clear();
  }
  request(): Promise<string | null> {
    const renderer = this.renderer();
    if (!renderer || renderer.isDestroyed()) return Promise.resolve(null);
    const requestId = randomUUID(),
      generation = this.generation;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, 10000);
      this.pending.set(requestId, { generation, resolve, timer });
      renderer.send(bridgeChannels.tokenRequest, { requestId });
    });
  }
  accept(value: unknown) {
    const parsed = tokenReplySchema.safeParse(value);
    if (!parsed.success) return;
    const request = this.pending.get(parsed.data.requestId);
    if (!request) return;
    this.pending.delete(parsed.data.requestId);
    clearTimeout(request.timer);
    request.resolve(
      request.generation === this.generation ? parsed.data.token : null,
    );
  }
}

import type { RegionGrid, RegionRequest } from './types';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  terminate(): void;
}

export type WorkerIn =
  | { type: 'init'; tileIndex: string[] }
  | { type: 'build'; id: number; req: RegionRequest }
  | { type: 'cancel'; id: number };

export type WorkerOut = { type: 'done'; id: number; grid: RegionGrid } | { type: 'error'; id: number; name: string; message: string };

interface Pending {
  resolve(grid: RegionGrid): void;
  reject(err: Error): void;
}

/** Promise API over the region worker: one request id per build, cancellable with AbortSignal. */
export class RegionClient {
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly worker: WorkerLike,
    tileIndex: string[],
  ) {
    worker.addEventListener('message', (e) => this.onMessage(e.data as WorkerOut));
    this.send({ type: 'init', tileIndex });
  }

  private send(msg: WorkerIn): void {
    this.worker.postMessage(msg);
  }

  build(req: RegionRequest, signal?: AbortSignal): Promise<RegionGrid> {
    signal?.throwIfAborted();
    const id = ++this.seq;
    return new Promise<RegionGrid>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.delete(id)) return;
          this.send({ type: 'cancel', id });
          reject(new DOMException('Region build aborted', 'AbortError'));
        },
        { once: true },
      );
      this.send({ type: 'build', id, req });
    });
  }

  private onMessage(msg: WorkerOut): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.type === 'done') p.resolve(msg.grid);
    else {
      const err = new Error(msg.message);
      err.name = msg.name;
      p.reject(err);
    }
  }

  dispose(): void {
    for (const p of this.pending.values()) p.reject(new DOMException('Region client disposed', 'AbortError'));
    this.pending.clear();
    this.worker.terminate();
  }
}

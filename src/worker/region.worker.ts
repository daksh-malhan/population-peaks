import { TileIndex } from '../data/tileIndex';
import { HttpTileSource, TileStore } from '../data/tileStore';
import { buildRegion } from '../region/buildRegion';
import type { WorkerIn, WorkerOut } from '../region/client';

const ctx = self as unknown as {
  addEventListener(type: 'message', fn: (e: MessageEvent<WorkerIn>) => void): void;
  postMessage(msg: WorkerOut, transfer?: Transferable[]): void;
};

let store: TileStore | null = null;
const jobs = new Map<number, AbortController>();

ctx.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    store = new TileStore(new HttpTileSource(msg.dataUrl), new TileIndex(msg.tileIndex));
    return;
  }
  if (msg.type === 'cancel') {
    jobs.get(msg.id)?.abort();
    jobs.delete(msg.id);
    return;
  }
  if (!store) {
    ctx.postMessage({ type: 'error', id: msg.id, name: 'Error', message: 'worker not initialised' });
    return;
  }
  const ctl = new AbortController();
  jobs.set(msg.id, ctl);
  buildRegion(msg.req, store, ctl.signal).then(
    (grid) => {
      const transfer: Transferable[] = [grid.density.buffer, grid.mask.buffer];
      if (grid.highlight) transfer.push(grid.highlight.buffer);
      ctx.postMessage({ type: 'done', id: msg.id, grid }, transfer);
    },
    (err: unknown) => {
      const e2 = err instanceof Error ? err : new Error(String(err));
      ctx.postMessage({ type: 'error', id: msg.id, name: e2.name, message: e2.message });
    },
  ).finally(() => jobs.delete(msg.id));
});

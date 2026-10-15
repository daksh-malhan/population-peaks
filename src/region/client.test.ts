import { describe, expect, it } from 'vitest';
import { TileIndex } from '../data/tileIndex';
import { TileStore } from '../data/tileStore';
import { FsTileSource, readJson } from '../test/fixture';
import { buildRegion } from './buildRegion';
import { RegionClient, type WorkerLike } from './client';
import type { RegionRequest } from './types';

/** Runs the worker protocol in-process, the way region.worker.ts does in the browser. */
async function fakeWorker() {
  const idx = await readJson<{ bits: string[] }>('tiles/index.json');
  const store = new TileStore(new FsTileSource(), new TileIndex(idx.bits));
  const listeners: ((e: MessageEvent) => void)[] = [];
  const sent: unknown[] = [];
  const ctls = new Map<number, AbortController>();
  const worker: WorkerLike = {
    postMessage(msg: unknown) {
      sent.push(msg);
      const m = msg as { type: string; id: number; req: RegionRequest };
      const reply = (data: unknown) => listeners.forEach((l) => l({ data } as MessageEvent));
      if (m.type === 'cancel') ctls.get(m.id)?.abort();
      if (m.type !== 'build') return;
      const ctl = new AbortController();
      ctls.set(m.id, ctl);
      buildRegion(m.req, store, ctl.signal).then(
        (grid) => reply({ type: 'done', id: m.id, grid }),
        (e: Error) => reply({ type: 'error', id: m.id, name: e.name, message: e.message }),
      );
    },
    addEventListener(_type: 'message', fn: (e: MessageEvent) => void) {
      listeners.push(fn);
    },
    terminate() {},
  };
  return { worker, sent };
}

const circle: RegionRequest = { bbox: [-40.6, 29.9, -40.2, 30.3], shape: { kind: 'circle', lng: -40.4, lat: 30.1, radiusKm: 15 }, targetCells: 64 };

describe('RegionClient', () => {
  it('builds regions through the worker protocol', async () => {
    const { worker, sent } = await fakeWorker();
    const client = new RegionClient(worker, ['AA==']);
    const grid = await client.build(circle);
    expect(grid.stats.population).toBeGreaterThan(100_000);
    expect(sent[0]).toEqual({ type: 'init', tileIndex: ['AA=='] });
  });

  it('turns worker errors into rejected promises', async () => {
    const { worker } = await fakeWorker();
    const client = new RegionClient(worker, []);
    await expect(client.build({ ...circle, targetCells: 3 })).rejects.toThrow(/targetCells/);
  });

  it('cancels the worker job and rejects with AbortError on abort', async () => {
    const { worker, sent } = await fakeWorker();
    const client = new RegionClient(worker, []);
    const ctl = new AbortController();
    const p = client.build(circle, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent.some((m) => (m as { type: string }).type === 'cancel')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { rowAreaKm2 } from '../geo/mercator';
import { type Expected, FsTileSource, readJson } from '../test/fixture';
import { decodeTile } from './tileCodec';
import { TileIndex } from './tileIndex';
import { TileStore } from './tileStore';

async function indexFromFixture() {
  const idx = await readJson<{ bits: string[] }>('tiles/index.json');
  return new TileIndex(idx.bits);
}

describe('tile codec', () => {
  it('decodes fixture tiles so their mass equals the generated population', async () => {
    const expected = await readJson<Expected>('expected.json');
    const src = new FsTileSource();
    const tiles: [number, number][] = [[49, 52], [49, 53], [50, 52], [50, 53], [0, 70], [127, 70], [48, 52], [48, 53]];
    let mass = 0;
    for (const [x, y] of tiles) {
      const buf = await src.fetchTile(7, x, y);
      if (!buf) continue;
      const d = await decodeTile(buf);
      for (let r = 0; r < 256; r++) {
        const area = rowAreaKm2(y * 256 + r, 7);
        for (let c = 0; c < 256; c++) mass += d[r * 256 + c]! * area;
      }
    }
    expect(mass / expected.total).toBeCloseTo(1, 2);
  });

  it('rejects tiles of the wrong size', async () => {
    const bad = await new Response(new Blob([new Uint8Array(10)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
    await expect(decodeTile(bad)).rejects.toThrow(/tile/);
  });
});

describe('tile index', () => {
  it('agrees with the files the pipeline wrote, and wraps x', async () => {
    const index = await indexFromFixture();
    expect(index.has(7, 49, 52)).toBe(true);
    expect(index.has(7, 0, 70)).toBe(true);
    expect(index.has(7, 128, 70)).toBe(true); // wraps to x = 0
    expect(index.has(7, 10, 10)).toBe(false);
    expect(index.has(7, 5, -1)).toBe(false);
    expect(index.has(9, 0, 0)).toBe(false);
  });
});

describe('tile store', () => {
  it('never requests tiles the index says are empty', async () => {
    const src = new FsTileSource();
    const store = new TileStore(src, await indexFromFixture());
    expect(await store.get(7, 10, 10)).toBeNull();
    expect(src.requests).toBe(0);
  });

  it('caches decoded tiles and shares in-flight requests', async () => {
    const src = new FsTileSource();
    const store = new TileStore(src, await indexFromFixture());
    const [a, b] = await Promise.all([store.get(7, 49, 52), store.get(7, 49, 52)]);
    expect(a).toBe(b);
    await store.get(7, 49, 52);
    expect(src.requests).toBe(1);
  });

  it('evicts least recently used tiles beyond capacity', async () => {
    const src = new FsTileSource();
    const store = new TileStore(src, await indexFromFixture(), 2);
    await store.get(7, 49, 52);
    await store.get(7, 49, 53);
    await store.get(7, 0, 70);
    await store.get(7, 49, 52);
    expect(src.requests).toBe(4);
  });

  it('rejects with AbortError when the caller aborts', async () => {
    const store = new TileStore(new FsTileSource(), await indexFromFixture());
    const ctl = new AbortController();
    ctl.abort();
    await expect(store.get(7, 49, 52, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

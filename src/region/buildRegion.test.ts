import { describe, expect, it } from 'vitest';
import { TileIndex } from '../data/tileIndex';
import { TileStore } from '../data/tileStore';
import { decodeGeometry } from '../geo/geomCodec';
import { type Expected, FsTileSource, readJson } from '../test/fixture';
import { buildRegion } from './buildRegion';
import type { RegionRequest } from './types';

interface PlaceFile {
  bbox: [number, number, number, number];
  tiny: boolean;
  geom: number[][][];
  states: { id: string; bbox: [number, number, number, number]; geom: number[][][] }[];
}

async function setup() {
  const idx = await readJson<{ bits: string[] }>('tiles/index.json');
  const store = new TileStore(new FsTileSource(), new TileIndex(idx.bits));
  const expected = await readJson<Expected>('expected.json');
  return { store, expected };
}

function polygonRequest(p: { bbox: [number, number, number, number]; geom: number[][][] }, targetCells = 240): RegionRequest {
  return { bbox: p.bbox, shape: { kind: 'polygons', polygons: decodeGeometry(p.geom) }, targetCells };
}

describe('buildRegion', () => {
  it('reproduces a country population within 1%', async () => {
    const { store, expected } = await setup();
    const zz = await readJson<PlaceFile>('places/ZZ.json');
    const grid = await buildRegion(polygonRequest(zz), store);
    expect(grid.stats.population / expected.population.ZZ!).toBeCloseTo(1, 2);
    expect(Math.max(grid.width, grid.height)).toBe(240);
    expect(grid.density.length).toBe(grid.width * grid.height);
  });

  it('reproduces each state population within 1%', async () => {
    const { store, expected } = await setup();
    const zz = await readJson<PlaceFile>('places/ZZ.json');
    for (const s of zz.states) {
      const grid = await buildRegion(polygonRequest(s), store);
      expect(grid.stats.population / expected.population[s.id]!).toBeCloseTo(1, 2);
    }
  });

  it('finds the peak at the capital', async () => {
    const { store, expected } = await setup();
    const zz = await readJson<PlaceFile>('places/ZZ.json');
    const grid = await buildRegion(polygonRequest(zz), store);
    const { lat, lng } = expected.peak.ZZ!;
    expect(Math.abs(grid.stats.peak[0] - lng)).toBeLessThan(0.05);
    expect(Math.abs(grid.stats.peak[1] - lat)).toBeLessThan(0.05);
  });

  it('builds one continuous grid for a country that crosses the antimeridian', async () => {
    const { store, expected } = await setup();
    const zx = await readJson<PlaceFile>('places/ZX.json');
    const grid = await buildRegion(polygonRequest(zx), store);
    expect(grid.stats.population / expected.population.ZX!).toBeCloseTo(1, 2);
    // The middle column (on the antimeridian) is inside the country, not a gap.
    const midCol = Math.floor(grid.width / 2);
    let covered = 0;
    for (let r = 0; r < grid.height; r++) covered += grid.mask[r * grid.width + midCol]!;
    expect(covered / grid.height).toBeGreaterThan(0.8);
  });

  it('counts a circle around a city, including across the antimeridian', async () => {
    const { store } = await setup();
    const grid = await buildRegion(
      { bbox: [179.6, -17.5, 180.2, -16.9], shape: { kind: 'circle', lng: 179.8, lat: -17.3, radiusKm: 20 }, targetCells: 160 },
      store,
    );
    expect(grid.stats.population).toBeGreaterThan(100_000);
    const inside = grid.mask.reduce((s, v) => s + v, 0) * grid.cellKm * grid.cellKm;
    expect(inside / (Math.PI * 20 * 20)).toBeCloseTo(1, 1);
  });

  it('shows a tiny place inside a context circle with its outline highlighted', async () => {
    const { store, expected } = await setup();
    const zy = await readJson<PlaceFile>('places/ZY.json');
    expect(zy.tiny).toBe(true);
    const cx = (zy.bbox[0] + zy.bbox[2]) / 2;
    const cy = (zy.bbox[1] + zy.bbox[3]) / 2;
    const grid = await buildRegion(
      {
        bbox: zy.bbox,
        shape: { kind: 'circle', lng: cx, lat: cy, radiusKm: 10 },
        highlight: decodeGeometry(zy.geom),
        targetCells: 120,
      },
      store,
    );
    expect(grid.highlight).toBeDefined();
    expect(grid.highlight!.reduce((s, v) => s + v, 0)).toBeGreaterThan(0);
    expect(grid.mask.reduce((s, v) => s + v, 0)).toBeGreaterThan(grid.highlight!.reduce((s, v) => s + v, 0) * 10);
    expect(grid.stats.population).toBeGreaterThan(0);
    expect(grid.stats.population).toBeLessThan(expected.population.ZY_context!);
  });

  it('treats missing tiles as empty land, not errors', async () => {
    const { store } = await setup();
    const grid = await buildRegion(
      { bbox: [10, 10, 11, 11], shape: { kind: 'circle', lng: 10.5, lat: 10.5, radiusKm: 30 }, targetCells: 64 },
      store,
    );
    expect(grid.stats.population).toBe(0);
  });

  it('stops when aborted', async () => {
    const { store } = await setup();
    const zz = await readJson<PlaceFile>('places/ZZ.json');
    const ctl = new AbortController();
    ctl.abort();
    await expect(buildRegion(polygonRequest(zz), store, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

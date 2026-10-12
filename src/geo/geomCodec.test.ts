import { describe, expect, it } from 'vitest';
import { readJson } from '../test/fixture';
import { boundsOf, decodeGeometry } from './geomCodec';

describe('geometry codec', () => {
  it('decodes 1e-4° deltas into lng/lat rings', () => {
    const polys = decodeGeometry([[[190000, 470000, 5000, 0, 0, 5000, -5000, 0]]]);
    expect(Array.from(polys[0]![0]!)).toEqual([19, 47, 19.5, 47, 19.5, 47.5, 19, 47.5]);
  });

  it('decodes fixture outlines to their bounding boxes', async () => {
    const zz = await readJson<{ bbox: number[]; geom: number[][][] }>('places/ZZ.json');
    const b = boundsOf(decodeGeometry(zz.geom));
    zz.bbox.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 3));
    const zx = await readJson<{ geom: number[][][] }>('places/ZX.json');
    const bx = boundsOf(decodeGeometry(zx.geom));
    expect(bx[0]).toBeLessThan(180);
    expect(bx[2]).toBeGreaterThan(180);
  });
});

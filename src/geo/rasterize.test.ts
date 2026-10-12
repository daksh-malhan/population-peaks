import { describe, expect, it } from 'vitest';
import { rasterizeCircle, rasterizePolygons } from './rasterize';

const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
const ring = (...pts: [number, number][]) => Float64Array.from(pts.flat());

describe('polygon rasterizer', () => {
  it('fully covers pixels inside a pixel-aligned square', () => {
    const cov = rasterizePolygons([[ring([1, 1], [5, 1], [5, 5], [1, 5])]], 8, 8);
    expect(sum(cov)).toBeCloseTo(16, 5);
    expect(cov[2 * 8 + 2]).toBeCloseTo(1, 5);
    expect(cov[0]).toBe(0);
  });

  it('applies the even-odd rule to holes', () => {
    const cov = rasterizePolygons([[ring([0, 0], [8, 0], [8, 8], [0, 8]), ring([2, 2], [6, 2], [6, 6], [2, 6])]], 8, 8);
    expect(sum(cov)).toBeCloseTo(64 - 16, 5);
    expect(cov[3 * 8 + 3]).toBe(0);
  });

  it('anti-aliases sloped edges so total coverage equals the true area', () => {
    const tri = [[ring([0.3, 0.7], [7.6, 1.9], [3.1, 7.4])]];
    const area = Math.abs((7.6 - 0.3) * (7.4 - 0.7) - (3.1 - 0.3) * (1.9 - 0.7)) / 2;
    expect(sum(rasterizePolygons(tri, 8, 8, 16))).toBeCloseTo(area, 1);
  });

  it('clips polygons that extend past the grid', () => {
    expect(sum(rasterizePolygons([[ring([-4, -4], [4, -4], [4, 4], [-4, 4])]], 8, 8))).toBeCloseTo(16, 5);
  });

  it('rasterizes circles to πr²', () => {
    expect(sum(rasterizeCircle(20, 20, 12.5, 40, 40, 8))).toBeCloseTo(Math.PI * 12.5 * 12.5, 0);
  });
});

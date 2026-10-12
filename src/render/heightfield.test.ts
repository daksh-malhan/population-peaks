import { describe, expect, it } from 'vitest';
import { buildHeights, colorT, LEGEND_CAP, regionPeak } from './heightfield';

describe('density to colour', () => {
  it('saturates at the legend cap of 5,000 people/km²', () => {
    expect(LEGEND_CAP).toBe(5000);
    expect(colorT(0)).toBe(0);
    expect(colorT(5000)).toBe(1);
    expect(colorT(50_000)).toBe(1);
    // Squared log scale: countryside stays dark red, towns turn red, cities white (like the poster).
    expect(colorT(20)).toBeGreaterThan(0.08);
    expect(colorT(20)).toBeLessThan(0.2);
    expect(colorT(1000)).toBeGreaterThan(0.55);
    expect(colorT(1000)).toBeLessThan(0.75);
    expect(colorT(-3)).toBe(0);
  });
});

describe('heights', () => {
  const density = Float32Array.from([0, 100, 400, 800]);
  const mask = Float32Array.from([1, 1, 1, 0.2]);

  it('finds the peak inside the region only', () => {
    expect(regionPeak(density, mask)).toBe(400);
  });

  it('scales each place to its own peak', () => {
    expect(Array.from(buildHeights(density, mask, 400, 10))).toEqual([0, 2.5, 10, 0]);
  });

  it('keeps a smaller place lower on a shared scale', () => {
    expect(Array.from(buildHeights(density, mask, 1600, 10))).toEqual([0, 0.625, 2.5, 0]);
  });

  it('is flat (not NaN) when a place is empty', () => {
    expect(Array.from(buildHeights(new Float32Array(3), new Float32Array(3).fill(1), 0, 10))).toEqual([0, 0, 0]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildHeights, colorRangeFor, colorT, DEFAULT_RANGE, glowFor, LEGEND_CAP, legendLabels, regionPeak } from './heightfield';

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

describe('colour range', () => {
  const place = (values: number[]) => ({ density: Float32Array.from(values), mask: new Float32Array(values.length).fill(1) });

  it("keeps the poster's fixed scale when only a few spots are white-hot", () => {
    const { density, mask } = place([...Array<number>(91).fill(40), ...Array<number>(9).fill(9000)]);
    expect(colorRangeFor(density, mask)).toEqual(DEFAULT_RANGE);
  });

  it('switches to the place\'s own range once more than a tenth of it would be white', () => {
    const { density, mask } = place([...Array<number>(88).fill(40), ...Array<number>(12).fill(9000)]);
    expect(colorRangeFor(density, mask)).not.toEqual(DEFAULT_RANGE);
  });

  it("follows a dense place's own densities from a raised baseline, rounded for the legend", () => {
    // Most of this city-state is above 5,000/km²: 1,000 … 30,700.
    const { density, mask } = place(Array.from({ length: 100 }, (_, i) => 1000 + i * 300));
    expect(colorRangeFor(density, mask)).toEqual({ low: 7000, high: 31_000 });
  });

  it('judges a place by its populated land, not the sea or parks around it', () => {
    const { density, mask } = place([...Array<number>(60).fill(0), ...Array.from({ length: 40 }, (_, i) => 6000 + i * 500)]);
    const r = colorRangeFor(density, mask);
    expect(r.low).toBeGreaterThan(6000);
    expect(r.high).toBeGreaterThanOrEqual(20_000);
  });

  it('never squeezes the range shut when a place is evenly dense', () => {
    const { density, mask } = place(Array<number>(100).fill(20_000));
    const r = colorRangeFor(density, mask);
    expect(r.low).toBeLessThanOrEqual(r.high / 3);
  });

  it('maps a range onto the ramp: dark at the baseline, white from the top', () => {
    const r = { low: 2000, high: 20_000 };
    expect(colorT(1500, r)).toBe(0);
    expect(colorT(2000, r)).toBe(0);
    expect(colorT(20_000, r)).toBe(1);
    expect(colorT(8000, r)).toBeGreaterThan(colorT(4000, r));
    expect(colorT(4000, r)).toBeGreaterThan(0);
  });

  it('labels the legend with "Low" on the fixed scale and real numbers on a place\'s own', () => {
    expect(legendLabels(DEFAULT_RANGE)).toEqual(['Low', '5,000+']);
    expect(legendLabels({ low: 7000, high: 30_000 })).toEqual(['7,000', '30,000+']);
  });

  it('keeps a dense place\'s glow low, so its own colours are not washed out by bloom', () => {
    const { density, mask } = place(Array.from({ length: 100 }, (_, i) => 1000 + i * 300));
    expect(colorRangeFor(density, mask)).not.toEqual(DEFAULT_RANGE);
    expect(glowFor(density, mask)).toBeCloseTo(0.1);
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

describe('glow', () => {
  const mask = new Float32Array(1000).fill(1);
  it('keeps full glow when only a few places are white-hot', () => {
    const d = new Float32Array(1000).fill(50);
    d.fill(9000, 0, 10); // 1% of the region
    expect(glowFor(d, mask)).toBeCloseTo(0.5);
  });

  it('dims the glow when a broad area is white-hot', () => {
    const d = new Float32Array(1000).fill(50);
    d.fill(9000, 0, 200); // 20% of the region
    expect(glowFor(d, mask)).toBeCloseTo(0.1);
  });
});

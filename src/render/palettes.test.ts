import { describe, expect, it } from 'vitest';
import { PALETTES, rampColor } from './palettes';

const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('palettes', () => {
  it('offers the post look plus three presets', () => {
    expect(Object.keys(PALETTES)).toEqual(['ember', 'glacier', 'gold', 'mono']);
  });

  it.each(Object.keys(PALETTES))('%s gets brighter monotonically from land to peak', (id) => {
    const p = PALETTES[id as keyof typeof PALETTES];
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const l = luminance(rampColor(p, i / 100));
      expect(l).toBeGreaterThanOrEqual(last - 1e-9);
      last = l;
    }
    expect(rampColor(p, 1)).toEqual([1, 1, 1]);
  });

  it('clamps out-of-range inputs', () => {
    expect(rampColor(PALETTES.ember, -2)).toEqual(rampColor(PALETTES.ember, 0));
    expect(rampColor(PALETTES.ember, 9)).toEqual([1, 1, 1]);
  });
});

import { describe, expect, it } from 'vitest';
import { canPrintWith, POSTER_SIZES, posterLayout, wrapTitle } from './poster';

// Monospace-ish stand-in for canvas measureText: 0.55 em per character.
const measure = (text: string, size: number) => text.length * size * 0.55;

describe('poster sizes', () => {
  it('matches Instagram feed, story, print and link-preview sizes', () => {
    expect(POSTER_SIZES.portrait).toEqual([1080, 1350]);
    expect(POSTER_SIZES.story).toEqual([1080, 1920]);
    expect(POSTER_SIZES.print).toEqual([3240, 4050]);
    expect(POSTER_SIZES.og).toEqual([1200, 630]);
  });
});

describe('posterLayout', () => {
  it('scales the portrait layout from the reference poster', () => {
    const l = posterLayout('portrait', 1080, 1350);
    expect(l.margin).toBe(72);
    expect(l.titleSize).toBeCloseTo(64, 0);
    expect(l.mapTop).toBeLessThan(l.mapBottom);
    expect(l.footerY).toBeGreaterThan(l.legendY);
    expect(l.footerY).toBeLessThan(1350);
  });

  it('keeps proportions at print size', () => {
    const a = posterLayout('portrait', 1080, 1350);
    const b = posterLayout('print', 3240, 4050);
    expect(b.titleSize / a.titleSize).toBeCloseTo(3, 5);
    expect(b.footerY / a.footerY).toBeCloseTo(3, 5);
  });

  it('gives a story poster a taller map area', () => {
    const p = posterLayout('portrait', 1080, 1350);
    const s = posterLayout('story', 1080, 1920);
    expect(s.mapBottom - s.mapTop).toBeGreaterThan(p.mapBottom - p.mapTop);
  });
});

describe('wrapTitle', () => {
  it('keeps a short title on one line at full size', () => {
    expect(wrapTitle("Hungary's population distribution", 1200, 64, 40, measure)).toEqual({ lines: ["Hungary's population distribution"], size: 64 });
  });

  it('wraps a longer title onto two lines', () => {
    const r = wrapTitle("United States' population distribution", 936, 64, 40, measure);
    expect(r.lines).toHaveLength(2);
    expect(r.size).toBe(64);
    for (const line of r.lines) expect(measure(line, r.size)).toBeLessThanOrEqual(936);
  });

  it('shrinks the type before wrapping onto a third line, and truncates as a last resort', () => {
    const long = 'A'.repeat(20) + ' ' + 'B'.repeat(20) + ' ' + 'C'.repeat(20) + ' ' + 'D'.repeat(20);
    const r = wrapTitle(long, 936, 64, 40, measure);
    expect(r.lines.length).toBeLessThanOrEqual(2);
    expect(r.size).toBeLessThan(64);
    expect(r.size).toBeGreaterThanOrEqual(40);
    const huge = 'W'.repeat(300);
    const t = wrapTitle(huge, 936, 64, 40, measure);
    expect(t.lines.length).toBeLessThanOrEqual(2);
    expect(t.lines.at(-1)!.endsWith('…')).toBe(true);
    for (const line of t.lines) expect(measure(line, t.size)).toBeLessThanOrEqual(936);
  });
});

describe('print size availability', () => {
  it('needs a big enough GPU buffer and a desktop-class device', () => {
    expect(canPrintWith({ maxTexture: 8192, coarsePointer: false, memoryGb: 8 })).toBe(true);
    expect(canPrintWith({ maxTexture: 4096, coarsePointer: false, memoryGb: 8 })).toBe(false);
    expect(canPrintWith({ maxTexture: 16384, coarsePointer: true, memoryGb: 8 })).toBe(false);
    expect(canPrintWith({ maxTexture: 16384, coarsePointer: false, memoryGb: 2 })).toBe(false);
    expect(canPrintWith({ maxTexture: 16384, coarsePointer: false, memoryGb: undefined })).toBe(true);
  });
});

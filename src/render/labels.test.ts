import { describe, expect, it } from 'vitest';
import { type LabelCandidate, pickLabels, placeLabels } from './labels';

const c = (id: string, name: string, lng: number, lat: number, pop: number): LabelCandidate => ({ id, name, lng, lat, pop });
const cities = [
  c('1', 'Budapest', 19.04, 47.5, 1_740_000),
  c('2', 'Budapest XI', 19.03, 47.47, 140_000),
  c('3', 'Debrecen', 21.63, 47.53, 200_000),
  c('4', 'Szeged', 20.15, 46.25, 160_000),
  c('5', 'Miskolc', 20.79, 48.1, 150_000),
  c('6', 'Pécs', 18.23, 46.07, 145_000),
  c('7', 'Vienna', 16.37, 48.21, 1_900_000),
];
const inHungary = (lng: number) => lng > 16.5;

describe('pickLabels', () => {
  it('labels the four biggest cities inside the region, skipping near-duplicates', () => {
    const picked = pickLabels(cities, inHungary, { count: 4, minSepKm: 15 });
    expect(picked.map((p) => p.name)).toEqual(['Budapest', 'Debrecen', 'Szeged', 'Miskolc']);
  });

  it('applies hidden, added and renamed edits', () => {
    const picked = pickLabels(cities, inHungary, {
      count: 4,
      minSepKm: 15,
      hidden: new Set(['3']),
      added: ['6'],
      renamed: { '1': 'Bp.' },
    });
    expect(picked.map((p) => p.name)).toEqual(['Bp.', 'Szeged', 'Miskolc', 'Pécs']);
  });

  it('never adds a city from outside the region', () => {
    expect(pickLabels(cities, inHungary, { count: 0, minSepKm: 15, added: ['7'] })).toEqual([]);
  });
});

describe('placeLabels', () => {
  it('puts labels above their anchor when there is room', () => {
    const [p] = placeLabels([{ id: 'a', x: 100, y: 100, w: 60, h: 14 }], { width: 400, height: 300 }, 18);
    expect(p).toMatchObject({ id: 'a', visible: true, side: 'above' });
    expect(p!.y + 14).toBeLessThanOrEqual(100);
  });

  it('moves a label aside instead of overlapping another', () => {
    const placed = placeLabels(
      [
        { id: 'a', x: 100, y: 100, w: 80, h: 14 },
        { id: 'b', x: 130, y: 100, w: 80, h: 14 },
      ],
      { width: 400, height: 300 },
      18,
    );
    const [a, b] = placed;
    const overlap = !(a!.x + 80 <= b!.x || b!.x + 80 <= a!.x || a!.y + 14 <= b!.y || b!.y + 14 <= a!.y);
    expect(b!.visible).toBe(true);
    expect(b!.side).not.toBe('above');
    expect(overlap).toBe(false);
  });

  it('hides a label that cannot fit anywhere inside the frame', () => {
    const [p] = placeLabels([{ id: 'a', x: 2, y: 2, w: 300, h: 14 }], { width: 200, height: 100 }, 18);
    expect(p!.visible).toBe(false);
  });
});

describe('placeLabels obstacles', () => {
  it('keeps labels off the title and footer', () => {
    const title = { x: 0, y: 0, w: 400, h: 120 };
    const [p] = placeLabels([{ id: 'a', x: 200, y: 140, w: 80, h: 14 }], { width: 400, height: 300 }, 18, [title]);
    expect(p!.visible).toBe(true);
    expect(p!.side).not.toBe('above');
    expect(p!.y).toBeGreaterThanOrEqual(120);
  });
});

describe('placeLabels dots', () => {
  it("keeps every label off other cities' dots", () => {
    const anchors = [
      { id: 'a', x: 200, y: 100, w: 80, h: 14 },
      { id: 'b', x: 200, y: 75, w: 80, h: 14 },
      { id: 'c', x: 230, y: 110, w: 80, h: 14 },
    ];
    const placed = placeLabels(anchors, { width: 400, height: 300 }, 18);
    placed.forEach((p, i) => {
      expect(p.visible).toBe(true);
      for (const [j, o] of anchors.entries()) {
        if (j === i) continue;
        const covers = o.x >= p.x - 5 && o.x <= p.x + anchors[i]!.w + 5 && o.y >= p.y - 5 && o.y <= p.y + anchors[i]!.h + 5;
        expect(covers, `${p.id}'s label covers ${o.id}'s dot`).toBe(false);
      }
    });
  });
});

describe('placeLabels priority', () => {
  it('never hides a bigger city to spare a smaller one, and hides the smaller one instead', () => {
    // The big city sits at the bottom-right edge with the legend to its left, so its label only fits
    // above, over the small city's dot.
    const placed = placeLabels(
      [
        { id: 'big', x: 360, y: 290, w: 80, h: 14 },
        { id: 'small', x: 360, y: 265, w: 80, h: 14 },
      ],
      { width: 400, height: 300 },
      18,
      [{ x: 250, y: 280, w: 100, h: 20 }],
    );
    expect(placed[0]).toMatchObject({ visible: true, side: 'above' });
    expect(placed[1]!.visible).toBe(false);
  });
});

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
        { id: 'b', x: 105, y: 104, w: 80, h: 14 },
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

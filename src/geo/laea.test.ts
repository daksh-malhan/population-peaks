import { describe, expect, it } from 'vitest';
import { makeLaea } from './laea';

describe('Lambert azimuthal equal-area projection', () => {
  it('maps its centre to the origin', () => {
    const p = makeLaea(19, 47);
    expect(p.forward(19, 47)).toEqual([0, 0]);
  });

  it('round-trips points around the centre, including across the antimeridian', () => {
    for (const [lng0, lat0] of [[19, 47], [180.2, -17.3], [-157.8, 21.3], [0, 89], [100, -60]] as const) {
      const p = makeLaea(lng0, lat0);
      for (const [dx, dy] of [[0.5, 0.2], [-3, 1.5], [2, -2.5]] as const) {
        const [x, y] = p.forward(lng0 + dx, lat0 + dy * 0.3);
        const [lng, lat] = p.inverse(x, y);
        expect(lng).toBeCloseTo(lng0 + dx, 9);
        expect(lat).toBeCloseTo(lat0 + dy * 0.3, 9);
      }
    }
  });

  it('preserves area', () => {
    // Exact area of a 1°x1° box on the sphere: R² Δλ (sin φ2 − sin φ1)
    const p = makeLaea(10, 45);
    const corners = [[9.5, 44.5], [10.5, 44.5], [10.5, 45.5], [9.5, 45.5]].map(([a, b]) => p.forward(a!, b!));
    let area = 0;
    for (let i = 0; i < corners.length; i++) {
      const [x1, y1] = corners[i]!;
      const [x2, y2] = corners[(i + 1) % corners.length]!;
      area += x1 * y2 - x2 * y1;
    }
    const R = 6371.007180918475;
    const exact = R * R * (Math.PI / 180) * (Math.sin((45.5 * Math.PI) / 180) - Math.sin((44.5 * Math.PI) / 180));
    expect(Math.abs(area) / 2 / exact).toBeCloseTo(1, 4);
  });

  it('measures north as +y', () => {
    const p = makeLaea(0, 0);
    expect(p.forward(0, 1)[1]).toBeGreaterThan(0);
  });
});

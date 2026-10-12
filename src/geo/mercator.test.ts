import { describe, expect, it } from 'vitest';
import { latToY, lngToX, pixelAreaKm2, rowAreaKm2, worldPx, xToLng, yToLat } from './mercator';

describe('web mercator (parity with the Python pipeline)', () => {
  it('matches pipeline values', () => {
    expect(lngToX(19.04, 7)).toBeCloseTo(18117.06311111111, 8);
    expect(latToY(47.5, 7)).toBeCloseTo(11458.317828576826, 8);
    expect(latToY(-33.87, 3)).toBeCloseTo(1228.9971528159522, 8);
    expect(yToLat(12345.5, 7)).toBeCloseTo(40.50126945841645, 10);
    expect(rowAreaKm2(11523, 7)).toBeCloseTo(0.6937700297683006, 12);
    expect(pixelAreaKm2(60, 5)).toBeCloseTo(5.969473757062509, 10);
  });

  it('round-trips and keeps unwrapped longitudes continuous past 180°', () => {
    expect(xToLng(lngToX(185, 7), 7)).toBeCloseTo(185, 9);
    expect(lngToX(185, 7)).toBeGreaterThan(worldPx(7));
    expect(yToLat(latToY(-17.5, 6), 6)).toBeCloseTo(-17.5, 9);
  });
});

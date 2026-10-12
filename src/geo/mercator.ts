/**
 * Web Mercator (XYZ tiles) on H3's authalic sphere — the same math as
 * pipeline/pp_pipeline/mercator.py, so decoded densities give back exact populations.
 * Longitudes may be "unwrapped" past ±180° for regions that cross the antimeridian.
 */
export const TILE_SIZE = 256;
export const EARTH_RADIUS_KM = 6371.007180918475;
export const CIRCUMFERENCE_KM = 2 * Math.PI * EARTH_RADIUS_KM;
export const MAX_LAT = 85.0511287798066;

const D2R = Math.PI / 180;

export const worldPx = (z: number): number => TILE_SIZE * 2 ** z;

export function lngToX(lng: number, z: number): number {
  return ((lng + 180) / 360) * worldPx(z);
}

export function latToY(lat: number, z: number): number {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R;
  return ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * worldPx(z);
}

export function xToLng(x: number, z: number): number {
  return (x / worldPx(z)) * 360 - 180;
}

export function yToLat(y: number, z: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / worldPx(z)))) / D2R;
}

export function pixelSizeKm(lat: number, z: number): number {
  return (CIRCUMFERENCE_KM * Math.cos(lat * D2R)) / worldPx(z);
}

export function pixelAreaKm2(lat: number, z: number): number {
  return pixelSizeKm(lat, z) ** 2;
}

/** Area of one pixel in global pixel row `row`, measured at the row's centre latitude. */
export function rowAreaKm2(row: number, z: number): number {
  return pixelAreaKm2(yToLat(row + 0.5, z), z);
}

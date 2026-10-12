import { EARTH_RADIUS_KM as R } from './mercator';

/** Lambert azimuthal equal-area projection (spherical) in km; +y is north. */
export interface Laea {
  readonly lng0: number;
  readonly lat0: number;
  forward(lng: number, lat: number): [number, number];
  inverse(x: number, y: number): [number, number];
}

const D2R = Math.PI / 180;

export function makeLaea(lng0: number, lat0: number): Laea {
  const sin0 = Math.sin(lat0 * D2R);
  const cos0 = Math.cos(lat0 * D2R);
  return {
    lng0,
    lat0,
    forward(lng, lat) {
      const dl = (lng - lng0) * D2R;
      const sp = Math.sin(lat * D2R);
      const cp = Math.cos(lat * D2R);
      const cdl = Math.cos(dl);
      const denom = 1 + sin0 * sp + cos0 * cp * cdl;
      if (denom <= 1e-12) return [Number.NaN, Number.NaN];
      const k = Math.sqrt(2 / denom);
      return [R * k * cp * Math.sin(dl), R * k * (cos0 * sp - sin0 * cp * cdl)];
    },
    inverse(x, y) {
      const rho = Math.hypot(x, y);
      if (rho < 1e-12) return [lng0, lat0];
      const c = 2 * Math.asin(Math.min(1, rho / (2 * R)));
      const sc = Math.sin(c);
      const cc = Math.cos(c);
      const lat = Math.asin(cc * sin0 + (y * sc * cos0) / rho);
      // atan2 keeps the result within ±180° of lng0, so unwrapped regions stay continuous.
      const lng = lng0 + Math.atan2(x * sc, rho * cos0 * cc - y * sin0 * sc) / D2R;
      return [lng, lat / D2R];
    },
  };
}

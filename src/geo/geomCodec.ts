/** A ring is a flat [lng0, lat0, lng1, lat1, ...] array, implicitly closed. */
export type Ring = Float64Array;
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];
export type BBox = [west: number, south: number, east: number, north: number];

const Q = 1e4;

/** Decode the pipeline's delta-encoded geometry (int 1e-4° steps) into rings. */
export function decodeGeometry(enc: unknown): MultiPolygon {
  if (!Array.isArray(enc)) throw new TypeError('geometry: expected an array of polygons');
  return enc.map((rings) => {
    if (!Array.isArray(rings)) throw new TypeError('geometry: expected an array of rings');
    return rings.map((flat) => {
      if (!Array.isArray(flat) || flat.length % 2 !== 0) throw new TypeError('geometry: bad ring');
      const out = new Float64Array(flat.length);
      let x = 0;
      let y = 0;
      for (let i = 0; i < flat.length; i += 2) {
        const dx = flat[i];
        const dy = flat[i + 1];
        if (typeof dx !== 'number' || typeof dy !== 'number') throw new TypeError('geometry: non-numeric coordinate');
        x += dx;
        y += dy;
        out[i] = x / Q;
        out[i + 1] = y / Q;
      }
      return out;
    });
  });
}

export function boundsOf(mp: MultiPolygon): BBox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i]!;
        const y = ring[i + 1]!;
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
    }
  }
  return [w, s, e, n];
}

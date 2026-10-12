import type { TileStore } from '../data/tileStore';
import type { BBox, MultiPolygon } from '../geo/geomCodec';
import { makeLaea } from '../geo/laea';
import { latToY, lngToX, pixelSizeKm, rowAreaKm2, TILE_SIZE, xToLng, yToLat } from '../geo/mercator';
import { rasterizeCircle, rasterizePolygons } from '../geo/rasterize';
import { gaussianBlur } from './blur';
import type { LngLat, RegionGrid, RegionRequest, RegionShape } from './types';

const MAX_TILES = 64;
const KM_PER_DEG_LAT = 110.57;

function circleBounds(lng: number, lat: number, radiusKm: number): BBox {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLng = radiusKm / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/** A circle as a 128-gon in lng/lat, for measuring it in Mercator space. */
function circlePolygon(lng: number, lat: number, radiusKm: number): MultiPolygon {
  const ring = new Float64Array(256);
  const kx = 111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * 2 * Math.PI;
    ring[2 * i] = lng + (radiusKm * Math.cos(a)) / kx;
    ring[2 * i + 1] = lat + (radiusKm * Math.sin(a)) / KM_PER_DEG_LAT;
  }
  return [[ring]];
}

function union(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function pad(b: BBox, frac: number): BBox {
  const dx = (b[2] - b[0]) * frac + 0.002;
  const dy = (b[3] - b[1]) * frac + 0.002;
  return [b[0] - dx, Math.max(-85, b[1] - dy), b[2] + dx, Math.min(85, b[3] + dy)];
}

function shapeBounds(shape: RegionShape, bbox: BBox): BBox {
  return shape.kind === 'circle' ? union(bbox, circleBounds(shape.lng, shape.lat, shape.radiusKm)) : bbox;
}

/** The coarsest zoom whose pixels still outnumber the output cells (capped by tile count). */
function chooseZoom(b: BBox, targetCells: number, maxZoom: number): number {
  let z = 0;
  for (; z < maxZoom; z++) {
    const span = Math.max(lngToX(b[2], z) - lngToX(b[0], z), latToY(b[1], z) - latToY(b[3], z));
    if (span >= targetCells) break;
  }
  while (z > 0) {
    const tx = Math.floor(lngToX(b[2], z) / TILE_SIZE) - Math.floor(lngToX(b[0], z) / TILE_SIZE) + 1;
    const ty = Math.floor(latToY(b[1], z) / TILE_SIZE) - Math.floor(latToY(b[3], z) / TILE_SIZE) + 1;
    if (tx * ty <= MAX_TILES) break;
    z--;
  }
  return z;
}

function project(polys: MultiPolygon, fn: (lng: number, lat: number) => [number, number]): Float64Array[][] {
  return polys.map((poly) =>
    poly.map((ring) => {
      const out = new Float64Array(ring.length);
      for (let i = 0; i < ring.length; i += 2) {
        const [x, y] = fn(ring[i]!, ring[i + 1]!);
        out[i] = x;
        out[i + 1] = y;
      }
      return out;
    }),
  );
}

function validate(req: RegionRequest): void {
  const finite = (...v: number[]) => v.every(Number.isFinite);
  if (!finite(...req.bbox) || req.bbox[2] < req.bbox[0] || req.bbox[3] < req.bbox[1]) throw new RangeError('region: bad bbox');
  if (!Number.isInteger(req.targetCells) || req.targetCells < 8 || req.targetCells > 2048) throw new RangeError('region: bad targetCells');
  if (req.shape.kind === 'circle') {
    const { lng, lat, radiusKm } = req.shape;
    if (!finite(lng, lat, radiusKm) || radiusKm <= 0 || radiusKm > 500) throw new RangeError('region: bad circle');
  }
}

/**
 * Fetch density tiles for a region, measure its population in Mercator space (exact
 * mass), and resample it onto an equal-area grid centred on the region for rendering.
 */
export async function buildRegion(req: RegionRequest, tiles: TileStore, signal?: AbortSignal): Promise<RegionGrid> {
  signal?.throwIfAborted();
  validate(req);
  const placeBounds = shapeBounds(req.shape, req.bbox);
  const bounds = pad(placeBounds, 0.04);
  const z = chooseZoom(bounds, req.targetCells, req.maxZoom ?? 7);

  // 1. Mosaic of Mercator tiles (x keeps counting past the antimeridian; the store wraps it).
  const tx0 = Math.floor(lngToX(bounds[0], z) / TILE_SIZE);
  const tx1 = Math.floor(lngToX(bounds[2], z) / TILE_SIZE);
  const ty0 = Math.max(0, Math.floor(latToY(bounds[3], z) / TILE_SIZE));
  const ty1 = Math.min(2 ** z - 1, Math.floor(latToY(bounds[1], z) / TILE_SIZE));
  const mw = (tx1 - tx0 + 1) * TILE_SIZE;
  const mh = (ty1 - ty0 + 1) * TILE_SIZE;
  const ox = tx0 * TILE_SIZE;
  const oy = ty0 * TILE_SIZE;
  const mosaic = new Float32Array(mw * mh);
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(
        tiles.get(z, tx, ty, signal).then((tile) => {
          if (!tile) return;
          const col = (tx - tx0) * TILE_SIZE;
          for (let r = 0; r < TILE_SIZE; r++) mosaic.set(tile.subarray(r * TILE_SIZE, (r + 1) * TILE_SIZE), ((ty - ty0) * TILE_SIZE + r) * mw + col);
        }),
      );
    }
  }
  await Promise.all(jobs);
  signal?.throwIfAborted();

  // 2. Population and peak, measured on the raw tiles so mass is exact.
  const statsShape: MultiPolygon =
    req.highlight ?? (req.shape.kind === 'polygons' ? req.shape.polygons : circlePolygon(req.shape.lng, req.shape.lat, req.shape.radiusKm));
  const mercCov = rasterizePolygons(
    project(statsShape, (lng, lat) => [lngToX(lng, z) - ox, latToY(lat, z) - oy]),
    mw,
    mh,
  );
  let population = 0;
  let peakDensity = 0;
  let peakIdx = -1;
  for (let r = 0; r < mh; r++) {
    const area = rowAreaKm2(oy + r, z);
    let rowSum = 0;
    for (let c = 0; c < mw; c++) {
      const i = r * mw + c;
      const cov = mercCov[i]!;
      if (cov === 0) continue;
      const d = mosaic[i]!;
      rowSum += d * cov;
      if (cov >= 0.5 && d > peakDensity) {
        peakDensity = d;
        peakIdx = i;
      }
    }
    population += rowSum * area;
  }
  const peak: LngLat =
    peakIdx >= 0
      ? [xToLng(ox + (peakIdx % mw) + 0.5, z), yToLat(oy + Math.floor(peakIdx / mw) + 0.5, z)]
      : [(placeBounds[0] + placeBounds[2]) / 2, (placeBounds[1] + placeBounds[3]) / 2];

  // 3. Equal-area output grid centred on the place.
  const center: LngLat =
    req.shape.kind === 'circle' ? [req.shape.lng, req.shape.lat] : [(placeBounds[0] + placeBounds[2]) / 2, (placeBounds[1] + placeBounds[3]) / 2];
  const proj = makeLaea(center[0], center[1]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const frame = pad(placeBounds, 0.03);
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    for (const [lng, lat] of [
      [frame[0] + (frame[2] - frame[0]) * t, frame[1]],
      [frame[0] + (frame[2] - frame[0]) * t, frame[3]],
      [frame[0], frame[1] + (frame[3] - frame[1]) * t],
      [frame[2], frame[1] + (frame[3] - frame[1]) * t],
    ] as const) {
      const [x, y] = proj.forward(lng, lat);
      if (!Number.isFinite(x + y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const cellKm = Math.max(maxX - minX, maxY - minY) / req.targetCells;
  const width = Math.max(1, Math.round((maxX - minX) / cellKm));
  const height = Math.max(1, Math.round((maxY - minY) / cellKm));
  minX = (minX + maxX) / 2 - (width * cellKm) / 2;
  maxY = (minY + maxY) / 2 + (height * cellKm) / 2;

  const sampled = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const y = maxY - (r + 0.5) * cellKm;
    for (let c = 0; c < width; c++) {
      const [lng, lat] = proj.inverse(minX + (c + 0.5) * cellKm, y);
      const fx = lngToX(lng, z) - ox - 0.5;
      const fy = latToY(lat, z) - oy - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      if (x0 < -1 || y0 < -1 || x0 >= mw || y0 >= mh) continue;
      const ax = fx - x0;
      const ay = fy - y0;
      const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= mw || yy >= mh ? 0 : mosaic[yy * mw + xx]!);
      sampled[r * width + c] =
        (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
    }
  }
  signal?.throwIfAborted();

  const dataPxKm = pixelSizeKm(center[1], z);
  const sigma = Math.min(6, Math.max(0.6, (0.55 * dataPxKm) / cellKm));
  const density = gaussianBlur(sampled, width, height, sigma);

  const toGrid = (lng: number, lat: number): [number, number] => {
    const [x, y] = proj.forward(lng, lat);
    return [(x - minX) / cellKm, (maxY - y) / cellKm];
  };
  let mask: Float32Array;
  if (req.shape.kind === 'circle') {
    const [cx, cy] = toGrid(req.shape.lng, req.shape.lat);
    mask = rasterizeCircle(cx, cy, req.shape.radiusKm / cellKm, width, height);
  } else {
    mask = rasterizePolygons(project(req.shape.polygons, toGrid), width, height);
  }
  const highlight = req.highlight ? rasterizePolygons(project(req.highlight, toGrid), width, height, 8) : undefined;

  return {
    width,
    height,
    cellKm,
    center,
    originKm: [minX, maxY],
    density,
    mask,
    ...(highlight ? { highlight } : {}),
    zoom: z,
    stats: { population, peakDensity, peak },
  };
}

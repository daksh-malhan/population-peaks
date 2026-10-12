import { LIMITS } from '../config';
import { type BBox, decodeGeometry } from '../geo/geomCodec';
import type { RegionRequest } from '../region/types';
import { COUNTRY_ID, type Manifest } from './manifest';

export type PlaceKind = 'country' | 'state' | 'city';
export type PlaceRef =
  | { kind: 'country'; id: string }
  | { kind: 'state'; id: string; country: string }
  | { kind: 'city'; id: string; country: string };

type CityRow = [id: string, name: string, lng: number, lat: number, pop: number];

interface Outline {
  bbox: BBox;
  area: number;
  tiny: boolean;
  geom: unknown;
}

export interface StateFile extends Outline {
  id: string;
  name: string;
  type: string;
}

export interface PlaceFile extends Outline {
  v: 1;
  id: string;
  name: string;
  states: StateFile[];
  cities: CityRow[];
}

export interface CityLabel {
  id: string;
  name: string;
  lng: number;
  lat: number;
  pop: number;
}

export interface ResolvedPlace {
  ref: PlaceRef;
  name: string;
  /** Human context line: "Country", "Province · Testland", "City · Testland". */
  context: string;
  countryName: string;
  tiny: boolean;
  region: Omit<RegionRequest, 'targetCells'>;
}

function checkPlaceFile(json: unknown, cid: string): PlaceFile {
  const p = json as PlaceFile;
  if (!p || p.v !== 1 || p.id !== cid || !Array.isArray(p.states) || !Array.isArray(p.cities) || !Array.isArray(p.bbox)) {
    throw new Error(`place file for ${cid} is malformed`);
  }
  return p;
}

/** Loads per-country place files (and official-border variants) from the data release, once each. */
export class PlaceRepository {
  private readonly files = new Map<string, Promise<PlaceFile>>();
  private readonly povFiles = new Map<string, Promise<Outline>>();
  private readonly known: Set<string>;
  private readonly get: (url: string) => Promise<Response>;

  constructor(
    private readonly dataUrl: string,
    readonly manifest: Manifest,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.known = new Set(manifest.countries.map((c) => c.id));
    // Call fetch unbound: browsers throw "Illegal invocation" if `this` is not the window.
    this.get = (url) => fetchImpl(url, { credentials: 'omit' });
  }

  private async json(path: string): Promise<unknown> {
    const res = await this.get(`${this.dataUrl}${path}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  country(cid: string): Promise<PlaceFile> {
    if (!COUNTRY_ID.test(cid) || !this.known.has(cid)) return Promise.reject(new Error(`unknown country: ${cid}`));
    let p = this.files.get(cid);
    if (!p) {
      p = this.json(`places/${cid}.json`).then((j) => checkPlaceFile(j, cid));
      p.catch(() => this.files.delete(cid));
      this.files.set(cid, p);
    }
    return p;
  }

  hasPov(pov: string | null | undefined, cid: string): pov is string {
    return !!pov && (this.manifest.povs[pov]?.includes(cid) ?? false);
  }

  pov(pov: string, cid: string): Promise<Outline> {
    const key = `${pov}/${cid}`;
    let p = this.povFiles.get(key);
    if (!p) {
      p = this.json(`places/pov/${pov}/${cid}.json`) as Promise<Outline>;
      p.catch(() => this.povFiles.delete(key));
      this.povFiles.set(key, p);
    }
    return p;
  }

  /** Cities (≥15k people) inside an unwrapped bbox, from every country that overlaps it. */
  async citiesIn(bbox: BBox): Promise<CityLabel[]> {
    const center = (bbox[0] + bbox[2]) / 2;
    const overlaps = (b: BBox) =>
      [-360, 0, 360].some((s) => b[0] + s <= bbox[2] && b[2] + s >= bbox[0]) && b[1] <= bbox[3] && b[3] >= bbox[1];
    const files = await Promise.all(this.manifest.countries.filter((c) => overlaps(c.bbox)).map((c) => this.country(c.id)));
    const out: CityLabel[] = [];
    for (const f of files) {
      for (const [id, name, lng0, lat, pop] of f.cities) {
        const lng = lng0 + 360 * Math.round((center - lng0) / 360);
        if (lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) out.push({ id, name, lng, lat, pop });
      }
    }
    return out.sort((a, b) => b.pop - a.pop);
  }
}

function regionFor(outline: Outline): Pick<ResolvedPlace, 'tiny' | 'region'> {
  const polygons = decodeGeometry(outline.geom);
  if (outline.tiny) {
    const b = outline.bbox;
    return {
      tiny: true,
      region: {
        bbox: b,
        shape: { kind: 'circle', lng: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2, radiusKm: LIMITS.tinyContextKm },
        highlight: polygons,
      },
    };
  }
  return { tiny: false, region: { bbox: outline.bbox, shape: { kind: 'polygons', polygons } } };
}

export function clampRadius(km: number | undefined): number {
  const { min, max, default: def } = LIMITS.cityRadiusKm;
  if (km === undefined || !Number.isFinite(km)) return def;
  return Math.min(max, Math.max(min, Math.round(km)));
}

export async function resolvePlace(
  repo: PlaceRepository,
  ref: PlaceRef,
  opts: { radiusKm?: number; pov?: string | null },
): Promise<ResolvedPlace> {
  if (ref.kind === 'country') {
    const file = await repo.country(ref.id);
    const outline = repo.hasPov(opts.pov, ref.id) ? await repo.pov(opts.pov, ref.id) : file;
    return { ref, name: file.name, context: 'Country', countryName: file.name, ...regionFor(outline) };
  }
  const file = await repo.country(ref.country);
  if (ref.kind === 'state') {
    const s = file.states.find((x) => x.id === ref.id);
    if (!s) throw new Error(`state ${ref.id} not found in ${ref.country}`);
    return { ref, name: s.name, context: `${s.type} · ${file.name}`, countryName: file.name, ...regionFor(s) };
  }
  const c = file.cities.find((x) => x[0] === ref.id);
  if (!c) throw new Error(`city ${ref.id} not found in ${ref.country}`);
  const radiusKm = clampRadius(opts.radiusKm);
  const [, name, lng, lat] = c;
  const dLat = radiusKm / 110.57;
  const dLng = radiusKm / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return {
    ref,
    name,
    context: `City · ${file.name}`,
    countryName: file.name,
    tiny: false,
    region: { bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat], shape: { kind: 'circle', lng, lat, radiusKm } },
  };
}

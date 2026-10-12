import type { BBox } from '../geo/geomCodec';

export interface CountryMeta {
  id: string;
  name: string;
  bbox: BBox;
  preview: boolean;
}

export interface SourceMeta {
  name: string;
  version: string;
  license: string;
  url: string;
}

export interface Manifest {
  v: 1;
  dataVersion: string;
  builtAt: string;
  tiles: { minZoom: number; maxZoom: number; size: number; scale: number; encoding: string };
  tileIndex: string[];
  countries: CountryMeta[];
  povs: Record<string, string[]>;
  tzPov: Record<string, string>;
  sources: SourceMeta[];
}

export const COUNTRY_ID = /^[A-Z]{2,3}$/;
const POV_ID = /^[A-Z]{3}$/;

function fail(what: string): never {
  throw new Error(`manifest: ${what}`);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBBox = (v: unknown): v is BBox => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Validate the data release's manifest; the client refuses data it cannot decode. */
export function parseManifest(json: unknown): Manifest {
  if (!isObj(json)) fail('not an object');
  if (json.v !== 1) fail(`unsupported version ${String(json.v)}`);
  const tiles = json.tiles;
  if (!isObj(tiles) || tiles.encoding !== 'zlib-u16le-log1p' || tiles.scale !== 256 || tiles.size !== 256) fail('unsupported tile encoding');
  if (!Array.isArray(json.tileIndex) || !json.tileIndex.every((s) => typeof s === 'string')) fail('bad tile index');
  if (!Array.isArray(json.countries)) fail('bad countries');
  for (const c of json.countries) {
    if (!isObj(c) || typeof c.id !== 'string' || !COUNTRY_ID.test(c.id) || typeof c.name !== 'string' || !isBBox(c.bbox)) fail('bad country entry');
  }
  if (!isObj(json.povs) || !Object.entries(json.povs).every(([k, v]) => POV_ID.test(k) && Array.isArray(v) && v.every((id) => typeof id === 'string' && COUNTRY_ID.test(id)))) fail('bad border views');
  if (!isObj(json.tzPov) || !Object.values(json.tzPov).every((v) => typeof v === 'string' && POV_ID.test(v))) fail('bad time zone map');
  if (!Array.isArray(json.sources)) fail('bad sources');
  return json as unknown as Manifest;
}

export async function loadManifest(dataUrl: string, fetchImpl: typeof fetch = fetch): Promise<Manifest> {
  const res = await fetchImpl(`${dataUrl}manifest.json`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  return parseManifest(await res.json());
}

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TileSource } from '../data/tileStore';

export const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/data/', import.meta.url));

export async function readJson<T>(rel: string): Promise<T> {
  return JSON.parse(await readFile(FIXTURE_DIR + rel, 'utf8')) as T;
}

/** Serves fixture tiles from disk and counts requests, standing in for HTTP in tests. */
export class FsTileSource implements TileSource {
  requests = 0;
  async fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    signal?.throwIfAborted();
    this.requests++;
    try {
      const buf = await readFile(`${FIXTURE_DIR}tiles/${z}/${x}/${y}.bin`);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch {
      return null;
    }
  }
}

export interface Expected {
  total: number;
  population: Record<string, number>;
  peak: Record<string, { city: string; lat: number; lng: number }>;
}

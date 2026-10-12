import { decodeTile } from './tileCodec';
import type { TileIndex } from './tileIndex';

export interface TileSource {
  fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null>;
}

export class HttpTileSource implements TileSource {
  constructor(private readonly dataUrl: string) {}

  async fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    const res = await fetch(`${this.dataUrl}tiles/${z}/${x}/${y}.bin`, { signal, credentials: 'omit', mode: 'same-origin' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: HTTP ${res.status}`);
    return res.arrayBuffer();
  }
}

function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Decoded tiles with an LRU cache. Tiles the index marks empty are never requested,
 * concurrent requests for one tile share a single fetch, and a caller's abort only
 * detaches that caller (the shared fetch still fills the cache).
 */
export class TileStore {
  private readonly cache = new Map<string, Float32Array | null>();
  private readonly inflight = new Map<string, Promise<Float32Array | null>>();

  constructor(
    private readonly source: TileSource,
    private readonly index: TileIndex,
    private readonly capacity = 96,
  ) {}

  async get(z: number, x: number, y: number, signal?: AbortSignal): Promise<Float32Array | null> {
    signal?.throwIfAborted();
    const n = 2 ** z;
    const wx = ((x % n) + n) % n;
    if (!this.index.has(z, wx, y)) return null;
    const key = `${z}/${wx}/${y}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key) ?? null;
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    let p = this.inflight.get(key);
    if (!p) {
      p = this.load(z, wx, y, key);
      this.inflight.set(key, p);
    }
    return abortable(p, signal);
  }

  private async load(z: number, x: number, y: number, key: string): Promise<Float32Array | null> {
    try {
      const buf = await this.source.fetchTile(z, x, y);
      const tile = buf ? await decodeTile(buf) : null;
      this.cache.set(key, tile);
      while (this.cache.size > this.capacity) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      return tile;
    } finally {
      this.inflight.delete(key);
    }
  }
}

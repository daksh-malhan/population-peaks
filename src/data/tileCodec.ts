/**
 * Density tiles: zlib(uint16le[256*256]) with v = round(ln(1 + d) * 256), d in people/km².
 * Decoded with DecompressionStream — never via canvas readback, which anti-fingerprinting
 * browsers deliberately perturb.
 */
export const TILE_SIZE = 256;
export const TILE_BYTES = TILE_SIZE * TILE_SIZE * 2;
export const LOG_SCALE = 256;

let lut: Float32Array | null = null;
function table(): Float32Array {
  if (!lut) {
    lut = new Float32Array(65536);
    for (let v = 0; v < 65536; v++) lut[v] = Math.expm1(v / LOG_SCALE);
  }
  return lut;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Inflate a zlib stream, refusing to produce more than `limit` bytes (no decompression bombs). */
export async function inflate(data: ArrayBuffer, limit = TILE_BYTES): Promise<Uint8Array> {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const out = new Uint8Array(limit);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > limit) {
      await reader.cancel();
      throw new Error('bad tile: inflates past its expected size');
    }
    out.set(value, size);
    size += value.byteLength;
  }
  return out.subarray(0, size);
}

export async function decodeTile(data: ArrayBuffer): Promise<Float32Array> {
  const raw = await inflate(data);
  if (raw.byteLength !== TILE_BYTES) throw new Error(`bad tile: ${raw.byteLength} bytes`);
  const t = table();
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  if (LITTLE_ENDIAN) {
    const u16 = new Uint16Array(raw.buffer, raw.byteOffset, out.length);
    for (let i = 0; i < out.length; i++) out[i] = t[u16[i]!]!;
  } else {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < out.length; i++) out[i] = t[dv.getUint16(i * 2, true)]!;
  }
  return out;
}

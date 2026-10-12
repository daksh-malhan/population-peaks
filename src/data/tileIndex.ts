/** Which tiles exist: one bitset per zoom, bit y·2^z + x, least significant bit first. */
export class TileIndex {
  private readonly bits: Uint8Array[];

  constructor(base64PerZoom: readonly string[]) {
    this.bits = base64PerZoom.map((s) => {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    });
  }

  get maxZoom(): number {
    return this.bits.length - 1;
  }

  has(z: number, x: number, y: number): boolean {
    const b = this.bits[z];
    if (!b) return false;
    const n = 2 ** z;
    if (y < 0 || y >= n) return false;
    const i = y * n + (((x % n) + n) % n);
    return ((b[i >> 3]! >> (i & 7)) & 1) === 1;
  }
}

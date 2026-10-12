/**
 * Anti-aliased polygon and circle coverage (0..1 per pixel) with the even-odd rule.
 *
 * Implemented in plain JS rather than via a 2D canvas because browsers with
 * anti-fingerprinting (Safari, Brave) add noise to canvas pixel readback.
 * Coordinates are in pixel units; rings are flat [x0, y0, x1, y1, ...] and implicitly closed.
 */

interface Edge {
  y0: number;
  y1: number;
  x0: number;
  dxdy: number;
}

function addSpan(cov: Float32Array, off: number, width: number, xa: number, xb: number, w: number): void {
  if (xb <= 0 || xa >= width || xb <= xa) return;
  const a = Math.max(0, xa);
  const b = Math.min(width, xb);
  const ia = Math.floor(a);
  const ib = Math.floor(b);
  if (ia === ib) {
    if (ia < width) cov[off + ia]! += (b - a) * w;
    return;
  }
  cov[off + ia]! += (ia + 1 - a) * w;
  for (let i = ia + 1; i < ib; i++) cov[off + i]! += w;
  if (ib < width) cov[off + ib]! += (b - ib) * w;
}

export function rasterizePolygons(
  polygons: ArrayLike<number>[][],
  width: number,
  height: number,
  samples = 4,
): Float32Array {
  const cov = new Float32Array(width * height);
  const edges: Edge[] = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      const n = ring.length >> 1;
      for (let i = 0; i < n; i++) {
        const x1 = ring[2 * i]!;
        const y1 = ring[2 * i + 1]!;
        const j = (i + 1) % n;
        const x2 = ring[2 * j]!;
        const y2 = ring[2 * j + 1]!;
        if (y1 === y2 || !Number.isFinite(x1 + y1 + x2 + y2)) continue;
        edges.push(y1 < y2 ? { y0: y1, y1: y2, x0: x1, dxdy: (x2 - x1) / (y2 - y1) } : { y0: y2, y1: y1, x0: x2, dxdy: (x1 - x2) / (y1 - y2) });
      }
    }
  }
  edges.sort((a, b) => a.y0 - b.y0);
  const inv = 1 / samples;
  let next = 0;
  let active: Edge[] = [];
  const xs: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let s = 0; s < samples; s++) {
      const y = row + (s + 0.5) * inv;
      while (next < edges.length && edges[next]!.y0 <= y) active.push(edges[next++]!);
      active = active.filter((e) => e.y1 > y);
      xs.length = 0;
      for (const e of active) xs.push(e.x0 + (y - e.y0) * e.dxdy);
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) addSpan(cov, row * width, width, xs[k]!, xs[k + 1]!, inv);
    }
  }
  for (let i = 0; i < cov.length; i++) if (cov[i]! > 1) cov[i] = 1;
  return cov;
}

export function rasterizeCircle(cx: number, cy: number, r: number, width: number, height: number, samples = 4): Float32Array {
  const cov = new Float32Array(width * height);
  const inv = 1 / samples;
  const r0 = Math.max(0, Math.floor(cy - r));
  const r1 = Math.min(height - 1, Math.ceil(cy + r));
  for (let row = r0; row <= r1; row++) {
    for (let s = 0; s < samples; s++) {
      const dy = row + (s + 0.5) * inv - cy;
      if (Math.abs(dy) >= r) continue;
      const hw = Math.sqrt(r * r - dy * dy);
      addSpan(cov, row * width, width, cx - hw, cx + hw, inv);
    }
  }
  return cov;
}

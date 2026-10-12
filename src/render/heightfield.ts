/** The legend runs from "Low" to "5,000+" people per km², like the reference poster. */
export const LEGEND_CAP = 5000;
const LOG_CAP = Math.log1p(LEGEND_CAP);

/**
 * Colour position (0..1) for a density: a squared log scale, so the countryside stays a
 * dark red speckle, towns read red and only real cities reach white.
 */
export function colorT(d: number): number {
  if (!(d > 0)) return 0;
  return Math.min(1, Math.log1p(d) / LOG_CAP) ** 2;
}

/** Highest smoothed density inside the region (mask ≥ 0.5). */
export function regionPeak(density: Float32Array, mask: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < density.length; i++) if (mask[i]! >= 0.5 && density[i]! > peak) peak = density[i]!;
  return peak;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Spike heights: linear in density (the honest look of the reference poster), normalised
 * by `peak` — the place's own peak, or the gallery's highest peak on the shared scale.
 * Heights fade to zero across the region's edge instead of ending in a cliff.
 */
export function buildHeights(density: Float32Array, mask: Float32Array, peak: number, scale: number, out?: Float32Array): Float32Array {
  const h = out ?? new Float32Array(density.length);
  if (!(peak > 0)) return h.fill(0);
  for (let i = 0; i < density.length; i++) h[i] = scale * Math.min(1, density[i]! / peak) * smoothstep(0.25, 0.75, mask[i]!);
  return h;
}

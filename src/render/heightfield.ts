/** The legend runs from "Low" to "5,000+" people per km², like the reference poster. */
export const LEGEND_CAP = 5000;

/** Densities (people/km²) the colour ramp spans: dark at `low`, white from `high` up. */
export interface ColorRange {
  low: number;
  high: number;
}

export const DEFAULT_RANGE: ColorRange = { low: 0, high: LEGEND_CAP };

/**
 * Above this share of a place's populated land at 5,000+, the fixed scale paints it white.
 * Measured: countries sit at 0.1–3%, city-states and 40 km city circles at 10–65%.
 */
const SATURATED = 0.1;

/**
 * Colour position (0..1) for a density: a squared log scale, so the countryside stays a
 * dark red speckle, towns read red and only real cities reach white.
 */
export function colorT(d: number, range: ColorRange = DEFAULT_RANGE): number {
  if (!(d > range.low)) return 0;
  const low = Math.log1p(range.low);
  return Math.min(1, (Math.log1p(d) - low) / (Math.log1p(range.high) - low)) ** 2;
}

/** Two significant figures, so legend numbers read like 7,000 or 31,000. */
function legendRound(x: number, round: (v: number) => number = Math.round): number {
  if (x < 10) return round(x);
  const p = 10 ** (Math.floor(Math.log10(x)) - 1);
  return round(x / p) * p;
}

/**
 * The colour range for a place. Most places keep the poster's fixed "Low … 5,000+". Where that
 * would paint most of the populated land white (a city-state, a dense city core), the range
 * follows the place's own densities instead: from a raised baseline (the 20th percentile of
 * its populated land) to the 99.5th, so only the very densest spots turn white.
 */
export function colorRangeFor(density: Float32Array, mask: Float32Array): ColorRange {
  const values = new Float32Array(density.length);
  let n = 0;
  let hot = 0;
  for (let i = 0; i < density.length; i++) {
    const d = density[i]!;
    if (mask[i]! < 0.5 || !(d >= 1)) continue;
    values[n++] = d;
    if (d >= LEGEND_CAP) hot++;
  }
  if (!n || hot / n <= SATURATED) return DEFAULT_RANGE;
  const sorted = values.subarray(0, n).sort();
  const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))]!;
  const high = legendRound(Math.max(LEGEND_CAP, at(0.995)));
  // The baseline rounds down, so nothing inside the range falls below it.
  return { low: legendRound(Math.min(at(0.2), high / 3), Math.floor), high };
}

/** The legend's two ends: "Low … 5,000+" on the fixed scale, real numbers on a place's own. */
export function legendLabels(range: ColorRange): [string, string] {
  const fmt = new Intl.NumberFormat('en-US');
  return [range.low > 0 ? fmt.format(range.low) : 'Low', `${fmt.format(range.high)}+`];
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

/**
 * Bloom strength for a region: full glow when only a few spikes are white-hot (a country
 * with one big city), much less when a broad city core is (a 40 km circle around Vienna).
 */
export function glowFor(density: Float32Array, mask: Float32Array, full = 0.5): number {
  // Judged on the fixed scale even when a dense place has its own colours: its broad core would
  // otherwise get a full glow and turn white again.
  let inside = 0;
  let hot = 0;
  for (let i = 0; i < density.length; i++) {
    if (mask[i]! < 0.5) continue;
    inside++;
    if (colorT(density[i]!) >= 0.95) hot++;
  }
  const frac = inside ? hot / inside : 0;
  return full * Math.min(1, Math.max(0.2, 0.02 / Math.max(frac, 1e-9)));
}

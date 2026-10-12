import type { PaletteId } from '../app/shareState';

export interface Palette {
  id: PaletteId;
  name: string;
  /** Page and poster background, and the soft glow behind the map. */
  background: string;
  backgroundGlow: string;
  /** Colour of the region outline. */
  edge: string;
  /** Colour ramp from empty land (t = 0) to the densest places (t = 1). Luminance rises monotonically. */
  stops: [number, string][];
  /** Colour of a tiny place's highlighted outline. */
  highlight: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  ember: {
    id: 'ember',
    name: 'Ember',
    background: '#0f1013',
    backgroundGlow: '#1d1e23',
    edge: '#7a2633',
    highlight: '#ffffff',
    stops: [[0, '#1a1c22'], [0.12, '#3a141e'], [0.3, '#7d1023'], [0.55, '#d42a44'], [0.8, '#ff8a9b'], [1, '#ffffff']],
  },
  glacier: {
    id: 'glacier',
    name: 'Glacier',
    background: '#0d1015',
    backgroundGlow: '#18202b',
    edge: '#2d5d8a',
    highlight: '#ffffff',
    stops: [[0, '#1a1d24'], [0.12, '#13263d'], [0.3, '#134a8a'], [0.55, '#2f8fe0'], [0.8, '#a6dcfa'], [1, '#ffffff']],
  },
  gold: {
    id: 'gold',
    name: 'Gold',
    background: '#100f0d',
    backgroundGlow: '#211d17',
    edge: '#7a5a1c',
    highlight: '#ffffff',
    stops: [[0, '#1d1b18'], [0.12, '#352610'], [0.3, '#7e4f08'], [0.55, '#e09a0c'], [0.8, '#ffdb7a'], [1, '#ffffff']],
  },
  mono: {
    id: 'mono',
    name: 'Mono',
    background: '#0f0f10',
    backgroundGlow: '#1d1d1f',
    edge: '#6a6a6a',
    highlight: '#ffffff',
    stops: [[0, '#1b1b1d'], [0.12, '#2c2c2e'], [0.3, '#555557'], [0.55, '#9a9a9c'], [0.8, '#d9d9db'], [1, '#ffffff']],
  },
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB colour (0..1 per channel) at position t of the palette's ramp. */
export function rampColor(p: Palette, t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const stops = p.stops;
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    if (x <= t1) {
      const [t0, c0] = stops[i - 1]!;
      const f = t1 === t0 ? 1 : (x - t0) / (t1 - t0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return hexToRgb(stops[stops.length - 1]![1]);
}

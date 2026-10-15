import type { ExportContext, Exporter } from '../app/app';
import { h } from '../ui/dom';
import { type Box, placeLabels } from './labels';
import { legendLabels } from './heightfield';
import { PALETTES, rampColor } from './palettes';
import type { MapScene } from './scene';

export type PosterFormat = 'portrait' | 'story' | 'print' | 'og';

export const POSTER_SIZES: Record<PosterFormat, [number, number]> = {
  portrait: [1080, 1350],
  story: [1080, 1920],
  print: [3240, 4050],
  og: [1200, 630],
};

const FONT = '"Sora Variable", "Sora", ui-sans-serif, system-ui, sans-serif';

export interface PosterLayout {
  u: number;
  margin: number;
  titleSize: number;
  minTitleSize: number;
  subtitleSize: number;
  mapTop: number;
  mapBottom: number;
  labelSize: number;
  legendY: number;
  legendSize: number;
  barWidth: number;
  barHeight: number;
  footerY: number;
  footerSize: number;
}

/** Measurements scale with width from the 1080 px reference poster. */
export function posterLayout(format: PosterFormat, W: number, H: number): PosterLayout {
  const u = W / 1080;
  const og = format === 'og';
  const titleSize = (og ? 46 : 64) * u;
  const margin = 72 * u;
  const legendY = H - (og ? 112 : 150) * u;
  return {
    u,
    margin,
    titleSize,
    minTitleSize: titleSize * 0.62,
    subtitleSize: (og ? 18 : 22) * u,
    mapTop: og ? H * 0.12 : margin + titleSize * 2.4 + 20 * u,
    mapBottom: legendY - 40 * u,
    labelSize: 18 * u,
    legendY,
    legendSize: 16 * u,
    barWidth: 240 * u,
    barHeight: 10 * u,
    footerY: H - (og ? 34 : 44) * u,
    footerSize: (og ? 17 : 20) * u,
  };
}

type Measure = (text: string, size: number) => number;

function greedy(words: string[], max: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(next, size) > max) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function fitChars(text: string, max: number, size: number, measure: Measure, suffix = ''): string {
  let out = text;
  while (out.length > 1 && measure(out + suffix, size) > max) out = out.slice(0, -1);
  return out.trimEnd() + suffix;
}

/** At most two lines: shrink the type first, truncate with an ellipsis only as a last resort. */
/**
 * Where the map may draw: the band between the title and the legend, as the frame's half-height in
 * NDC and how far (px) the frame's centre moves down from the image centre to sit in that band.
 */
export function mapFrame(L: PosterLayout, titleBottom: number, H: number): { ndcY: number; offsetY: number } {
  const top = Math.max(L.mapTop, titleBottom + 16 * L.u);
  const bottom = L.mapBottom;
  return { ndcY: Math.min(0.92, Math.max(0.3, (bottom - top) / H)), offsetY: (top + bottom) / 2 - H / 2 };
}

export function wrapTitle(text: string, max: number, size: number, minSize: number, measure: Measure): { lines: string[]; size: number } {
  const words = text.split(/\s+/).filter(Boolean);
  for (let s = size; ; s = Math.max(minSize, Math.floor(s * 0.94))) {
    const lines = greedy(words, max, s, measure);
    if (lines.length <= 2 && lines.every((l) => measure(l, s) <= max)) return { lines, size: s };
    if (s === minSize) break;
  }
  const s = minSize;
  const first = fitChars(text, max, s, measure);
  const rest = text.slice(first.length).trimStart();
  return { lines: rest ? [first, fitChars(rest, max, s, measure, '…')] : [first], size: s };
}

export function canPrintWith(caps: { maxTexture: number; coarsePointer: boolean; memoryGb: number | undefined }): boolean {
  return caps.maxTexture >= 8192 && !caps.coarsePointer && (caps.memoryGb === undefined || caps.memoryGb >= 4);
}

function hex(rgb: [number, number, number]): string {
  return `rgb(${rgb.map((v) => Math.round(v * 255)).join(' ')})`;
}

async function fontsReady(): Promise<void> {
  try {
    await Promise.all([700, 600, 400].map((w) => document.fonts.load(`${w} 32px ${FONT}`)));
  } catch {
    // fall back to the system font stack
  }
}

const LETTER_SPACING = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  if (LETTER_SPACING) {
    g.letterSpacing = `${spacing}px`;
    g.fillText(text, x, y);
    g.letterSpacing = '0px';
    return;
  }
  let cx = x;
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + spacing;
  }
}

function spacedWidth(g: CanvasRenderingContext2D, text: string, spacing: number): number {
  if (LETTER_SPACING) g.letterSpacing = '0px';
  return g.measureText(text).width + spacing * Math.max(0, [...text].length - 1);
}

/** Render the current view and lay out the poster: title, labels, legend, credits. */
export async function composePoster(scene: MapScene, ctx: ExportContext, format: PosterFormat): Promise<HTMLCanvasElement> {
  await fontsReady();
  const [W, H] = POSTER_SIZES[format];
  const L = posterLayout(format, W, H);
  const palette = PALETTES[ctx.paletteId];
  const out = h('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');

  // Title first, so the map can be framed below it.
  const maxTitle = W - 2 * L.margin;
  g.font = `700 ${L.titleSize}px ${FONT}`;
  const measure: Measure = (t, s) => {
    g.font = `700 ${s}px ${FONT}`;
    return g.measureText(t).width;
  };
  const title = wrapTitle(ctx.title, maxTitle, L.titleSize, L.minTitleSize, measure);
  const lineH = title.size * 1.12;
  const titleBottom = L.margin + lineH * title.lines.length + (ctx.subtitle ? L.subtitleSize * 1.6 : 0);

  const frame = mapFrame(L, titleBottom, H);
  const { image, project } = scene.renderImage(W, H, format === 'og' ? 0.62 : 0.9, frame.ndcY, frame.offsetY);
  g.drawImage(image, 0, 0);

  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff';
  g.font = `700 ${title.size}px ${FONT}`;
  title.lines.forEach((line, i) => g.fillText(line, L.margin, L.margin + title.size * 0.92 + i * lineH));
  if (ctx.subtitle) {
    g.font = `400 ${L.subtitleSize}px ${FONT}`;
    g.fillStyle = '#b8bac2';
    g.fillText(ctx.subtitle, L.margin, L.margin + lineH * title.lines.length + L.subtitleSize * 1.15, maxTitle);
  }

  // Labels, kept clear of the title, legend and footer.
  const labelSpacing = L.labelSize * 0.12;
  g.font = `600 ${L.labelSize}px ${FONT}`;
  const anchors = ctx.labels
    .map((c) => ({ c, p: project(c.lng, c.lat) }))
    .filter(({ p }) => p.visible)
    .map(({ c, p }) => ({ id: c.id, x: p.x, y: p.y, w: spacedWidth(g, c.name.toUpperCase(), labelSpacing), h: L.labelSize, name: c.name.toUpperCase() }));
  const obstacles: Box[] = [
    { x: 0, y: 0, w: W, h: titleBottom + 8 * L.u },
    { x: 0, y: L.legendY - L.legendSize * 1.4, w: W, h: H - (L.legendY - L.legendSize * 1.4) },
  ];
  const gap = 26 * L.u;
  const placed = placeLabels(anchors, { width: W, height: H }, gap, obstacles);
  placed.forEach((pl, i) => {
    const a = anchors[i]!;
    if (!pl.visible) return;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2 * L.u;
    g.beginPath();
    if (pl.side === 'above') {
      g.moveTo(a.x, a.y);
      g.lineTo(a.x, pl.y + a.h + 6 * L.u);
    } else if (pl.side === 'below') {
      g.moveTo(a.x, a.y);
      g.lineTo(a.x, pl.y - 6 * L.u);
    } else if (pl.side === 'right') {
      g.moveTo(a.x, a.y);
      g.lineTo(pl.x - 6 * L.u, a.y);
    } else {
      g.moveTo(a.x, a.y);
      g.lineTo(pl.x + a.w + 6 * L.u, a.y);
    }
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(a.x, a.y, 5.5 * L.u, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 2 * L.u;
    g.strokeStyle = 'rgb(15 16 19 / 0.7)';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = `600 ${L.labelSize}px ${FONT}`;
    g.shadowColor = 'rgb(0 0 0 / 0.6)';
    g.shadowBlur = 6 * L.u;
    spaced(g, a.name, pl.x, pl.y + a.h * 0.86, labelSpacing);
    g.shadowBlur = 0;
  });

  // Legend, like the reference: "People per km²", a ramp bar, Low … 5,000+ (or a dense place's own range).
  const [lowLabel, highLabel] = legendLabels(scene.colorRange);
  g.font = `400 ${L.legendSize}px ${FONT}`;
  g.fillStyle = '#e6e6ea';
  g.fillText('People per km²', L.margin, L.legendY);
  const barY = L.legendY + 12 * L.u;
  const grad = g.createLinearGradient(L.margin, 0, L.margin + L.barWidth, 0);
  for (const t of [0.12, 0.3, 0.55, 0.8, 1]) grad.addColorStop((t - 0.12) / 0.88, hex(rampColor(palette, t)));
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(L.margin, barY, L.barWidth, L.barHeight, L.barHeight / 2);
  g.fill();
  g.font = `400 ${L.legendSize * 1.1}px ${FONT}`;
  g.fillStyle = '#e6e6ea';
  const scaleY = barY + L.barHeight + L.legendSize * 1.6;
  g.fillText(lowLabel, L.margin, scaleY);
  g.textAlign = 'right';
  g.fillText(highLabel, L.margin + L.barWidth, scaleY);

  // Credits: optional author on the left, the data source (always) on the right.
  const credit = (label: string, value: string, x: number, align: CanvasTextAlign) => {
    g.textAlign = 'left';
    g.font = `400 ${L.footerSize}px ${FONT}`;
    const lw = g.measureText(label).width;
    g.font = `700 ${L.footerSize}px ${FONT}`;
    const vw = g.measureText(value).width;
    const start = align === 'right' ? x - lw - vw : x;
    g.font = `400 ${L.footerSize}px ${FONT}`;
    g.fillStyle = '#c9cad1';
    g.fillText(label, start, L.footerY);
    g.font = `700 ${L.footerSize}px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText(value, start + lw, L.footerY);
  };
  if (ctx.author) credit('Author: ', ctx.author, L.margin, 'left');
  credit('Source: ', 'Kontur Population 2023', W - L.margin, 'right');
  g.textAlign = 'right';
  g.font = `400 ${L.legendSize}px ${FONT}`;
  g.fillStyle = 'rgb(201 202 209 / 0.7)';
  g.fillText('Made with population peaks', W - L.margin, scaleY);
  g.textAlign = 'left';
  return out;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode PNG'))), 'image/png'));
}

async function deliver(blob: Blob, fileName: string, title: string): Promise<'downloaded' | 'shared' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { attrs: { href: url, download: fileName } });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export const posterExporter: Exporter = {
  canPrint(scene) {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return canPrintWith({ maxTexture: scene.maxTextureSize, coarsePointer: window.matchMedia('(pointer: coarse)').matches, memoryGb: memory });
  },
  async export(format, ctx) {
    const canvas = await composePoster(ctx.scene, ctx, format);
    return deliver(await toBlob(canvas), ctx.fileName, ctx.title);
  },
  render(format, ctx) {
    return composePoster(ctx.scene, ctx, format);
  },
};

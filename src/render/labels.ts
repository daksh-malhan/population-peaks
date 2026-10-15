export interface LabelCandidate {
  id: string;
  name: string;
  lng: number;
  lat: number;
  pop: number;
}

export interface LabelOptions {
  count: number;
  /** Skip cities this close to a bigger, already-labelled one (city districts). */
  minSepKm: number;
  hidden?: ReadonlySet<string>;
  added?: readonly string[];
  renamed?: Readonly<Record<string, string>>;
}

function km(a: LabelCandidate, b: LabelCandidate): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The biggest cities inside the region (as the poster labels them), with the user's edits applied. */
export function pickLabels(cands: readonly LabelCandidate[], inside: (lng: number, lat: number) => boolean, opts: LabelOptions): LabelCandidate[] {
  const pool = cands.filter((c) => inside(c.lng, c.lat)).sort((a, b) => b.pop - a.pop);
  const chosen: LabelCandidate[] = [];
  for (const c of pool) {
    if (chosen.length >= opts.count) break;
    if (opts.hidden?.has(c.id)) continue;
    if (chosen.some((x) => km(x, c) < opts.minSepKm)) continue;
    chosen.push(c);
  }
  for (const id of opts.added ?? []) {
    const c = pool.find((x) => x.id === id);
    if (c && !chosen.includes(c) && !opts.hidden?.has(id)) chosen.push(c);
  }
  return chosen.map((c) => (opts.renamed?.[c.id] ? { ...c, name: opts.renamed[c.id]! } : c));
}

export interface Anchor {
  id: string;
  /** Screen position of the label's point (the spike top). */
  x: number;
  y: number;
  /** Size of the label text box. */
  w: number;
  h: number;
}

export type Side = 'above' | 'right' | 'left' | 'below';

export interface Placement {
  id: string;
  x: number;
  y: number;
  side: Side;
  visible: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Greedy placement, biggest city first: above the point, else right, left, below; hidden if nothing
 * fits. Labels never cover each other, a shown city's dot, or `obstacles` (title, legend, footer).
 * A label avoids smaller cities' dots when it can; a smaller city whose dot it still covers is hidden.
 */
export function placeLabels(anchors: readonly Anchor[], frame: { width: number; height: number }, gap: number, obstacles: readonly Box[] = []): Placement[] {
  const taken: Box[] = [...obstacles];
  const r = gap * 0.3;
  const dots: Box[] = anchors.map((a) => ({ x: a.x - r, y: a.y - r, w: 2 * r, h: 2 * r }));
  const hit = (p: Box, b: Box) => !(p.x + p.w <= b.x || b.x + b.w <= p.x || p.y + p.h <= b.y || b.y + b.h <= p.y);
  return anchors.map((a, i) => {
    const hidden = { id: a.id, x: a.x, y: a.y, side: 'above' as Side, visible: false };
    if (taken.some((b) => hit(dots[i]!, b))) return hidden;
    const options: [Side, number, number][] = [
      ['above', a.x - a.w / 2, a.y - gap - a.h],
      ['right', a.x + gap * 0.7, a.y - a.h / 2],
      ['left', a.x - gap * 0.7 - a.w, a.y - a.h / 2],
      ['below', a.x - a.w / 2, a.y + gap],
    ];
    const free = options
      .map(([side, x, y]) => ({ side, box: { x, y, w: a.w, h: a.h } }))
      .filter(({ box }) => box.x >= 0 && box.y >= 0 && box.x + box.w <= frame.width && box.y + box.h <= frame.height && !taken.some((b) => hit(box, b)));
    const pick = free.find(({ box }) => !dots.slice(i + 1).some((d) => hit(box, d))) ?? free[0];
    if (!pick) return hidden;
    taken.push(pick.box, dots[i]!);
    return { id: a.id, x: pick.box.x, y: pick.box.y, side: pick.side, visible: true };
  });
}

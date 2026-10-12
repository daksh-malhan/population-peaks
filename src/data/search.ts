export interface SearchItem {
  /** 0 country, 1 state/province, 2 city */
  kind: 0 | 1 | 2;
  id: string;
  name: string;
  alts: string[];
  /** Context line, e.g. "Europe", "State · India", "Maharashtra, India". */
  ctx: string;
  /** Population (countries, cities) or summed city population (states); breaks ties. */
  rank: number;
  cid: string;
  lng?: number;
  lat?: number;
}

export interface SearchResult {
  item: SearchItem;
  score: number;
  /** The name or alias that matched. */
  matched: string;
}

/** Lower-case, accent-free, punctuation-as-space form used for matching ("São Paulo" → "sao paulo"). */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when a and b differ by at most one insertion, deletion, substitution or adjacent swap. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

interface Entry {
  item: SearchItem;
  names: { text: string; folded: string; tokens: string[]; alias: boolean }[];
}

const KIND_BONUS = [30, 10, 0] as const;

export class SearchIndex {
  private readonly entries: Entry[];

  constructor(items: SearchItem[]) {
    this.entries = items.map((item) => ({
      item,
      names: [item.name, ...item.alts].map((text, i) => {
        const folded = fold(text);
        return { text, folded, tokens: folded.split(' '), alias: i > 0 };
      }),
    }));
  }

  get size(): number {
    return this.entries.length;
  }

  query(raw: string, limit = 8): SearchResult[] {
    const q = fold(raw.slice(0, 100));
    if (!q) return [];
    const qTokens = q.split(' ');
    const fuzzy = qTokens.length === 1 && q.length >= 5;
    const results: SearchResult[] = [];
    for (const { item, names } of this.entries) {
      let best = 0;
      let matched = '';
      for (const n of names) {
        let s = 0;
        if (n.folded === q) s = 1000;
        else if (n.folded.startsWith(q)) s = 800;
        else if (qTokens.every((t) => n.tokens.some((nt) => nt.startsWith(t)))) s = 600;
        else if (n.folded.includes(q)) s = 300;
        else if (fuzzy && n.tokens.some((t) => withinOneEdit(q, t) || (t.length > q.length && withinOneEdit(q, t.slice(0, q.length))))) s = 150;
        if (n.alias) s *= 0.9;
        if (s > best) {
          best = s;
          matched = n.text;
        }
      }
      if (best > 0) results.push({ item, matched, score: best + 10 * Math.log10(item.rank + 1) + KIND_BONUS[item.kind] });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

const COUNTRY = /^[A-Z]{2,3}$/;

export function parseSearch(json: unknown): SearchItem[] {
  const j = json as { v?: unknown; items?: unknown };
  if (!j || j.v !== 1 || !Array.isArray(j.items)) throw new Error('search index: unsupported format');
  const out: SearchItem[] = [];
  for (const r of j.items) {
    if (!Array.isArray(r)) continue;
    const [kind, id, name, alts, ctx, rank, cid, lng, lat] = r as unknown[];
    if ((kind !== 0 && kind !== 1 && kind !== 2) || typeof id !== 'string' || typeof name !== 'string' || typeof cid !== 'string' || !COUNTRY.test(cid)) continue;
    const item: SearchItem = {
      kind,
      id,
      name,
      alts: Array.isArray(alts) ? alts.filter((a): a is string => typeof a === 'string') : [],
      ctx: typeof ctx === 'string' ? ctx : '',
      rank: typeof rank === 'number' && Number.isFinite(rank) ? rank : 0,
      cid,
    };
    if (typeof lng === 'number' && typeof lat === 'number') Object.assign(item, { lng, lat });
    out.push(item);
  }
  return out;
}

export async function loadSearch(dataUrl: string, fetchImpl: typeof fetch = fetch): Promise<SearchIndex> {
  const res = await fetchImpl(`${dataUrl}search.json`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`search index: HTTP ${res.status}`);
  return new SearchIndex(parseSearch(await res.json()));
}

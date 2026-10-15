import { LIMITS } from '../config';

export type CardKind = 'c' | 's' | 't';
export const PALETTES = ['ember', 'glacier', 'gold', 'mono'] as const;
export type PaletteId = (typeof PALETTES)[number];

export interface LabelEdits {
  hidden?: string[];
  added?: string[];
  renamed?: Record<string, string>;
}

/** One gallery card as stored in links and localStorage. c = country of a state/city, r = city radius km. */
export interface CardSpec {
  k: CardKind;
  id: string;
  c?: string;
  r?: number;
  ti?: string;
  st?: string;
  lb?: LabelEdits;
}

export interface SharedState {
  v: 1;
  cards: CardSpec[];
  /** Active card index */
  a?: number;
  pal?: PaletteId;
  /** Spike height multiplier */
  h?: number;
  /** Heights and colours: each place on its own scale, or the same across the gallery */
  sc?: 'own' | 'same';
  /** Poster author line */
  au?: string;
}

export interface Decoded {
  state: SharedState;
  warnings: string[];
}

const COUNTRY = /^[A-Z]{2,3}$/;
const STATE = /^[A-Z]{3}-\d{1,6}$/;
const CITY = /^\d{1,10}$/;
// C0/C1 controls, zero-width/bidi marks and overrides that could disguise text. Matching them is the point.
// eslint-disable-next-line no-control-regex, no-irregular-whitespace
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

const empty = (): SharedState => ({ v: 1, cards: [] });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Plain, single-line, length-capped text, or undefined if nothing usable remains. */
export function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return [...s].slice(0, max).join('').trim();
}

function cleanLabels(v: unknown): LabelEdits | undefined {
  if (!isObj(v)) return undefined;
  const max = LIMITS.maxLabelEdits;
  const ids = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && CITY.test(x)).slice(0, max) : []);
  const out: LabelEdits = {};
  const hidden = ids(v.hidden);
  const added = ids(v.added);
  if (hidden.length) out.hidden = hidden;
  if (added.length) out.added = added;
  if (isObj(v.renamed)) {
    const renamed: Record<string, string> = {};
    for (const [k, name] of Object.entries(v.renamed)) {
      const t = cleanText(name, 40);
      if (CITY.test(k) && t && Object.keys(renamed).length < max) renamed[k] = t;
    }
    if (Object.keys(renamed).length) out.renamed = renamed;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanCard(v: unknown): CardSpec | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  let card: CardSpec;
  if (v.k === 'c') {
    if (!COUNTRY.test(v.id)) return null;
    card = { k: 'c', id: v.id };
  } else if (v.k === 's' || v.k === 't') {
    if (typeof v.c !== 'string' || !COUNTRY.test(v.c)) return null;
    if (!(v.k === 's' ? STATE : CITY).test(v.id)) return null;
    card = { k: v.k, id: v.id, c: v.c };
    if (v.k === 't' && typeof v.r === 'number' && Number.isFinite(v.r)) {
      const { min, max } = LIMITS.cityRadiusKm;
      card.r = Math.min(max, Math.max(min, Math.round(v.r)));
    }
  } else {
    return null;
  }
  const ti = cleanText(v.ti, LIMITS.maxTextChars);
  const st = cleanText(v.st, LIMITS.maxTextChars);
  const lb = cleanLabels(v.lb);
  if (ti) card.ti = ti;
  if (st) card.st = st;
  if (lb) card.lb = lb;
  return card;
}

/** Turn anything (a parsed link, saved data) into a valid state plus human-readable warnings. Never throws. */
export function sanitizeState(raw: unknown): Decoded {
  const warnings: string[] = [];
  if (!isObj(raw)) return { state: empty(), warnings: ['This link is damaged, so it was ignored.'] };
  if (raw.v !== 1) return { state: empty(), warnings: ['This link comes from a different version of the site, so it was ignored.'] };
  const state = empty();
  const cards = Array.isArray(raw.cards) ? raw.cards : [];
  let dropped = 0;
  for (const c of cards.slice(0, LIMITS.maxCards)) {
    const card = cleanCard(c);
    if (card) state.cards.push(card);
    else dropped++;
  }
  if (dropped) warnings.push(`${dropped} place${dropped === 1 ? '' : 's'} in this link couldn't be read and ${dropped === 1 ? 'was' : 'were'} skipped.`);
  if (cards.length > LIMITS.maxCards) warnings.push(`Only the first ${LIMITS.maxCards} places were kept.`);
  if (typeof raw.a === 'number' && Number.isInteger(raw.a) && raw.a >= 0 && raw.a < state.cards.length) state.a = raw.a;
  if (PALETTES.includes(raw.pal as PaletteId)) state.pal = raw.pal as PaletteId;
  if (typeof raw.h === 'number' && Number.isFinite(raw.h)) state.h = Math.round(Math.min(3, Math.max(0.25, raw.h)) * 100) / 100;
  if (raw.sc === 'own' || raw.sc === 'same') state.sc = raw.sc;
  const au = cleanText(raw.au, 60);
  if (au) state.au = au;
  return { state, warnings };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeState(state: SharedState): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(state)));
}

export function decodeState(encoded: string): Decoded {
  if (encoded.length > LIMITS.maxShareChars) return { state: empty(), warnings: ['This link is too long, so it was ignored.'] };
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return { state: empty(), warnings: ['This link is damaged, so it was ignored.'] };
  try {
    const json: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(encoded)));
    return sanitizeState(json);
  } catch {
    return { state: empty(), warnings: ['This link is damaged, so it was ignored.'] };
  }
}

export function stateToHash(state: SharedState): string {
  return `#s=${encodeState(state)}`;
}

/** null when the hash is not a share link at all. */
export function stateFromHash(hash: string): Decoded | null {
  const m = /^#s=(.*)$/s.exec(hash);
  return m ? decodeState(m[1]!) : null;
}

import { LIMITS } from '../config';
import { type CardSpec, type PaletteId, type SharedState, encodeState } from './shareState';

export interface GalleryState {
  cards: CardSpec[];
  /** Index of the card on the stage, or -1 when the gallery is empty. */
  active: number;
  palette: PaletteId;
  height: number;
  scale: 'own' | 'same';
  author: string;
}

export const DEFAULTS = { palette: 'ember' as PaletteId, height: 1, scale: 'own' as const };

export function initialState(): GalleryState {
  return { cards: [], active: -1, palette: DEFAULTS.palette, height: DEFAULTS.height, scale: DEFAULTS.scale, author: '' };
}

export function sameCard(a: CardSpec, b: CardSpec): boolean {
  return a.k === b.k && a.id === b.id && (a.c ?? '') === (b.c ?? '');
}

export type AddResult = 'added' | 'duplicate' | 'full';

export function addCard(state: GalleryState, spec: CardSpec): { state: GalleryState; result: AddResult } {
  const existing = state.cards.findIndex((c) => sameCard(c, spec));
  if (existing >= 0) return { state: { ...state, active: existing }, result: 'duplicate' };
  if (state.cards.length >= LIMITS.maxCards) return { state, result: 'full' };
  const cards = [...state.cards, spec];
  return { state: { ...state, cards, active: cards.length - 1 }, result: 'added' };
}

export function removeCard(state: GalleryState, index: number): GalleryState {
  if (index < 0 || index >= state.cards.length) return state;
  const cards = state.cards.filter((_, i) => i !== index);
  let active = state.active;
  if (cards.length === 0) active = -1;
  else if (index < active || active >= cards.length) active = Math.max(0, active - 1);
  return { ...state, cards, active };
}

export function moveActive(state: GalleryState, index: number): GalleryState {
  return index >= 0 && index < state.cards.length ? { ...state, active: index } : state;
}

export function updateCard(state: GalleryState, index: number, patch: Partial<CardSpec>): GalleryState {
  const cards = state.cards.map((c, i) => (i === index ? { ...c, ...patch } : c));
  return { ...state, cards };
}

export function specFromSearch(item: { kind: 0 | 1 | 2; id: string; cid: string }): CardSpec {
  if (item.kind === 0) return { k: 'c', id: item.id };
  if (item.kind === 1) return { k: 's', id: item.id, c: item.cid };
  return { k: 't', id: item.id, c: item.cid, r: LIMITS.cityRadiusKm.default };
}

/** The link payload: only what differs from the defaults. */
export function toShared(state: GalleryState): SharedState {
  const s: SharedState = { v: 1, cards: state.cards };
  if (state.active > 0) s.a = state.active;
  if (state.palette !== DEFAULTS.palette) s.pal = state.palette;
  if (state.height !== DEFAULTS.height) s.h = state.height;
  if (state.scale !== DEFAULTS.scale) s.sc = state.scale;
  if (state.author) s.au = state.author;
  return s;
}

export function fromShared(shared: SharedState): GalleryState {
  return {
    cards: shared.cards,
    active: shared.cards.length ? (shared.a ?? 0) : -1,
    palette: shared.pal ?? DEFAULTS.palette,
    height: shared.h ?? DEFAULTS.height,
    scale: shared.sc ?? DEFAULTS.scale,
    author: shared.au ?? '',
  };
}

/** A link that reopens this gallery. Galleries that start with a country use its preview page. */
export function shareUrl(state: GalleryState, siteUrl: string): string {
  const first = state.cards[0];
  const path = first?.k === 'c' ? `p/${first.id.toLowerCase()}/` : '';
  return `${siteUrl}${path}#s=${encodeState(toShared(state))}`;
}

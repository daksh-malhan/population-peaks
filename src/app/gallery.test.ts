import { describe, expect, it } from 'vitest';
import { addCard, cardKey, initialState, moveActive, removeCard, sameCard, shareUrl, specFromSearch, staleKeys, toShared, type GalleryState } from './gallery';
import { decodeState } from './shareState';

const site = 'https://example.org/population-peaks/';

describe('gallery state', () => {
  it('adds a place and makes it active', () => {
    const r = addCard(initialState(), { k: 'c', id: 'HU' });
    expect(r.result).toBe('added');
    expect(r.state.cards.map((c) => c.id)).toEqual(['HU']);
    expect(r.state.active).toBe(0);
  });

  it('activates instead of duplicating a place already in the gallery', () => {
    let s = addCard(initialState(), { k: 'c', id: 'HU' }).state;
    s = addCard(s, { k: 'c', id: 'AT' }).state;
    const r = addCard(s, { k: 'c', id: 'HU' });
    expect(r.result).toBe('duplicate');
    expect(r.state.cards).toHaveLength(2);
    expect(r.state.active).toBe(0);
  });

  it('treats the same city at a different radius as the same place', () => {
    expect(sameCard({ k: 't', id: '1', c: 'IN', r: 40 }, { k: 't', id: '1', c: 'IN', r: 25 })).toBe(true);
    expect(cardKey({ k: 't', id: '1', c: 'IN', r: 40 })).toBe(cardKey({ k: 't', id: '1', c: 'IN', r: 25 }));
  });

  it('gives different places different card keys, whatever their ids contain', () => {
    const specs = [
      { k: 'c', id: 'IN' },
      { k: 's', id: 'IN', c: 'IN' },
      { k: 't', id: '1', c: 'IN' },
      { k: 't', id: '1:x', c: 'IN' },
      { k: 't', id: 'x', c: 'IN:1' },
    ] as const;
    expect(new Set(specs.map((s) => cardKey(s))).size).toBe(specs.length);
  });

  it('refuses a 25th place', () => {
    let s = initialState();
    for (let i = 0; i < 24; i++) s = addCard(s, { k: 't', id: String(i + 1), c: 'IN' }).state;
    const r = addCard(s, { k: 'c', id: 'HU' });
    expect(r.result).toBe('full');
    expect(r.state.cards).toHaveLength(24);
  });

  it('keeps a sensible active card when removing', () => {
    let s = initialState();
    for (const id of ['HU', 'AT', 'CH']) s = addCard(s, { k: 'c', id }).state;
    s = removeCard(s, 2);
    expect(s.active).toBe(1);
    s = moveActive(s, 0);
    s = removeCard(s, 0);
    expect(s.cards.map((c) => c.id)).toEqual(['AT']);
    expect(s.active).toBe(0);
    s = removeCard(s, 0);
    expect(s.cards).toEqual([]);
    expect(s.active).toBe(-1);
  });

  it('turns search results into card specs', () => {
    expect(specFromSearch({ kind: 0, id: 'HU', cid: 'HU' })).toEqual({ k: 'c', id: 'HU' });
    expect(specFromSearch({ kind: 1, id: 'USA-3521', cid: 'US' })).toEqual({ k: 's', id: 'USA-3521', c: 'US' });
    expect(specFromSearch({ kind: 2, id: '1259229', cid: 'IN' })).toEqual({ k: 't', id: '1259229', c: 'IN', r: 40 });
  });
});

describe('share URLs', () => {
  const state: GalleryState = {
    ...initialState(),
    cards: [{ k: 'c', id: 'HU' }, { k: 't', id: '1', c: 'IN', r: 30 }],
    active: 1,
    palette: 'gold',
    height: 1.4,
    scale: 'same',
    author: 'Daksh',
  };

  it('round-trips everything a viewer needs through the link', () => {
    const url = shareUrl(state, site);
    const hash = url.slice(url.indexOf('#') + 3);
    expect(decodeState(hash).state).toEqual(toShared(state));
    expect(toShared(state)).toEqual({ v: 1, cards: state.cards, a: 1, pal: 'gold', h: 1.4, sc: 'same', au: 'Daksh' });
  });

  it("uses the country's preview page when the gallery starts with a country", () => {
    expect(shareUrl(state, site).startsWith(`${site}p/hu/#s=`)).toBe(true);
    const cityFirst = { ...state, cards: [{ k: 't' as const, id: '1', c: 'IN', r: 30 }] };
    expect(shareUrl(cityFirst, site).startsWith(`${site}#s=`)).toBe(true);
  });

  it('leaves defaults out of the link', () => {
    expect(toShared({ ...initialState(), cards: [{ k: 'c', id: 'HU' }], active: 0 })).toEqual({ v: 1, cards: [{ k: 'c', id: 'HU' }] });
  });
});

describe('cached regions', () => {
  it('keeps only the regions the gallery still shows', () => {
    const state = { ...initialState(), cards: [{ k: 'c' as const, id: 'HU' }, { k: 't' as const, id: '1', c: 'IN', r: 30 }], active: 0 };
    const key = (c: { k: string; id: string; r?: number }) => `${c.k}:${c.id}:${c.r ?? ''}`;
    expect(staleKeys(['c:HU:', 't:1:40', 't:1:30', 'c:AT:'], state, key)).toEqual(['t:1:40', 'c:AT:']);
  });
});

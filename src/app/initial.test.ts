import { describe, expect, it } from 'vitest';
import { chooseInitial } from './initial';
import { encodeState } from './shareState';

const base = '/population-peaks/';
const countries = new Set(['HU', 'AT', 'ZZ']);

describe('choosing the first gallery', () => {
  it('opens a share link first', () => {
    const hash = `#s=${encodeState({ v: 1, cards: [{ k: 'c', id: 'AT' }], pal: 'gold' })}`;
    const r = chooseInitial({ hash, pathname: `${base}p/hu/`, base, saved: { v: 1, cards: [{ k: 'c', id: 'ZZ' }] }, countries });
    expect(r.state.cards).toEqual([{ k: 'c', id: 'AT' }]);
    expect(r.state.palette).toBe('gold');
    expect(r.fromLink).toBe(true);
  });

  it('passes on warnings from a damaged link and falls back', () => {
    const r = chooseInitial({ hash: '#s=%%%', pathname: base, base, saved: null, countries });
    expect(r.warnings[0]).toMatch(/damaged/);
    expect(r.state.cards).toEqual([{ k: 'c', id: 'HU' }]);
  });

  it("opens a country's preview page", () => {
    const r = chooseInitial({ hash: '', pathname: `${base}p/at/`, base, saved: null, countries });
    expect(r.state.cards).toEqual([{ k: 'c', id: 'AT' }]);
    expect(r.fromLink).toBe(true);
  });

  it('ignores preview pages for unknown countries', () => {
    const r = chooseInitial({ hash: '', pathname: `${base}p/zz9/`, base, saved: null, countries });
    expect(r.state.cards).toEqual([{ k: 'c', id: 'HU' }]);
  });

  it('restores the saved gallery when there is no link', () => {
    const r = chooseInitial({ hash: '', pathname: base, base, saved: { v: 1, cards: [{ k: 'c', id: 'ZZ' }], a: 0 }, countries });
    expect(r.state.cards).toEqual([{ k: 'c', id: 'ZZ' }]);
    expect(r.fromLink).toBe(false);
  });

  it('starts first-time visitors on Hungary, or the first country when the data has no Hungary', () => {
    expect(chooseInitial({ hash: '', pathname: base, base, saved: null, countries }).state.cards).toEqual([{ k: 'c', id: 'HU' }]);
    expect(chooseInitial({ hash: '', pathname: base, base, saved: null, countries: new Set(['ZZ', 'ZX']) }).state.cards).toEqual([{ k: 'c', id: 'ZZ' }]);
  });

  it('drops cards whose country is not in the data', () => {
    const hash = `#s=${encodeState({ v: 1, cards: [{ k: 'c', id: 'FR' }, { k: 'c', id: 'AT' }] })}`;
    const r = chooseInitial({ hash, pathname: base, base, saved: null, countries });
    expect(r.state.cards).toEqual([{ k: 'c', id: 'AT' }]);
    expect(r.warnings.join(' ')).toMatch(/1 place/);
  });
});

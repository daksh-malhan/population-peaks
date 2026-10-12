import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, sanitizeState, type SharedState, stateFromHash, stateToHash } from './shareState';

const sample: SharedState = {
  v: 1,
  cards: [
    { k: 'c', id: 'HU' },
    { k: 's', id: 'USA-3521', c: 'US', ti: 'Golden State' },
    { k: 't', id: '1259229', c: 'IN', r: 25, lb: { hidden: ['1'], added: ['2'], renamed: { '3': 'Poona' } } },
  ],
  a: 1,
  pal: 'glacier',
  h: 1.5,
  sc: 'same',
  au: 'Daksh',
};

describe('share links', () => {
  it('round-trips a gallery through the URL hash', () => {
    const hash = stateToHash(sample);
    expect(hash.startsWith('#s=')).toBe(true);
    expect(hash).toMatch(/^#s=[A-Za-z0-9_-]+$/);
    const back = stateFromHash(hash);
    expect(back?.warnings).toEqual([]);
    expect(back?.state).toEqual(sample);
  });

  it('round-trips non-ASCII text', () => {
    const s: SharedState = { v: 1, cards: [{ k: 'c', id: 'JP', ti: '東京の人口 — São Paulo' }] };
    expect(decodeState(encodeState(s)).state).toEqual(s);
  });

  it('ignores hashes that are not share links', () => {
    expect(stateFromHash('')).toBeNull();
    expect(stateFromHash('#about')).toBeNull();
  });
});

describe('hostile or damaged links never throw and never pass unsafe data through', () => {
  const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('rejects bad base64', () => {
    const r = decodeState('%%%not base64%%%');
    expect(r.state.cards).toEqual([]);
    expect(r.warnings[0]).toMatch(/damaged/);
  });

  it('rejects valid base64 that is not JSON', () => {
    expect(decodeState(b64('<script>alert(1)</script>')).warnings[0]).toMatch(/damaged/);
  });

  it('rejects unknown versions', () => {
    expect(decodeState(b64(JSON.stringify({ v: 2, cards: [{ k: 'c', id: 'HU' }] }))).warnings[0]).toMatch(/version/);
  });

  it('rejects links longer than the limit', () => {
    const r = decodeState('A'.repeat(10_000));
    expect(r.state.cards).toEqual([]);
    expect(r.warnings[0]).toMatch(/too long/);
  });

  it('keeps at most 24 cards', () => {
    const cards = Array.from({ length: 25 }, () => ({ k: 'c', id: 'HU' }));
    const r = sanitizeState({ v: 1, cards });
    expect(r.state.cards).toHaveLength(24);
    expect(r.warnings.join()).toMatch(/24/);
  });

  it('drops cards with malformed ids, including script-like ones', () => {
    const r = sanitizeState({
      v: 1,
      cards: [
        { k: 'c', id: '<script>' },
        { k: 's', id: 'USA-3521' },
        { k: 't', id: '12ab', c: 'IN' },
        { k: 'x', id: 'HU' },
        { k: 'c', id: 'HU' },
        'junk',
        null,
      ],
    });
    expect(r.state.cards).toEqual([{ k: 'c', id: 'HU' }]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('clamps city radius and spike height', () => {
    const r = sanitizeState({ v: 1, cards: [{ k: 't', id: '1', c: 'IN', r: 5000 }, { k: 't', id: '2', c: 'IN', r: -3 }], h: 99 });
    expect(r.state.cards.map((c) => c.r)).toEqual([100, 10]);
    expect(r.state.h).toBe(3);
  });

  it('strips control and bidi-override characters and caps text length', () => {
    const r = sanitizeState({
      v: 1,
      cards: [{ k: 'c', id: 'HU', ti: 'A\u0000B‮txt.exe\u0007' + 'x'.repeat(200) }],
      au: 'Me\n\r\tYou',
    });
    const ti = r.state.cards[0]!.ti!;
    expect(ti.startsWith('ABtxt.exe')).toBe(true);
    expect([...ti].length).toBe(80);
    expect(r.state.au).toBe('Me You');
  });

  it('drops unknown palettes, scale modes and active indexes', () => {
    const r = sanitizeState({ v: 1, cards: [{ k: 'c', id: 'HU' }], pal: 'neon', sc: 'weird', a: 7 });
    expect(r.state).toEqual({ v: 1, cards: [{ k: 'c', id: 'HU' }] });
  });

  it('caps label edits and validates their city ids', () => {
    const many = Array.from({ length: 30 }, (_, i) => String(i + 1));
    const r = sanitizeState({
      v: 1,
      cards: [{ k: 'c', id: 'HU', lb: { hidden: [...many, 'bad'], renamed: { '1': 'One', x: 'nope', '2': 5 } } }],
    });
    expect(r.state.cards[0]!.lb).toEqual({ hidden: many.slice(0, 20), renamed: { '1': 'One' } });
  });

  it('accepts a 10 kB JSON payload only up to the link limit', () => {
    const big = b64(JSON.stringify({ v: 1, cards: [{ k: 'c', id: 'HU', ti: 'y'.repeat(10_000) }] }));
    expect(decodeState(big).warnings[0]).toMatch(/too long/);
  });
});

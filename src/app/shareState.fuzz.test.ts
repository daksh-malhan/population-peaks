import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../config';
import { type CardSpec, decodeState, encodeState, PALETTES, sanitizeState, type SharedState } from './shareState';

// Share links are the one input anyone can hand the app, so the decoder is fuzzed:
// whatever arrives, it must not throw, and what it returns must be a state the app can trust.

// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;

function expectCleanText(t: string | undefined, max: number): void {
  if (t === undefined) return;
  expect(t.length).toBeGreaterThan(0);
  expect([...t].length).toBeLessThanOrEqual(max);
  expect(t).not.toMatch(UNSAFE);
  expect(t).toBe(t.trim());
  expect(t).not.toMatch(/\s\s/);
}

function expectCard(c: CardSpec): void {
  expect(Object.keys(c).every((k) => ['k', 'id', 'c', 'r', 'ti', 'st', 'lb'].includes(k))).toBe(true);
  if (c.k === 'c') {
    expect(c.id).toMatch(/^[A-Z]{2,3}$/);
    expect(c.c).toBeUndefined();
  } else {
    expect(c.id).toMatch(c.k === 's' ? /^[A-Z]{3}-\d{1,6}$/ : /^\d{1,10}$/);
    expect(c.c).toMatch(/^[A-Z]{2,3}$/);
  }
  if (c.r !== undefined) {
    expect(c.k).toBe('t');
    expect(Number.isInteger(c.r) && c.r >= LIMITS.cityRadiusKm.min && c.r <= LIMITS.cityRadiusKm.max).toBe(true);
  }
  expectCleanText(c.ti, LIMITS.maxTextChars);
  expectCleanText(c.st, LIMITS.maxTextChars);
  for (const ids of [c.lb?.hidden, c.lb?.added]) {
    if (!ids) continue;
    expect(ids.length).toBeLessThanOrEqual(LIMITS.maxLabelEdits);
    for (const id of ids) expect(id).toMatch(/^\d{1,10}$/);
  }
  const renamed = Object.entries(c.lb?.renamed ?? {});
  expect(renamed.length).toBeLessThanOrEqual(LIMITS.maxLabelEdits);
  for (const [id, name] of renamed) {
    expect(id).toMatch(/^\d{1,10}$/);
    expectCleanText(name, 40);
  }
}

function expectTrusted(s: SharedState): void {
  expect(s.v).toBe(1);
  expect(s.cards.length).toBeLessThanOrEqual(LIMITS.maxCards);
  s.cards.forEach(expectCard);
  if (s.a !== undefined) expect(Number.isInteger(s.a) && s.a >= 0 && s.a < s.cards.length).toBe(true);
  if (s.pal !== undefined) expect(PALETTES).toContain(s.pal);
  if (s.h !== undefined) expect(s.h >= 0.25 && s.h <= 3).toBe(true);
  if (s.sc !== undefined) expect(['own', 'same']).toContain(s.sc);
  expectCleanText(s.au, 60);
}

// Text with the characters a forged link would use: controls, bidi overrides, zero-width marks, odd spaces.
const nasty = fc.string({
  unit: fc.oneof(
    fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
    fc.constantFrom('\u0000', '\n', '\t', '\u0085', '​', '‏', '‮', '⁦', '﻿', ' ', '　', ' ', '<', '>', '"', '&'),
  ),
  maxLength: 120,
});
const country = fc.stringMatching(/^[A-Z]{2,3}$/);
const cityId = fc.stringMatching(/^\d{1,10}$/);
/** Usually a plausible value, sometimes anything at all. */
const field = <T>(good: fc.Arbitrary<T>) => fc.oneof({ weight: 5, arbitrary: good }, { weight: 1, arbitrary: fc.anything() });

const labelIds = field(fc.array(fc.oneof(cityId, nasty), { maxLength: 30 }));
const labels = fc.record(
  {
    hidden: labelIds,
    added: labelIds,
    renamed: field(fc.dictionary(fc.oneof(cityId, nasty, fc.constantFrom('__proto__', 'constructor')), field(nasty), { maxKeys: 30 })),
  },
  { requiredKeys: [] },
);
const extras = { r: field(fc.oneof(fc.double(), fc.integer())), ti: field(nasty), st: field(nasty), lb: field(labels) };
// Mostly well-formed cards, so the fuzzer gets past "is this a card" to the text and label checks.
const card = fc.oneof(
  fc.record({ k: field(fc.constant('c')), id: field(country), ...extras }, { requiredKeys: ['k', 'id'] }),
  fc.record({ k: field(fc.constant('s')), id: field(fc.stringMatching(/^[A-Z]{3}-\d{1,6}$/)), c: field(country), ...extras }, { requiredKeys: ['k', 'id', 'c'] }),
  fc.record({ k: field(fc.constant('t')), id: field(cityId), c: field(country), ...extras }, { requiredKeys: ['k', 'id', 'c'] }),
  fc.anything(),
);
const stateLike = fc.record(
  {
    v: field(fc.constant(1)),
    cards: field(fc.array(card, { maxLength: 30 })),
    a: field(fc.integer({ min: -2, max: 30 })),
    pal: field(fc.constantFrom(...PALETTES, 'neon')),
    h: field(fc.double()),
    sc: field(fc.constantFrom('own', 'same', 'other')),
    au: field(nasty),
  },
  { requiredKeys: ['v'] },
);

const RUNS = { numRuns: 2000 };

describe('share link decoder under fuzzing', () => {
  it('turns any parsed value into a trusted state, and its output is already clean', () => {
    fc.assert(
      fc.property(fc.oneof(stateLike, fc.anything()), (raw) => {
        const { state, warnings } = sanitizeState(raw);
        expectTrusted(state);
        const again = sanitizeState(state);
        expect(again.state).toEqual(state);
        expect(again.warnings).toEqual([]);
        if (state.cards.length) expect(warnings.every((w) => typeof w === 'string')).toBe(true);
      }),
      RUNS,
    );
  });

  it('never throws on any link text', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary', maxLength: 300 }), fc.base64String({ maxLength: 300 }), fc.stringMatching(/^[A-Za-z0-9_-]{0,300}$/)), (s) => {
        expectTrusted(decodeState(s).state);
      }),
      RUNS,
    );
  });

  it('reads back every state it writes', () => {
    fc.assert(
      fc.property(stateLike, (raw) => {
        const { state } = sanitizeState(raw);
        const link = encodeState(state);
        fc.pre(link.length <= LIMITS.maxShareChars);
        expect(decodeState(link)).toEqual({ state, warnings: [] });
      }),
      RUNS,
    );
  });

  it('cannot reach Object.prototype through crafted keys', () => {
    fc.assert(
      fc.property(fc.constantFrom('__proto__', 'constructor', 'prototype'), nasty, (key, name) => {
        const json = `{"v":1,"${key}":{"polluted":1},"cards":[{"k":"t","id":"1","c":"HU","lb":{"renamed":{"${key}":${JSON.stringify(name)},"__proto__":{"polluted":1}}}}]}`;
        expectTrusted(sanitizeState(JSON.parse(json)).state);
        expect(Object.prototype).not.toHaveProperty('polluted');
      }),
      { numRuns: 200 },
    );
  });
});

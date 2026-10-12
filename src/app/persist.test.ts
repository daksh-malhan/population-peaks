import { describe, expect, it } from 'vitest';
import { loadGallery, loadPrefs, saveGallery, savePrefs, type StorageLike } from './persist';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
};

describe('persistence', () => {
  it('round-trips the gallery', () => {
    const s = memory();
    saveGallery(s, { v: 1, cards: [{ k: 'c', id: 'HU' }], pal: 'gold' });
    expect(loadGallery(s)).toEqual({ v: 1, cards: [{ k: 'c', id: 'HU' }], pal: 'gold' });
  });

  it('survives storage that throws (private mode, blocked site data)', () => {
    expect(loadGallery(throwing)).toBeNull();
    expect(() => saveGallery(throwing, { v: 1, cards: [] })).not.toThrow();
    expect(loadPrefs(throwing)).toEqual({ pov: 'auto' });
    expect(() => savePrefs(throwing, { pov: 'none' })).not.toThrow();
    expect(loadGallery(null)).toBeNull();
  });

  it('ignores corrupted or hostile saved data', () => {
    const s = memory();
    s.data.set('pp.gallery.v1', '{not json');
    expect(loadGallery(s)).toBeNull();
    s.data.set('pp.gallery.v1', JSON.stringify({ v: 1, cards: [{ k: 'c', id: '<img src=x>' }] }));
    expect(loadGallery(s)).toEqual({ v: 1, cards: [] });
    s.data.set('pp.prefs.v1', JSON.stringify({ pov: '../../x' }));
    expect(loadPrefs(s)).toEqual({ pov: 'auto' });
  });
});

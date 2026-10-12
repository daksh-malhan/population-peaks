import { describe, expect, it } from 'vitest';
import { readJson } from '../test/fixture';
import { fixtureFetch } from '../test/fetch';
import { loadManifest, parseManifest } from './manifest';

describe('manifest', () => {
  it('loads the fixture manifest', async () => {
    const { fetch } = fixtureFetch();
    const m = await loadManifest('/population-peaks/data/', fetch);
    expect(m.dataVersion).toBe('fixture');
    expect(m.countries.map((c) => c.id).sort()).toEqual(['ZX', 'ZY', 'ZZ']);
    expect(m.povs.IND).toEqual(['ZZ']);
    expect(m.tzPov['Asia/Kolkata']).toBe('IND');
  });

  it('rejects manifests from an unknown format version or with missing parts', async () => {
    const good = await readJson<Record<string, unknown>>('manifest.json');
    expect(() => parseManifest({ ...good, v: 2 })).toThrow(/version/);
    expect(() => parseManifest({ ...good, tileIndex: 'nope' })).toThrow();
    expect(() => parseManifest({ ...good, countries: [{ id: '<img>', name: 'x', bbox: [0, 0, 1, 1] }] })).toThrow();
    expect(() => parseManifest(null)).toThrow();
  });
});

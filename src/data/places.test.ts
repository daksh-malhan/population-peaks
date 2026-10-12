import { describe, expect, it } from 'vitest';
import { readJson } from '../test/fixture';
import { fixtureFetch } from '../test/fetch';
import { parseManifest } from './manifest';
import { PlaceRepository, resolvePlace } from './places';

async function repo() {
  const manifest = parseManifest(await readJson('manifest.json'));
  const f = fixtureFetch();
  return { repo: new PlaceRepository('/population-peaks/data/', manifest, f.fetch), calls: f.calls };
}

describe('place repository', () => {
  it('fetches each country file once', async () => {
    const { repo: r, calls } = await repo();
    await Promise.all([r.country('ZZ'), r.country('ZZ')]);
    await r.country('ZZ');
    expect(calls.filter((c) => c.endsWith('places/ZZ.json'))).toHaveLength(1);
  });

  it('refuses ids that are not in the manifest without fetching', async () => {
    const { repo: r, calls } = await repo();
    await expect(r.country('../../etc')).rejects.toThrow(/unknown country/);
    expect(calls).toHaveLength(0);
  });
});

describe('resolvePlace', () => {
  it('resolves a country to its outline', async () => {
    const { repo: r } = await repo();
    const p = await resolvePlace(r, { kind: 'country', id: 'ZZ' }, {});
    expect(p.name).toBe('Testland');
    expect(p.region.shape.kind).toBe('polygons');
    expect(p.region.bbox[0]).toBeCloseTo(-41, 3);
  });

  it("uses a viewer's official border view when one exists for that country", async () => {
    const { repo: r } = await repo();
    const p = await resolvePlace(r, { kind: 'country', id: 'ZZ' }, { pov: 'IND' });
    expect(p.region.bbox[2]).toBeCloseTo(-39.2, 3);
    const q = await resolvePlace(r, { kind: 'country', id: 'ZX' }, { pov: 'IND' });
    expect(q.region.bbox[2]).toBeGreaterThan(180);
  });

  it('resolves a state with its type and country', async () => {
    const { repo: r } = await repo();
    const p = await resolvePlace(r, { kind: 'state', id: 'ZZZ-1', country: 'ZZ' }, {});
    expect(p.name).toBe('North Testland');
    expect(p.context).toBe('Province · Testland');
  });

  it('resolves a city to a circle with the requested radius, clamped to 10–100 km', async () => {
    const { repo: r } = await repo();
    const p = await resolvePlace(r, { kind: 'city', id: '9000001', country: 'ZZ' }, { radiusKm: 25 });
    expect(p.name).toBe('Capital City');
    expect(p.region.shape).toMatchObject({ kind: 'circle', radiusKm: 25, lat: 30.1, lng: -40.4 });
    const big = await resolvePlace(r, { kind: 'city', id: '9000001', country: 'ZZ' }, { radiusKm: 5000 });
    expect(big.region.shape).toMatchObject({ radiusKm: 100 });
  });

  it('shows tiny places inside a 10 km context circle with their outline highlighted', async () => {
    const { repo: r } = await repo();
    const p = await resolvePlace(r, { kind: 'country', id: 'ZY' }, {});
    expect(p.tiny).toBe(true);
    expect(p.region.shape).toMatchObject({ kind: 'circle', radiusKm: 10 });
    expect(p.region.highlight).toBeDefined();
  });

  it('rejects unknown states and cities', async () => {
    const { repo: r } = await repo();
    await expect(resolvePlace(r, { kind: 'state', id: 'ZZZ-9', country: 'ZZ' }, {})).rejects.toThrow(/not found/);
    await expect(resolvePlace(r, { kind: 'city', id: '1', country: 'ZZ' }, {})).rejects.toThrow(/not found/);
  });

  it('lists label candidates around a region, from neighbouring countries too', async () => {
    const { repo: r } = await repo();
    const labels = await r.citiesIn([179, -18, 181, -16.5]);
    expect(labels.map((c) => c.name).sort()).toEqual(['Date City', 'Meridian']);
    expect(labels.find((c) => c.name === 'Meridian')!.lng).toBeCloseTo(180.3, 3);
  });
});

describe('browser fetch semantics', () => {
  it('calls fetch without binding it to the repository (browsers throw "Illegal invocation")', async () => {
    const manifest = parseManifest(await readJson('manifest.json'));
    const inner = fixtureFetch().fetch;
    const strict = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return inner(input, init);
    } as typeof fetch;
    const r = new PlaceRepository('/population-peaks/data/', manifest, strict);
    await expect(r.country('ZZ')).resolves.toMatchObject({ id: 'ZZ' });
  });
});

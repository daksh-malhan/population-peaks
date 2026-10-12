import { describe, expect, it } from 'vitest';
import { fixtureFetch } from '../test/fetch';
import { loadSearch, SearchIndex, type SearchItem } from './search';

const item = (kind: 0 | 1 | 2, id: string, name: string, rank: number, alts: string[] = [], cid = 'XX'): SearchItem => ({
  kind, id, name, alts, ctx: '', rank, cid,
});

const index = new SearchIndex([
  item(2, '2867714', 'Munich', 1_260_000, ['München', 'Muenchen'], 'DE'),
  item(2, '1259229', 'Pune', 3_120_000, [], 'IN'),
  item(1, 'IND-2449', 'Punjab', 30_000_000, [], 'IN'),
  item(2, '3054643', 'Budapest', 1_740_000, [], 'HU'),
  item(2, '1', 'Durham', 10_000_000),
  item(2, '2', 'Hamilton', 500_000),
  item(0, 'GE', 'Georgia', 3_700_000, ['Sakartvelo']),
  item(1, 'USA-3536', 'Georgia', 3_000_000, [], 'US'),
  item(2, '3', 'São Paulo', 12_000_000, [], 'BR'),
]);

const names = (q: string) => index.query(q).map((r) => r.item.name);

describe('search', () => {
  it('finds places by local spelling, without diacritics', () => {
    expect(names('munchen')[0]).toBe('Munich');
    expect(names('MÜNCHEN')[0]).toBe('Munich');
    expect(names('sao paulo')[0]).toBe('São Paulo');
  });

  it('ranks an exact name above a bigger place that merely starts the same', () => {
    expect(names('pune')[0]).toBe('Pune');
  });

  it('ranks a prefix match above a substring match', () => {
    expect(names('ham')).toEqual(['Hamilton', 'Durham']);
  });

  it('tolerates one typo in words of five letters or more', () => {
    expect(names('budpest')[0]).toBe('Budapest');
    expect(names('bdu')).toEqual([]);
  });

  it('prefers the country when a country and a state share a name', () => {
    const r = index.query('georgia');
    expect(r[0]!.item.kind).toBe(0);
    expect(r[1]!.item.kind).toBe(1);
  });

  it('reports which alias matched', () => {
    expect(index.query('sakartvelo')[0]!.matched).toBe('Sakartvelo');
  });

  it('returns nothing for blank or punctuation-only queries, and caps results', () => {
    expect(index.query('   ')).toEqual([]);
    expect(index.query('?!')).toEqual([]);
    expect(index.query('a', 3).length).toBeLessThanOrEqual(3);
  });

  it('loads the fixture index', async () => {
    const { fetch } = fixtureFetch();
    const s = await loadSearch('/population-peaks/data/', fetch);
    expect(s.query('testland')[0]!.item).toMatchObject({ kind: 0, id: 'ZZ' });
    expect(s.query('capital city')[0]!.item).toMatchObject({ kind: 2, cid: 'ZZ' });
    expect(s.query('nordland')[0]!.item.id).toBe('ZZZ-1');
  });
});

import { readFile } from 'node:fs/promises';
import { FIXTURE_DIR } from './fixture';

/** A fetch() that serves fixtures/data for URLs under `base`, and records what was asked for. */
export function fixtureFetch(base = '/population-peaks/data/') {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (!url.startsWith(base)) return new Response('not found', { status: 404 });
    try {
      return new Response(await readFile(FIXTURE_DIR + url.slice(base.length)), { status: 200 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
  return { fetch: impl as typeof fetch, calls };
}

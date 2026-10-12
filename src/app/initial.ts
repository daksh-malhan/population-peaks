import { fromShared, type GalleryState, initialState } from './gallery';
import { type SharedState, stateFromHash } from './shareState';

export interface InitialInput {
  hash: string;
  pathname: string;
  base: string;
  saved: SharedState | null;
  /** Country ids present in the data release. */
  countries: ReadonlySet<string>;
}

export interface Initial {
  state: GalleryState;
  warnings: string[];
  /** Opened from a share link or preview page (so it shouldn't overwrite the visitor's saved gallery). */
  fromLink: boolean;
}

function knownOnly(shared: SharedState, countries: ReadonlySet<string>, warnings: string[]): SharedState {
  const cards = shared.cards.filter((c) => countries.has(c.k === 'c' ? c.id : (c.c ?? '')));
  const dropped = shared.cards.length - cards.length;
  if (dropped) warnings.push(`${dropped} place${dropped === 1 ? '' : 's'} in this link ${dropped === 1 ? 'is' : 'are'} not in the map data and ${dropped === 1 ? 'was' : 'were'} skipped.`);
  const a = shared.a !== undefined && shared.a < cards.length ? shared.a : undefined;
  return { ...shared, cards, ...(a !== undefined ? { a } : { a: undefined }) };
}

function strip(s: SharedState): SharedState {
  const out = { ...s };
  if (out.a === undefined) delete out.a;
  return out;
}

/** Share link, then a /p/<id>/ preview page, then the saved gallery, then Hungary. */
export function chooseInitial(input: InitialInput): Initial {
  const warnings: string[] = [];
  const decoded = stateFromHash(input.hash);
  if (decoded) {
    warnings.push(...decoded.warnings);
    const shared = strip(knownOnly(decoded.state, input.countries, warnings));
    if (shared.cards.length) return { state: fromShared(shared), warnings, fromLink: true };
  }
  const m = new RegExp(`^${input.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}p/([a-z]{2,3})/?$`).exec(input.pathname);
  const pathId = m?.[1]?.toUpperCase();
  if (pathId && input.countries.has(pathId)) return { state: fromShared({ v: 1, cards: [{ k: 'c', id: pathId }] }), warnings, fromLink: true };
  if (input.saved?.cards.length) {
    const shared = strip(knownOnly(input.saved, input.countries, []));
    if (shared.cards.length) return { state: fromShared(shared), warnings, fromLink: false };
  }
  const first = input.countries.has('HU') ? 'HU' : [...input.countries][0];
  return { state: first ? fromShared({ v: 1, cards: [{ k: 'c', id: first }] }) : initialState(), warnings, fromLink: false };
}

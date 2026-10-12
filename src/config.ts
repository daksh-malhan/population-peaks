/** Root of the deployed site, e.g. "/population-peaks/". Always ends with "/". */
export const BASE_URL: string = import.meta.env.BASE_URL;

/** Where the data release is served from (tiles, places, search index, previews). */
export const DATA_URL = `${BASE_URL}data/`;

/** Absolute public URL, used for share links and social previews. */
export const SITE_URL: string =
  (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://daksh-malhan.github.io/population-peaks/';

export const LIMITS = {
  maxCards: 24,
  maxShareChars: 6000,
  maxTextChars: 80,
  maxLabelEdits: 20,
  cityRadiusKm: { min: 10, max: 100, default: 40 },
  tinyContextKm: 10,
} as const;

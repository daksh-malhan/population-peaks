# Data format

A data release is a `data/` directory served at `/population-peaks/data/`.

## `manifest.json`

```json
{
  "v": 1,
  "dataVersion": "2023-11-01-r1",
  "builtAt": "2026-10-14T00:00:00Z",
  "tiles": { "minZoom": 0, "maxZoom": 7, "size": 256, "scale": 256, "encoding": "zlib-u16le-log1p" },
  "tileIndex": ["<base64 bitset for z0>", "...", "<base64 bitset for z7>"],
  "countries": [{ "id": "HU", "name": "Hungary", "bbox": [16.1, 45.7, 22.9, 48.6], "preview": true }],
  "povs": { "IND": ["CN", "IN", "PK"] },
  "tzPov": { "Asia/Kolkata": "IND", "Asia/Calcutta": "IND" },
  "sources": [{ "name": "Kontur Population", "version": "2023-11-01", "license": "CC BY 4.0", "url": "…", "files": { "HU": "<sha256>" } }]
}
```

The client refuses any other `v` or tile encoding.

## Tiles: `tiles/{z}/{x}/{y}.bin`

- Web Mercator XYZ tiles (on H3's authalic sphere), 256 × 256 px, zoom 0–7.
- Payload: zlib (`DecompressionStream('deflate')`) of 65,536 little-endian `uint16`, row-major, north row first.
- Value: `v = round(ln(1 + d) × 256)`, where `d` is people per km² of that pixel, so `d = exp(v / 256) − 1`.
  The error is at most `(1 + d) × 0.2%`.
- Population of a pixel = `d × area`, with area measured at the pixel row's centre latitude:
  `(2π · 6371.007 km · cos φ / (256 · 2^z))²`.
- Empty tiles are not written. Bit `y · 2^z + x` (least significant bit first) of `tileIndex[z]` says whether a tile exists, so the client never requests a missing one.

## Places: `places/{id}.json`

```json
{
  "v": 1, "id": "HU", "name": "Hungary",
  "bbox": [w, s, e, n], "area": 93011, "tiny": false, "geom": [[[x0, y0, dx1, dy1, …]]],
  "states": [{ "id": "HUN-3160", "name": "Budapest", "type": "Capital City", "bbox": […], "area": 525, "tiny": false, "geom": […] }],
  "cities": [["3054643", "Budapest", 19.0399, 47.498, 1741041]]
}
```

- `geom`: polygons → rings → flat integers in 1e-4° steps: the first pair is absolute, the rest are deltas. Rings are implicitly closed and filled even-odd.
- Longitudes are *unwrapped*: a region that crosses 180° keeps counting past it (Fiji's `bbox` is `[177.1, …, 181.8, …]`), and `east > west` always holds.
- Countries are framed on their main landmass. Distant parts (Alaska, French Guiana) are left out of the country outline but remain as their own states.
- `tiny` places (under 100 km²) are shown inside a 10 km circle with their outline highlighted.
- `cities` lists every city with at least 15,000 people, by population, for labels.
- Ids: countries use ISO 3166-1 alpha-2 (or Natural Earth's `ADM0_A3`, e.g. `SOL`); states use Natural Earth `adm1_code`; cities use GeoNames ids.

### Official border views: `places/pov/{VIEW}/{id}.json`

`{ "v": 1, "id", "bbox", "area", "tiny", "geom" }`, written only for countries whose outline differs in that view (`manifest.povs`).

## Search: `search.json`

```json
{ "v": 1, "items": [[kind, id, name, aliases, context, rank, countryId, lng, lat]] }
```

`kind`: 0 country, 1 state or province, 2 city (cities over 100,000 people; only cities carry `lng` and `lat`).
`rank` is the population (countries, cities) or the summed city population (states).

## Previews

- `previews/og/{id}.jpg`: 1200 × 630 link preview used by `/p/{id}/` pages.
- `previews/poster/{id}.jpg`: 540 × 675 poster shown when a device has no WebGL2.

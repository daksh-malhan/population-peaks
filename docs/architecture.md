# Architecture

population peaks is a static site. Everything a visitor needs is either in the page, in a
pre-built data release, or in their own browser.

```
pipeline/ (Python)          release (GitHub)            site (GitHub Pages)
─────────────────          ────────────────            ───────────────────
Kontur 250 files ─┐        data-<ver>.tar.gz           index.html + /p/<id>/ pages
NE + GeoNames    ─┼──────▶  + .sha256        ──deploy──▶ assets/ (JS, CSS, fonts)
render-previews  ─┘        (pinned by                  data/  (tiles, places, search,
                            data-release.json)                 manifest, previews)
```

## Data pipeline (`pipeline/pp_pipeline`)

| Module | Job |
|---|---|
| `kontur.py` | Lists Kontur's per-country files on HDX. Downloads only from the Kontur S3 bucket over HTTPS, checks size and ETag (MD5, or multipart MD5 with 8 MiB parts), records SHA-256. Reads each GeoPackage (SQLite) and validates every row: a res-8 H3 cell and a finite, non-negative population. |
| `mercator.py` | Web Mercator on H3's authalic sphere, so pixel areas agree with H3 cell areas. |
| `splat.py` | Spreads each cell's population over z7 pixels by exact overlap of a square footprint with the cell's true area, so mass is conserved. Works in 64 shards of 4096 px; cells crossing a shard edge or the antimeridian go to every shard they touch. Border cells shared by two country files are deduplicated by H3 id. |
| `tiles.py` | Encodes density tiles and builds z7 → z0 by summing mass, so every zoom level holds the same population. |
| `geom.py` | Outline preparation: unwraps parts across ±180°, frames a country on its main landmass (the most populous part anchors a cluster; big, populous or nearby parts join; near-empty specks may hop only 100 km), simplifies by extent, and encodes geometry. |
| `places.py` | Builds country files (outline, states, cities ≥15k for labels), the search index (countries, states, cities ≥100k), official border views (31 Natural Earth points of view, kept only where they differ; a view that would leave a country under 1% of its usual area, make it over 10× larger, or that hits a known Natural Earth slip keeps the usual outline), and the time-zone → view map. City aliases lead with Natural Earth's own-language and local names. |
| `sources.py` | Fetches Natural Earth at a pinned commit, verified against git blob hashes, and GeoNames from an allow-listed host. Writes `manifest.json`. |
| `fixture.py` | A deterministic synthetic world (Testland, Dateland across 180°, tiny Microland), built with the real writers for the client's tests. |

## Web app (`src/`)

| Area | Modules |
|---|---|
| Data | `data/tileCodec.ts` (inflate with a size cap, decode), `tileIndex.ts`, `tileStore.ts` (LRU, shared in-flight fetches, abort), `manifest.ts`, `places.ts` (place files, border views, label candidates), `search.ts` |
| Geometry | `geo/mercator.ts` (parity with the pipeline), `laea.ts` (equal-area projection), `rasterize.ts` (anti-aliased even-odd polygons and circles), `geomCodec.ts` |
| Regions | `region/buildRegion.ts` runs in `worker/region.worker.ts`. It mosaics the tiles, measures population and the peak in Mercator space (exact mass), resamples to an equal-area grid, blurs, and rasterises the mask and highlight. `region/client.ts` is the abortable RPC. |
| Rendering | `render/scene.ts` (three.js height field, palette colours, bloom scaled to how much of the place is white-hot, outline, camera fitted to the footprint, ray-marched hover, context-loss recovery, off-screen poster renders), `heightfield.ts`, `palettes.ts`, `labels.ts`, `poster.ts` |
| App | `app/app.ts` (controller), `gallery.ts`, `shareState.ts` (link schema and sanitising), `persist.ts`, `initial.ts`, `pov.ts`, `format.ts` |
| UI | `ui/dom.ts` (the only DOM builder; refuses `style` and `on*` attributes), `searchBox.ts` (ARIA 1.2 combobox), `galleryStrip.ts`, `posterPanel.ts`, `mapLabels.ts`, `aboutDialog.ts`, `toast.ts`, `thumbnail.ts` |

### Startup

1. Load `manifest.json`. If it fails, show a retry screen. Without WebGL2, show the country's pre-rendered poster on `/p/<id>/` pages.
2. Choose the gallery: share link (`#s=`), then a `/p/<id>/` page, then the saved gallery, then Hungary. A gallery opened from a link doesn't overwrite the visitor's saved one until they edit it.
3. Paint the page shell (title, legend, panel), and only then create the WebGL context. On a real GPU, Lighthouse measures LCP 0.5 s and TBT 20 ms.
4. Build the active place in the worker, then load the other cards in the background for their stats and previews.

## Security model

- **Static only.** There is no server code and no runtime request to another origin; the CSP's `connect-src`, `img-src`, `font-src` and `worker-src` are `'self'`.
- **Untrusted input is the URL hash and localStorage.** Both pass through `sanitizeState`: version check, 6,000-character cap, at most 24 cards, id patterns per kind, clamped numbers, and text stripped of control and bidi characters. Text is only ever assigned with `textContent`.
- **Data files are trusted but still checked.** Tiles inflate with an output cap and fixed size; place files and the manifest are shape-checked; country ids must be in the manifest before anything is fetched.
- **Build integrity.** Kontur ETags, Natural Earth blob hashes, a SHA-256 for every release verified at deploy, hash-pinned Python requirements, an npm lockfile with install scripts disabled, and Actions pinned to commits with least privilege.

## Testing

- **Unit (Vitest):** codecs, projections, the rasteriser, region building against the fixture's known populations (within 1%), search, the share-link schema (including hostile input), persistence, labels, poster layout, the CSP and lint rules.
- **Pipeline (pytest):** mass conservation, shard routing, antimeridian wrap, ETag verification, row validation, main-landmass framing, border-view diffs, aliases.
- **End-to-end (Playwright, desktop and Pixel 7):** real production builds against the fixture. Every test fails on any console error, CSP violation, page error or dialog.
- **Lighthouse CI:** accessibility, best practices, SEO, FCP, LCP, CLS and script-size budgets. CI has no GPU, so the performance score and TBT are reported but don't fail the build.

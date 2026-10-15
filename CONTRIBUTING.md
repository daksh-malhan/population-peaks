# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set up

You need Node 24 (see `.nvmrc`) and Python 3.12+.

```bash
npm ci
python3 -m venv pipeline/.venv
pipeline/.venv/bin/pip install --require-hashes -r pipeline/requirements.txt -r pipeline/requirements-dev.txt
```

## Get some map data

The full world is built by the **Build data release** workflow. For local work, build a few
countries into `public/data/` (git-ignored), which the dev server serves:

```bash
cd pipeline
.venv/bin/python -m pp_pipeline.build tiles --countries HU,AT,CH --out ../public/data
.venv/bin/python -m pp_pipeline.build fetch-places --src ../work/src --povs ind
.venv/bin/python -m pp_pipeline.build places --src ../work/src --out ../public/data
```

Then run `npm run dev` and open <http://localhost:5173/population-peaks/>.

## Checks

| Command | What it runs |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint (including the no-HTML-strings rules) and TypeScript |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end tests on a production build with the synthetic fixture |
| `npm run test:pipeline` | Pipeline tests (pytest) |
| `npm run fixture` | Regenerates `fixtures/data` (commit the result if the pipeline output changed) |

## Ground rules

- Write the failing test first, then the code.
- Build DOM with `src/ui/dom.ts`; never assemble HTML from strings.
- Keep the site static: no runtime calls to other origins.
- Credit data sources wherever their data appears.

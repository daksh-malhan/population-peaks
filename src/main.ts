import '@fontsource-variable/sora';
import './styles/main.css';
import { DATA_URL } from './config';
import { loadManifest } from './data/manifest';
import { PlaceRepository, resolvePlace } from './data/places';
import { RegionClient } from './region/client';
import { PALETTES } from './render/palettes';
import { regionPeak } from './render/heightfield';
import { MapScene } from './render/scene';

// Temporary renderer harness (replaced by the app shell in the UI task).
async function main() {
  const app = document.getElementById('app')!;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100vw;height:100vh;display:block';
  app.append(canvas);
  const manifest = await loadManifest(DATA_URL);
  const places = new PlaceRepository(DATA_URL, manifest);
  const worker = new Worker(new URL('./worker/region.worker.ts', import.meta.url), { type: 'module' });
  const regions = new RegionClient(worker, DATA_URL, manifest.tileIndex);
  const id = new URLSearchParams(location.search).get('c') ?? 'HU';
  const place = await resolvePlace(places, { kind: 'country', id }, {});
  const grid = await regions.build({ ...place.region, targetCells: 560 });
  const scene = new MapScene(canvas, { palette: PALETTES.ember, heightScale: 1, peak: regionPeak(grid.density, grid.mask) });
  const outline = place.region.shape.kind === 'polygons' ? place.region.shape.polygons : null;
  scene.setRegion(grid, outline, place.region.highlight ?? null);
  new ResizeObserver(() => scene.resize()).observe(canvas);
  Object.assign(window, { __scene: scene, __grid: grid });
}

main().catch((e: unknown) => console.error(e));

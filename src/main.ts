import '@fontsource-variable/sora';
import './styles/main.css';
import { App } from './app/app';
import { chooseInitial } from './app/initial';
import { browserStorage, loadGallery, loadPrefs } from './app/persist';
import { BASE_URL, DATA_URL } from './config';
import { loadManifest, type Manifest } from './data/manifest';
import { posterExporter } from './render/poster';
import { h } from './ui/dom';

function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

function fatal(root: HTMLElement, message: string, extra?: Node | null, retry?: () => void): void {
  root.replaceChildren(
    h(
      'div',
      { class: 'fatal' },
      h('p', { class: 'fatal-brand', text: 'population peaks' }),
      h('h1', { text: message }),
      extra ?? null,
      retry ? h('button', { class: 'btn btn-primary', text: 'Try again', attrs: { type: 'button' }, on: { click: retry } }) : null,
    ),
  );
}

/** Without WebGL, show the country's pre-rendered poster when this is its preview page. */
function previewFor(manifest: Manifest): HTMLElement | null {
  const m = new RegExp(`^${BASE_URL}p/([a-z]{2,3})/?$`).exec(location.pathname);
  const country = manifest.countries.find((c) => c.id === m?.[1]?.toUpperCase());
  if (!country?.preview) return null;
  return h('img', { class: 'fatal-preview', attrs: { src: `${DATA_URL}previews/poster/${country.id}.png`, alt: `Poster of ${country.name}'s population distribution`, width: 540, height: 675 } });
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  root.replaceChildren(h('p', { class: 'boot', text: 'Loading map data…' }));
  let manifest: Manifest;
  try {
    manifest = await loadManifest(DATA_URL);
  } catch (e) {
    console.error(e);
    fatal(root, "Couldn't load map data. Check your connection and try again.", null, () => void boot());
    return;
  }
  if (!supportsWebGL2()) {
    fatal(root, "This browser can't draw 3D maps. Try a recent version of Chrome, Safari, Firefox or Edge.", previewFor(manifest));
    return;
  }
  const storage = browserStorage();
  const initial = chooseInitial({
    hash: location.hash,
    pathname: location.pathname,
    base: BASE_URL,
    saved: loadGallery(storage),
    countries: new Set(manifest.countries.map((c) => c.id)),
  });
  new App(root, manifest, initial, storage, loadPrefs(storage), posterExporter).start();
}

void boot();

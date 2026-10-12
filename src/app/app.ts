import { BASE_URL, DATA_URL, SITE_URL } from '../config';
import type { Manifest } from '../data/manifest';
import { type CityLabel, PlaceRepository, type PlaceRef, type ResolvedPlace, resolvePlace } from '../data/places';
import { loadSearch, type SearchIndex, type SearchItem } from '../data/search';
import type { BBox } from '../geo/geomCodec';
import { makeLaea } from '../geo/laea';
import { RegionClient } from '../region/client';
import type { RegionGrid } from '../region/types';
import { regionPeak } from '../render/heightfield';
import { type LabelCandidate, pickLabels } from '../render/labels';
import { PALETTES, rampColor } from '../render/palettes';
import { MapScene } from '../render/scene';
import { AboutDialog, type BorderChoice } from '../ui/aboutDialog';
import { h } from '../ui/dom';
import { GalleryStrip } from '../ui/galleryStrip';
import { icon } from '../ui/icons';
import { MapLabels } from '../ui/mapLabels';
import { type ExportFormat, PosterPanel } from '../ui/posterPanel';
import { SearchBox } from '../ui/searchBox';
import { drawThumbnail } from '../ui/thumbnail';
import { Toaster } from '../ui/toast';
import { defaultTitle, formatDensity, formatPopulation } from './format';
import { addCard, type GalleryState, moveActive, removeCard, shareUrl, specFromSearch, toShared, updateCard } from './gallery';
import { type Prefs, type StorageLike, saveGallery, savePrefs } from './persist';
import { resolvePov, viewerTimeZone } from './pov';
import { type CardSpec, cleanText, type LabelEdits, type PaletteId, stateFromHash, stateToHash } from './shareState';

export const REPO_URL = 'https://github.com/daksh-malhan/population-peaks';

/** NE point-of-view code → ISO country whose official view it is. */
const POV_COUNTRY: Record<string, string> = {
  ARG: 'AR', BDG: 'BD', BRA: 'BR', CHN: 'CN', DEU: 'DE', EGY: 'EG', ESP: 'ES', FRA: 'FR', GBR: 'GB', GRC: 'GR', IDN: 'ID',
  IND: 'IN', ISR: 'IL', ITA: 'IT', JPN: 'JP', KOR: 'KR', MAR: 'MA', NEP: 'NP', NLD: 'NL', PAK: 'PK', POL: 'PL', PRT: 'PT',
  PSE: 'PS', RUS: 'RU', SAU: 'SA', SWE: 'SE', TUR: 'TR', TWN: 'TW', UKR: 'UA', USA: 'US', VNM: 'VN',
};

interface Runtime {
  key: string;
  status: 'loading' | 'ready' | 'error';
  place?: ResolvedPlace;
  grid?: RegionGrid;
  peak: number;
  cities: CityLabel[];
  thumb?: HTMLCanvasElement;
  promise?: Promise<Runtime>;
}

export interface Exporter {
  canPrint(scene: MapScene): boolean;
  export(format: ExportFormat, ctx: ExportContext): Promise<void>;
}

export interface ExportContext {
  scene: MapScene;
  title: string;
  subtitle: string;
  author: string;
  paletteId: PaletteId;
  labels: LabelCandidate[];
  fileName: string;
}

function refFromSpec(spec: CardSpec): PlaceRef {
  if (spec.k === 'c') return { kind: 'country', id: spec.id };
  if (spec.k === 's') return { kind: 'state', id: spec.id, country: spec.c ?? '' };
  return { kind: 'city', id: spec.id, country: spec.c ?? '' };
}

function hex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

function expand(b: BBox, frac: number): BBox {
  const dx = (b[2] - b[0]) * frac;
  const dy = (b[3] - b[1]) * frac;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}

function slug(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'poster';
}

export class App {
  private state: GalleryState;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly places: PlaceRepository;
  private readonly regions: RegionClient;
  private readonly scene: MapScene;
  private searchIndex: Promise<SearchIndex> | null = null;
  private pov: string | null;
  private dirty = false;
  private showSeq = 0;
  private syncTimer = 0;
  private lastHash = '';
  private activeLabels: LabelCandidate[] = [];
  private activeRuntime: Runtime | null = null;
  private exporting = false;
  private readonly targetCells: number;

  private readonly toaster = new Toaster();
  private readonly search: SearchBox;
  private readonly gallery: GalleryStrip;
  private readonly panel: PosterPanel;
  private readonly labels = new MapLabels();
  private readonly about: AboutDialog;
  private readonly canvas = h('canvas', { class: 'stage-canvas', attrs: { role: 'img', 'aria-label': 'Population map' } });
  private readonly title = h('h1', { class: 'stage-title' });
  private readonly subtitle = h('p', { class: 'stage-subtitle' });
  private readonly status = h('p', { class: 'stage-status', attrs: { role: 'status' } });
  private readonly stats = h('p', { class: 'stage-stats' });
  private readonly tooltip = h('div', { class: 'tooltip', attrs: { 'aria-hidden': 'true' } });

  constructor(
    private readonly root: HTMLElement,
    private readonly manifest: Manifest,
    initial: { state: GalleryState; warnings: string[]; fromLink: boolean },
    private readonly storage: StorageLike | null,
    private prefs: Prefs,
    private readonly exporter: Exporter,
  ) {
    this.state = initial.state;
    this.pov = this.currentPov();
    this.places = new PlaceRepository(DATA_URL, manifest);
    const worker = new Worker(new URL('../worker/region.worker.ts', import.meta.url), { type: 'module' });
    this.regions = new RegionClient(worker, DATA_URL, manifest.tileIndex);
    const coarse = window.matchMedia('(pointer: coarse)').matches || Math.min(window.screen.width, window.screen.height) < 700;
    this.targetCells = coarse ? 380 : 560;

    this.search = new SearchBox({
      getIndex: () => this.getSearch(),
      onPick: (item) => this.addFromSearch(item),
      onError: (msg) => this.toaster.show(msg, 'error'),
    });
    this.gallery = new GalleryStrip({
      onSelect: (i) => this.select(i),
      onRemove: (i) => this.remove(i),
      onAdd: () => this.search.focus(),
    });
    this.panel = new PosterPanel({
      onTitle: (v) => this.editCard({ ti: cleanText(v, 80) }, false),
      onSubtitle: (v) => this.editCard({ st: cleanText(v, 80) }, false),
      onAuthor: (v) => this.commit({ ...this.state, author: cleanText(v, 60) ?? '' }, false),
      onPalette: (id) => this.setPalette(id),
      onHeight: (v, final) => this.setHeight(v, final),
      onScale: (v) => {
        this.commit({ ...this.state, scale: v });
        this.applyPeak();
      },
      onRadius: (km, final) => this.setRadius(km, final),
      onLabelRename: (id, name) => this.editLabels((lb) => {
        const t = cleanText(name, 40);
        const renamed = Object.fromEntries(Object.entries(lb.renamed ?? {}).filter(([k]) => k !== id));
        return { ...lb, renamed: t ? { ...renamed, [id]: t } : renamed };
      }),
      onLabelHide: (id) => this.editLabels((lb) => ({ ...lb, hidden: [...new Set([...(lb.hidden ?? []), id])], added: (lb.added ?? []).filter((x) => x !== id) })),
      onLabelAdd: (id) => this.editLabels((lb) => ({ ...lb, added: [...new Set([...(lb.added ?? []), id])], hidden: (lb.hidden ?? []).filter((x) => x !== id) })),
      onResetView: () => this.scene.resetView(),
      onExport: (format) => void this.exportPoster(format),
    });
    this.about = new AboutDialog(this.borderChoices(), this.prefs.pov, (v) => this.setBorders(v), REPO_URL);

    this.scene = new MapScene(this.canvas, { palette: PALETTES[this.state.palette], heightScale: this.state.height, peak: 1 });
    this.scene.onRender(() => this.placeLabels());
    this.buildLayout();
    this.applyAccent();
    for (const w of initial.warnings) this.toaster.show(w, 'error', 7000);
    this.lastHash = location.hash;
    window.addEventListener('hashchange', () => this.onHashChange());
  }

  start(): void {
    this.renderAll();
    void this.showActive();
    void this.loadOthers();
  }

  // ---- layout -------------------------------------------------------------

  private buildLayout(): void {
    const legend = h(
      'div',
      { class: 'legend' },
      h('span', { class: 'legend-title', text: 'People per km²' }),
      h('span', { class: 'legend-bar', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'legend-scale' }, h('span', { text: 'Low' }), h('span', { text: '5,000+' })),
    );
    const stage = h(
      'section',
      { class: 'stage', attrs: { 'aria-label': 'Map' } },
      h('div', { class: 'stage-head' }, this.title, this.subtitle),
      this.canvas,
      this.labels.el,
      this.status,
      h('div', { class: 'stage-foot' }, legend, this.stats),
      this.tooltip,
    );
    const header = h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'brand', attrs: { href: BASE_URL } }, icon('peaks', 22), h('span', { text: 'population peaks' })),
      this.search.el,
      h('button', { class: 'btn btn-quiet', attrs: { type: 'button' }, on: { click: () => void this.surprise() } }, icon('shuffle', 18), h('span', { text: 'Surprise me' })),
      h(
        'div',
        { class: 'topbar-actions' },
        h('button', { class: 'btn btn-quiet', attrs: { type: 'button' }, on: { click: () => void this.copyLink() } }, icon('link', 18), h('span', { text: 'Copy link' })),
        h('button', { class: 'btn btn-quiet', attrs: { type: 'button' }, on: { click: () => this.about.open() } }, icon('info', 18), h('span', { text: 'About' })),
      ),
    );
    this.root.replaceChildren(
      h('div', { class: 'app' }, header, h('main', { class: 'workspace' }, stage, this.panel.el), this.gallery.el, this.toaster.el),
      this.about.el,
    );
    new ResizeObserver(() => this.scene.resize()).observe(this.canvas);
    this.canvas.addEventListener('pointermove', (e) => this.onHover(e));
    this.canvas.addEventListener('pointerleave', () => this.tooltip.classList.remove('visible'));
  }

  private applyAccent(): void {
    const p = PALETTES[this.state.palette];
    const s = document.documentElement.style;
    s.setProperty('--accent', hex(rampColor(p, 0.55)));
    s.setProperty('--accent-soft', hex(rampColor(p, 0.8)));
    s.setProperty('--accent-deep', hex(rampColor(p, 0.3)));
    s.setProperty('--bg', p.background);
    s.setProperty('--bg-glow', p.backgroundGlow);
  }

  // ---- state --------------------------------------------------------------

  private commit(next: GalleryState, render = true): void {
    this.state = next;
    this.dirty = true;
    if (render) this.renderAll();
    else this.renderStageText();
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => this.sync(), 300);
  }

  private sync(): void {
    const hash = stateToHash(toShared(this.state));
    this.lastHash = hash;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
    if (this.dirty) saveGallery(this.storage, toShared(this.state));
  }

  private onHashChange(): void {
    if (location.hash === this.lastHash) return;
    const decoded = stateFromHash(location.hash);
    if (!decoded) return;
    for (const w of decoded.warnings) this.toaster.show(w, 'error', 7000);
    if (!decoded.state.cards.length) return;
    this.lastHash = location.hash;
    this.state = { ...this.state, cards: decoded.state.cards, active: decoded.state.a ?? 0, palette: decoded.state.pal ?? 'ember', height: decoded.state.h ?? 1, scale: decoded.state.sc ?? 'own', author: decoded.state.au ?? '' };
    this.scene.setSettings({ palette: PALETTES[this.state.palette], heightScale: this.state.height });
    this.applyAccent();
    this.renderAll();
    void this.showActive();
    void this.loadOthers();
  }

  private get activeSpec(): CardSpec | undefined {
    return this.state.cards[this.state.active];
  }

  private runtimeKey(spec: CardSpec): string {
    return [spec.k, spec.c ?? '', spec.id, spec.r ?? '', spec.k === 'c' ? (this.pov ?? '-') : '-'].join(':');
  }

  private currentPov(): string | null {
    return resolvePov(this.prefs.pov, viewerTimeZone(), this.manifest.tzPov, Object.keys(this.manifest.povs));
  }

  // ---- loading places -------------------------------------------------------

  private load(spec: CardSpec): Promise<Runtime> {
    const key = this.runtimeKey(spec);
    const existing = this.runtimes.get(key);
    if (existing?.status === 'ready') return Promise.resolve(existing);
    if (existing?.promise) return existing.promise;
    const rt: Runtime = { key, status: 'loading', peak: 0, cities: [] };
    this.runtimes.set(key, rt);
    rt.promise = (async () => {
      try {
        const place = await resolvePlace(this.places, refFromSpec(spec), { radiusKm: spec.r, pov: this.pov });
        const grid = await this.regions.build({ ...place.region, targetCells: this.targetCells });
        rt.place = place;
        rt.grid = grid;
        rt.peak = regionPeak(grid.density, grid.mask);
        rt.cities = await this.places.citiesIn(expand(place.region.bbox, 0.05)).catch(() => []);
        rt.thumb = h('canvas');
        drawThumbnail(rt.thumb, grid, PALETTES[this.state.palette]);
        rt.status = 'ready';
      } catch (e) {
        console.error(e);
        rt.status = 'error';
      } finally {
        rt.promise = undefined;
        this.renderGallery();
        if (this.state.scale === 'same') this.applyPeak();
      }
      return rt;
    })();
    return rt.promise;
  }

  private async loadOthers(): Promise<void> {
    for (const spec of [...this.state.cards]) {
      if (!this.state.cards.includes(spec)) continue;
      await this.load(spec);
    }
  }

  private async showActive(): Promise<void> {
    const seq = ++this.showSeq;
    const spec = this.activeSpec;
    this.labels.clear();
    this.activeLabels = [];
    if (!spec) {
      this.activeRuntime = null;
      this.status.textContent = 'Search for a country, state or city to start.';
      this.status.hidden = false;
      this.renderAll();
      return;
    }
    const known = this.runtimes.get(this.runtimeKey(spec));
    if (known?.status === 'error') this.runtimes.delete(known.key);
    this.status.textContent = 'Drawing the map…';
    this.status.hidden = false;
    const rt = await this.load(spec);
    if (seq !== this.showSeq) return;
    if (rt.status !== 'ready' || !rt.grid || !rt.place) {
      this.status.textContent = "Couldn't load this place. Check your connection, then select it again to retry.";
      this.activeRuntime = null;
      this.renderAll();
      return;
    }
    this.status.hidden = true;
    this.activeRuntime = rt;
    const shape = rt.place.region.shape;
    this.scene.setRegion(rt.grid, shape.kind === 'polygons' ? shape.polygons : null, rt.place.region.highlight ?? null, {
      palette: PALETTES[this.state.palette],
      heightScale: this.state.height,
      peak: this.effectivePeak(rt),
    });
    this.computeLabels();
    this.renderAll();
  }

  private effectivePeak(rt: Runtime): number {
    if (this.state.scale === 'own') return rt.peak;
    let peak = rt.peak;
    for (const spec of this.state.cards) {
      const other = this.runtimes.get(this.runtimeKey(spec));
      if (other?.status === 'ready') peak = Math.max(peak, other.peak);
    }
    return peak;
  }

  private applyPeak(): void {
    if (this.activeRuntime) this.scene.setSettings({ peak: this.effectivePeak(this.activeRuntime) });
  }

  // ---- labels -------------------------------------------------------------

  private insideActive(): (lng: number, lat: number) => boolean {
    const g = this.activeRuntime?.grid;
    if (!g) return () => false;
    const proj = makeLaea(g.center[0], g.center[1]);
    return (lng, lat) => {
      const [x, y] = proj.forward(lng, lat);
      const c = Math.floor((x - g.originKm[0]) / g.cellKm);
      const r = Math.floor((g.originKm[1] - y) / g.cellKm);
      return c >= 0 && r >= 0 && c < g.width && r < g.height && g.mask[r * g.width + c]! >= 0.5;
    };
  }

  private computeLabels(): void {
    const rt = this.activeRuntime;
    const spec = this.activeSpec;
    if (!rt?.grid || !spec) return;
    const extentKm = Math.max(rt.grid.width, rt.grid.height) * rt.grid.cellKm;
    const lb = spec.lb ?? {};
    this.activeLabels = pickLabels(rt.cities, this.insideActive(), {
      count: 4,
      minSepKm: Math.max(6, extentKm * 0.05),
      hidden: new Set(lb.hidden ?? []),
      added: lb.added ?? [],
      renamed: lb.renamed ?? {},
    });
    this.scene.requestRender();
  }

  private placeLabels(): void {
    const frame = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    this.labels.update(
      this.activeLabels.map((c) => ({ id: c.id, name: c.name, ...this.scene.project(c.lng, c.lat) })),
      frame,
    );
  }

  private editLabels(fn: (lb: LabelEdits) => LabelEdits): void {
    const spec = this.activeSpec;
    if (!spec) return;
    const next = fn(spec.lb ?? {});
    const clean: LabelEdits = {};
    if (next.hidden?.length) clean.hidden = next.hidden.slice(0, 20);
    if (next.added?.length) clean.added = next.added.slice(0, 20);
    if (next.renamed && Object.keys(next.renamed).length) clean.renamed = next.renamed;
    this.commit(updateCard(this.state, this.state.active, { lb: Object.keys(clean).length ? clean : undefined }));
    this.computeLabels();
    this.renderPanel();
  }

  // ---- actions ------------------------------------------------------------

  private getSearch(): Promise<SearchIndex> {
    this.searchIndex ??= loadSearch(DATA_URL).catch((e: unknown) => {
      this.searchIndex = null;
      throw e;
    });
    return this.searchIndex;
  }

  private addFromSearch(item: SearchItem): void {
    const r = addCard(this.state, specFromSearch(item));
    if (r.result === 'full') return this.toaster.show('Your gallery is full (24 places). Remove one to add another.', 'error');
    if (r.result === 'duplicate') this.toaster.show(`${item.name} is already in your gallery.`);
    this.commit(r.state);
    void this.showActive();
  }

  private async surprise(): Promise<void> {
    let index: SearchIndex;
    try {
      index = await this.getSearch();
    } catch {
      return this.toaster.show("Couldn't load the list of places. Check your connection and try again.", 'error');
    }
    const pool = index.items.filter((it) => it.kind !== 2 || it.rank >= 500_000);
    for (let tries = 0; tries < 20; tries++) {
      const item = pool[Math.floor(Math.random() * pool.length)];
      if (item && !this.state.cards.some((c) => c.id === item.id)) return this.addFromSearch(item);
    }
  }

  private select(i: number): void {
    this.commit(moveActive(this.state, i));
    void this.showActive();
  }

  private remove(i: number): void {
    const wasActive = i === this.state.active;
    this.commit(removeCard(this.state, i));
    if (wasActive || this.state.active < 0) void this.showActive();
  }

  private editCard(patch: Partial<CardSpec>, render: boolean): void {
    const spec = this.activeSpec;
    if (!spec) return;
    const merged = Object.fromEntries(Object.entries({ ...spec, ...patch }).filter(([, v]) => v !== undefined)) as unknown as CardSpec;
    this.commit({ ...this.state, cards: this.state.cards.map((c, i) => (i === this.state.active ? merged : c)) }, render);
  }

  private setPalette(id: PaletteId): void {
    this.commit({ ...this.state, palette: id });
    this.scene.setSettings({ palette: PALETTES[id] });
    this.applyAccent();
    for (const rt of this.runtimes.values()) if (rt.grid && rt.thumb) drawThumbnail(rt.thumb, rt.grid, PALETTES[id]);
    this.renderGallery();
  }

  private setHeight(v: number, final: boolean): void {
    const height = Math.round(Math.min(3, Math.max(0.25, v)) * 100) / 100;
    this.scene.setSettings({ heightScale: height });
    if (final) this.commit({ ...this.state, height });
    else this.state = { ...this.state, height };
  }

  private setRadius(km: number, final: boolean): void {
    const spec = this.activeSpec;
    if (spec?.k !== 't') return;
    if (!final) {
      this.subtitle.textContent = this.subtitleFor(spec, km);
      return;
    }
    this.commit(updateCard(this.state, this.state.active, { r: km }));
    void this.showActive();
  }

  private setBorders(value: string): void {
    this.prefs = { pov: value };
    savePrefs(this.storage, this.prefs);
    const next = this.currentPov();
    if (next === this.pov) return;
    this.pov = next;
    void this.showActive();
    void this.loadOthers();
  }

  private async copyLink(): Promise<void> {
    const site = import.meta.env.DEV ? `${location.origin}${BASE_URL}` : SITE_URL;
    const url = shareUrl(this.state, site);
    this.sync();
    try {
      await navigator.clipboard.writeText(url);
      this.toaster.show('Link copied');
    } catch {
      this.toaster.show("Couldn't copy the link. Copy it from the address bar instead.", 'error');
    }
  }

  private async exportPoster(format: ExportFormat): Promise<void> {
    const rt = this.activeRuntime;
    const spec = this.activeSpec;
    if (!rt?.place || !spec || this.exporting) return;
    this.exporting = true;
    this.renderPanel();
    try {
      await this.exporter.export(format, {
        scene: this.scene,
        title: spec.ti ?? defaultTitle(rt.place.name),
        subtitle: spec.st ?? this.subtitleFor(spec),
        author: this.state.author,
        paletteId: this.state.palette,
        labels: this.activeLabels,
        fileName: `${slug(rt.place.name)}-population-${format}.png`,
      });
    } catch (e) {
      console.error(e);
      this.toaster.show("Couldn't export the poster. Try a smaller size or another browser.", 'error');
    } finally {
      this.exporting = false;
      this.renderPanel();
    }
  }

  // ---- rendering ----------------------------------------------------------

  private subtitleFor(spec: CardSpec, radiusKm = spec.r): string {
    const rt = this.runtimes.get(this.runtimeKey(spec));
    if (spec.k === 't') return `Within ${radiusKm ?? 40} km of the centre`;
    if (rt?.place?.tiny) return 'Shown with 10 km of its surroundings';
    return '';
  }

  private renderStageText(): void {
    const spec = this.activeSpec;
    const rt = this.activeRuntime;
    const name = rt?.place?.name ?? '';
    this.title.textContent = spec && name ? (spec.ti ?? defaultTitle(name)) : '';
    this.subtitle.textContent = spec ? (spec.st ?? this.subtitleFor(spec)) : '';
    if (rt?.grid && rt.place) {
      const { population, peakDensity, peak } = rt.grid.stats;
      const near = this.nearestCity(peak[0], peak[1]);
      this.stats.replaceChildren(
        h('span', { text: `${formatPopulation(population)} people` }),
        h('span', { class: 'muted', text: `Peak ${formatDensity(peakDensity)}${near ? ` near ${near}` : ''}` }),
      );
      this.canvas.setAttribute(
        'aria-label',
        `3D population map of ${name}. About ${formatPopulation(population).replace('≈ ', '')} people; the densest area${near ? `, near ${near},` : ''} has about ${formatDensity(peakDensity).replace(' /km²', '')} people per square kilometre.`,
      );
    } else {
      this.stats.replaceChildren();
      this.canvas.setAttribute('aria-label', 'Population map');
    }
  }

  private nearestCity(lng: number, lat: number, rt = this.activeRuntime): string | undefined {
    let best: CityLabel | undefined;
    let bestD = Infinity;
    for (const c of rt?.cities ?? []) {
      const d = (c.lng - lng) ** 2 * Math.cos((lat * Math.PI) / 180) ** 2 + (c.lat - lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best && bestD < 0.15 ** 2 ? best.name : undefined;
  }

  private renderGallery(): void {
    this.gallery.render(
      this.state.cards.map((spec) => {
        const rt = this.runtimes.get(this.runtimeKey(spec));
        return {
          key: this.runtimeKey(spec),
          name: rt?.place?.name ?? (spec.k === 'c' ? (this.manifest.countries.find((c) => c.id === spec.id)?.name ?? spec.id) : '…'),
          status: rt?.status ?? 'loading',
          population: rt?.grid?.stats.population,
          peakDensity: rt?.grid?.stats.peakDensity,
          peakNear: rt?.grid ? this.nearestCity(rt.grid.stats.peak[0], rt.grid.stats.peak[1], rt) : undefined,
          thumb: rt?.thumb,
        };
      }),
      this.state.active,
    );
  }

  private renderPanel(): void {
    const spec = this.activeSpec;
    const rt = this.activeRuntime;
    const inside = this.insideActive();
    const shown = new Set(this.activeLabels.map((l) => l.id));
    const original = new Map((rt?.cities ?? []).map((c) => [c.id, c.name]));
    this.panel.update({
      title: spec?.ti ?? '',
      titlePlaceholder: rt?.place ? defaultTitle(rt.place.name) : 'Title',
      subtitle: spec?.st ?? '',
      subtitlePlaceholder: spec ? this.subtitleFor(spec) : '',
      author: this.state.author,
      palette: this.state.palette,
      height: this.state.height,
      scale: this.state.scale,
      radiusKm: spec?.k === 't' ? (spec.r ?? 40) : null,
      labels: this.activeLabels.map((l) => ({ id: l.id, name: l.name, original: original.get(l.id) ?? l.name })),
      labelChoices: (rt?.cities ?? []).filter((c) => !shown.has(c.id) && inside(c.lng, c.lat)).slice(0, 30).map((c) => ({ id: c.id, name: c.name })),
      canPrint: this.exporter.canPrint(this.scene),
      busy: this.exporting,
    });
  }

  private renderAll(): void {
    this.renderStageText();
    this.renderGallery();
    this.renderPanel();
  }

  private onHover(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    const d = this.scene.densityAt(e.clientX, e.clientY);
    if (d === null) {
      this.tooltip.classList.remove('visible');
      return;
    }
    this.tooltip.textContent = formatDensity(d);
    const rect = this.canvas.getBoundingClientRect();
    this.tooltip.style.transform = `translate(${e.clientX - rect.left + 14}px, ${e.clientY - rect.top - 28}px)`;
    this.tooltip.classList.add('visible');
  }

  private borderChoices(): BorderChoice[] {
    const names = new Map(this.manifest.countries.map((c) => [c.id, c.name]));
    const views = Object.keys(this.manifest.povs)
      .map((code) => ({ value: code, label: `${names.get(POV_COUNTRY[code] ?? '') ?? code}’s official view` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: 'auto', label: 'Automatic, from your time zone' }, { value: 'none', label: 'De facto: who controls each area' }, ...views];
  }
}

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  HalfFloatType,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { MultiPolygon } from '../geo/geomCodec';
import { timed } from '../perf';
import { type Laea, makeLaea } from '../geo/laea';
import type { RegionGrid } from '../region/types';
import { buildHeights, colorT, glowFor } from './heightfield';
import { type Palette, rampColor } from './palettes';

/** World units across the longer side of the map. */
const WORLD = 100;
/** Height of the tallest spike at height multiplier 1. */
const BASE_HEIGHT = 30;
/** The reference poster's oblique view: ~42° from vertical, looking north. */
export const POST_POLAR = 0.74;

export interface SceneSettings {
  palette: Palette;
  /** User multiplier, 0.25..3 */
  heightScale: number;
  /** Density that reaches full height: the place's own peak, or the gallery's on a shared scale. */
  peak: number;
}

export interface CameraState {
  polar: number;
  azimuth: number;
  /** Camera distance relative to the distance that fits the map. */
  zoom: number;
  /** Orbit target relative to the map centre, in world units. */
  target: [number, number, number];
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** In front of the camera and inside the frame. */
  visible: boolean;
}

const VERT = /* glsl */ `
attribute vec3 color;
attribute float mask;
uniform float uMaxHeight;
varying vec3 vColor;
varying float vMask;
varying vec3 vNormal;
varying float vHeight;
void main() {
  vColor = color;
  vMask = mask;
  vNormal = normal;
  vHeight = position.y / max(uMaxHeight, 0.001);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uLightDir;
uniform float uGlow;
varying vec3 vColor;
varying float vMask;
varying vec3 vNormal;
varying float vHeight;
void main() {
  float a = smoothstep(0.35, 0.65, vMask);
  if (a < 0.01) discard;
  vec3 n = normalize(vNormal);
  float diffuse = max(dot(n, uLightDir), 0.0);
  vec3 base = vColor * (0.74 + 0.38 * diffuse);
  vec3 glow = vColor * uGlow * pow(clamp(vHeight, 0.0, 1.0), 1.4);
  gl_FragColor = vec4(base + glow, a);
}`;

function linearLut(p: Palette): Float32Array {
  const lut = new Float32Array(256 * 3);
  const c = new Color();
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = rampColor(p, i / 255);
    c.setRGB(r, g, b, SRGBColorSpace);
    lut[i * 3] = c.r;
    lut[i * 3 + 1] = c.g;
    lut[i * 3 + 2] = c.b;
  }
  return lut;
}

function backgroundTexture(p: Palette): CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size * 0.46, 0, size / 2, size * 0.46, size * 0.62);
    g.addColorStop(0, p.backgroundGlow);
    g.addColorStop(1, p.background);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class MapScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 4000);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly material: ShaderMaterial;
  private mesh: Mesh | null = null;
  private lines: LineSegments[] = [];
  private grid: RegionGrid | null = null;
  private proj: Laea | null = null;
  private heights: Float32Array | null = null;
  private outlines: { region: MultiPolygon | null; highlight: MultiPolygon | null } = { region: null, highlight: null };
  private settings: SceneSettings;
  private cellWorld = 1;
  /** Points that must stay in frame: the region's footprint and the tallest spike's tip. */
  private fitPoints: Vector3[] = [];
  private maxHeight = BASE_HEIGHT;
  private frame = 0;
  private lost = false;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly canvas: HTMLCanvasElement,
    settings: SceneSettings,
  ) {
    this.settings = settings;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.5, 0.42, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uLightDir: { value: new Vector3(-0.45, 0.8, 0.4).normalize() },
        uGlow: { value: 0.45 },
        uMaxHeight: { value: BASE_HEIGHT },
      },
      alphaToCoverage: true,
    });

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = 1.42;
    this.controls.addEventListener('change', () => this.requestRender());

    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.applyPalette();
    this.resize();
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  };

  private readonly onRestored = (): void => {
    this.lost = false;
    // three re-uploads geometry and textures on the next render; rebuild what we own.
    this.applyPalette();
    if (this.grid) this.rebuildMesh();
    this.requestRender();
  };

  /** Called after every rendered frame (camera moves, data changes) so overlays can follow. */
  onRender(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get isContextLost(): boolean {
    return this.lost;
  }

  get maxTextureSize(): number {
    const gl = this.renderer.getContext();
    return Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
  }

  setRegion(grid: RegionGrid, region: MultiPolygon | null, highlight: MultiPolygon | null, settings?: Partial<SceneSettings>): void {
    this.grid = grid;
    this.proj = makeLaea(grid.center[0], grid.center[1]);
    this.outlines = { region, highlight };
    if (settings) this.settings = { ...this.settings, ...settings };
    this.cellWorld = WORLD / Math.max(grid.width, grid.height);
    timed('mesh', () => this.rebuildMesh());
    timed('fit', () => this.resetView());
  }

  setSettings(partial: Partial<SceneSettings>): void {
    const paletteChanged = partial.palette && partial.palette !== this.settings.palette;
    this.settings = { ...this.settings, ...partial };
    if (paletteChanged) this.applyPalette();
    if (this.grid) this.rebuildMesh();
    this.requestRender();
  }

  private applyPalette(): void {
    const old = this.scene.background;
    if (old instanceof CanvasTexture) old.dispose();
    this.scene.background = backgroundTexture(this.settings.palette);
  }

  private rebuildMesh(): void {
    const grid = this.grid;
    if (!grid) return;
    const { width: W, height: H, density, mask } = grid;
    const s = this.cellWorld;
    this.maxHeight = BASE_HEIGHT * this.settings.heightScale;
    this.heights = buildHeights(density, mask, this.settings.peak, this.maxHeight, this.heights?.length === density.length ? this.heights : undefined);
    const lut = linearLut(this.settings.palette);

    const pos = new Float32Array(W * H * 3);
    const col = new Float32Array(W * H * 3);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = r * W + c;
        pos[i * 3] = (c + 0.5 - W / 2) * s;
        pos[i * 3 + 1] = this.heights[i]!;
        pos[i * 3 + 2] = (r + 0.5 - H / 2) * s;
        const k = Math.round(colorT(density[i]!) * 255) * 3;
        col[i * 3] = lut[k]!;
        col[i * 3 + 1] = lut[k + 1]!;
        col[i * 3 + 2] = lut[k + 2]!;
      }
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let n = 0;
    for (let r = 0; r < H - 1; r++) {
      for (let c = 0; c < W - 1; c++) {
        const a = r * W + c;
        const b = a + 1;
        const d = a + W;
        const e = d + 1;
        if (mask[a]! < 0.02 && mask[b]! < 0.02 && mask[d]! < 0.02 && mask[e]! < 0.02) continue;
        idx[n++] = a;
        idx[n++] = d;
        idx[n++] = b;
        idx[n++] = b;
        idx[n++] = d;
        idx[n++] = e;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setAttribute('mask', new BufferAttribute(mask.slice(), 1));
    geo.setIndex(new BufferAttribute(idx.subarray(0, n), 1));
    geo.computeVertexNormals();

    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
    } else {
      this.mesh = new Mesh(geo, this.material);
      this.scene.add(this.mesh);
    }
    this.material.uniforms.uMaxHeight!.value = this.maxHeight;
    const glow = glowFor(density, mask);
    this.bloom.strength = glow;
    this.material.uniforms.uGlow!.value = 0.9 * glow;

    for (const l of this.lines) {
      this.scene.remove(l);
      l.geometry.dispose();
      (l.material as LineBasicMaterial).dispose();
    }
    this.lines = [];
    if (this.outlines.region && !this.outlines.highlight) this.lines.push(this.outlineMesh(this.outlines.region, this.settings.palette.edge, 0.9));
    if (this.outlines.highlight) this.lines.push(this.outlineMesh(this.outlines.highlight, this.settings.palette.highlight, 1));
    for (const l of this.lines) this.scene.add(l);
    this.fitPoints = this.computeFitPoints();
  }

  private computeFitPoints(): Vector3[] {
    const g = this.grid;
    const h = this.heights;
    if (!g || !h) return [];
    const pts: Vector3[] = [];
    let top = 0;
    let topIdx = 0;
    let minR = g.height;
    let maxR = 0;
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        const i = r * g.width + c;
        if (g.mask[i]! < 0.5) continue;
        if (h[i]! > top) {
          top = h[i]!;
          topIdx = i;
        }
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
    }
    const toWorld = (c: number, r: number, y: number) => new Vector3((c + 0.5 - g.width / 2) * this.cellWorld, y, (r + 0.5 - g.height / 2) * this.cellWorld);
    // Footprint: the outermost masked cell in each row (the silhouette), decimated.
    const step = Math.max(1, Math.floor(g.height / 120));
    for (let r = minR; r <= maxR; r += step) {
      let first = -1;
      let last = -1;
      for (let c = 0; c < g.width; c++) {
        if (g.mask[r * g.width + c]! >= 0.5) {
          if (first < 0) first = c;
          last = c;
        }
      }
      if (first >= 0) pts.push(toWorld(first, r, 0), toWorld(last, r, 0));
    }
    if (pts.length === 0) pts.push(toWorld(0, 0, 0), toWorld(g.width - 1, g.height - 1, 0));
    pts.push(toWorld(topIdx % g.width, Math.floor(topIdx / g.width), top));
    return pts;
  }

  private outlineMesh(polys: MultiPolygon, color: string, opacity: number): LineSegments {
    const pts: number[] = [];
    for (const poly of polys) {
      for (const ring of poly) {
        const n = ring.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const [x1, z1] = this.lngLatToWorld(ring[2 * i]!, ring[2 * i + 1]!);
          const [x2, z2] = this.lngLatToWorld(ring[2 * j]!, ring[2 * j + 1]!);
          pts.push(x1, 0.04, z1, x2, 0.04, z2);
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(Float32Array.from(pts), 3));
    return new LineSegments(geo, new LineBasicMaterial({ color: new Color(color), transparent: opacity < 1, opacity }));
  }

  lngLatToWorld(lng: number, lat: number): [number, number] {
    const g = this.grid;
    if (!g || !this.proj) return [0, 0];
    const [xk, yk] = this.proj.forward(lng, lat);
    return [((xk - g.originKm[0]) / g.cellKm - g.width / 2) * this.cellWorld, ((g.originKm[1] - yk) / g.cellKm - g.height / 2) * this.cellWorld];
  }

  /** Height at a world position: the highest vertex nearby, so a label dot sits on its spike. */
  private surfaceHeight(x: number, z: number, radius = 1): number {
    const g = this.grid;
    const h = this.heights;
    if (!g || !h) return 0;
    const c0 = Math.round(x / this.cellWorld + g.width / 2 - 0.5);
    const r0 = Math.round(z / this.cellWorld + g.height / 2 - 0.5);
    let best = 0;
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (r < 0 || c < 0 || r >= g.height || c >= g.width) continue;
        best = Math.max(best, h[r * g.width + c]!);
      }
    }
    return best;
  }

  private bounds(): { min: Vector3; max: Vector3 } {
    const g = this.grid;
    const w = g ? (g.width * this.cellWorld) / 2 : WORLD / 2;
    const d = g ? (g.height * this.cellWorld) / 2 : WORLD / 2;
    let top = 0;
    if (this.heights) for (const v of this.heights) if (v > top) top = v;
    return { min: new Vector3(-w, 0, -d), max: new Vector3(w, Math.max(top, 1), d) };
  }

  /** Distance at which the whole map fits the given frame (NDC half-extents) for a view direction. */
  private fitDistance(aspect: number, polar: number, azimuth: number, ndcX = 0.9, ndcY = 0.86): number {
    const { min, max } = this.bounds();
    // Huge far plane: the search below must only ever be limited by the frame, not by clipping.
    const cam = new PerspectiveCamera(this.camera.fov, aspect, 0.01, 1e7);
    const corners: Vector3[] = this.fitPoints.length
      ? this.fitPoints
      : [min, max, new Vector3(min.x, 0, max.z), new Vector3(max.x, 0, min.z)];
    const target = new Vector3(0, max.y * 0.18, 0);
    const dir = new Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
    const fits = (d: number) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      return corners.every((p) => {
        const v = p.clone().project(cam);
        return Math.abs(v.x) <= ndcX && Math.abs(v.y) <= ndcY && v.z < 1;
      });
    };
    let lo = 1;
    let hi = 20_000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  resetView(): void {
    this.applyCameraState({ polar: POST_POLAR, azimuth: 0, zoom: 1, target: [0, 0, 0] });
  }

  getCameraState(): CameraState {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = offset.length();
    const polar = Math.acos(Math.min(1, Math.max(-1, offset.y / dist)));
    const azimuth = Math.atan2(offset.x, offset.z);
    const base = this.bounds().max.y * 0.18;
    return {
      polar,
      azimuth,
      zoom: dist / this.fitDistance(this.camera.aspect, polar, azimuth),
      target: [this.controls.target.x, this.controls.target.y - base, this.controls.target.z],
    };
  }

  private placeCamera(cam: PerspectiveCamera, state: CameraState, aspect: number, ndcX?: number, ndcY?: number): Vector3 {
    const d = this.fitDistance(aspect, state.polar, state.azimuth, ndcX, ndcY) * state.zoom;
    const base = this.bounds().max.y * 0.18;
    const target = new Vector3(state.target[0], state.target[1] + base, state.target[2]);
    const dir = new Vector3(Math.sin(state.polar) * Math.sin(state.azimuth), Math.cos(state.polar), Math.sin(state.polar) * Math.cos(state.azimuth));
    cam.position.copy(target).addScaledVector(dir, d);
    cam.lookAt(target);
    cam.near = Math.max(0.1, d / 200);
    cam.far = d * 6 + 2000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return target;
  }

  applyCameraState(state: CameraState): void {
    const target = this.placeCamera(this.camera, state, this.camera.aspect);
    this.controls.target.copy(target);
    const fit = this.fitDistance(this.camera.aspect, POST_POLAR, 0);
    this.controls.minDistance = fit * 0.08;
    this.controls.maxDistance = fit * 4;
    this.controls.update();
    this.requestRender();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const state = this.grid ? this.getCameraState() : null;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (state) this.applyCameraState(state);
    this.requestRender();
  }

  requestRender(): void {
    // Nothing to draw until a region arrives; an empty first frame would still compile every
    // shader and block the paint of the page's title.
    if (this.frame || this.lost || this.disposed || !this.grid) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const moving = this.controls.update();
      timed('frame', () => this.composer.render());
      for (const fn of this.listeners) fn();
      if (moving) this.requestRender();
    });
  }

  /** Screen position (CSS px within the canvas) of a place on the map surface. */
  project(lng: number, lat: number, cam: PerspectiveCamera = this.camera, width = this.canvas.clientWidth, height = this.canvas.clientHeight): ScreenPoint {
    const [x, z] = this.lngLatToWorld(lng, lat);
    const v = new Vector3(x, this.surfaceHeight(x, z), z).project(cam);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  /** Density under a pointer, found by marching the view ray through the height field. */
  densityAt(clientX: number, clientY: number): number | null {
    const g = this.grid;
    if (!g || !this.heights) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0.5);
    const origin = this.camera.position.clone();
    const dir = ndc.unproject(this.camera).sub(origin).normalize();
    const { max } = this.bounds();
    if (dir.y >= 0 && origin.y > max.y) return null;
    const tTop = origin.y > max.y ? (origin.y - max.y) / -dir.y : 0;
    const tGround = origin.y / -dir.y;
    const steps = 400;
    for (let i = 0; i <= steps; i++) {
      const t = tTop + ((tGround - tTop) * i) / steps;
      const p = origin.clone().addScaledVector(dir, t);
      const c = Math.round(p.x / this.cellWorld + g.width / 2 - 0.5);
      const r = Math.round(p.z / this.cellWorld + g.height / 2 - 0.5);
      if (c < 0 || r < 0 || c >= g.width || r >= g.height) continue;
      const k = r * g.width + c;
      if (p.y <= this.heights[k]! + 0.05) return g.mask[k]! >= 0.5 ? g.density[k]! : null;
    }
    return null;
  }

  /**
   * Render the current view (same angle and zoom relative to the fitted map) at a given size
   * into a new canvas. ndcX/ndcY set how much of the frame the map may fill.
   */
  renderImage(width: number, height: number, ndcX: number, ndcY: number): { image: HTMLCanvasElement; project: (lng: number, lat: number) => ScreenPoint } {
    const state = this.getCameraState();
    const cam = new PerspectiveCamera(this.camera.fov, width / height, 0.1, 10000);
    this.placeCamera(cam, state, width / height, ndcX, ndcY);
    const prevRatio = this.renderer.getPixelRatio();
    const prevW = this.canvas.clientWidth;
    const prevH = this.canvas.clientHeight;

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(1);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
    const pass = this.composer.passes[0] as RenderPass;
    pass.camera = cam;
    this.composer.render();
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    image.getContext('2d')?.drawImage(this.canvas, 0, 0, width, height);

    pass.camera = this.camera;
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevW, prevH, false);
    this.composer.setPixelRatio(prevRatio);
    this.composer.setSize(prevW, prevH);
    this.bloom.resolution.set(prevW, prevH);
    this.composer.render();
    return { image, project: (lng, lat) => this.project(lng, lat, cam, width, height) };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.controls.dispose();
    this.mesh?.geometry.dispose();
    this.material.dispose();
    for (const l of this.lines) {
      l.geometry.dispose();
      (l.material as LineBasicMaterial).dispose();
    }
    (this.scene.background as CanvasTexture | null)?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

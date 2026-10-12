import { colorT } from '../render/heightfield';
import { type Palette, hexToRgb, rampColor } from '../render/palettes';
import type { RegionGrid } from '../region/types';

/**
 * A top-down "plan view" of a region for gallery cards, drawn with putImageData
 * (written, never read back, so anti-fingerprinting noise can't touch it).
 */
export function drawThumbnail(canvas: HTMLCanvasElement, grid: RegionGrid, palette: Palette, width = 160, height = 200): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(width, height);
  const bg = hexToRgb(palette.background).map((v) => Math.round(v * 255));
  const pad = 0.1;
  const scale = Math.min((width * (1 - 2 * pad)) / grid.width, (height * (1 - 2 * pad)) / grid.height);
  const ox = (width - grid.width * scale) / 2;
  const oy = (height - grid.height * scale) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const gx = Math.floor((x - ox) / scale);
      const gy = Math.floor((y - oy) / scale);
      let rgb = bg;
      if (gx >= 0 && gy >= 0 && gx < grid.width && gy < grid.height) {
        const i = gy * grid.width + gx;
        if (grid.mask[i]! >= 0.5) rgb = rampColor(palette, colorT(grid.density[i]!)).map((v) => Math.round(v * 255));
      }
      img.data[o] = rgb[0]!;
      img.data[o + 1] = rgb[1]!;
      img.data[o + 2] = rgb[2]!;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Separable, normalised Gaussian blur (mass-preserving away from the grid edges). */
export function gaussianBlur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma < 0.05) return src.slice();
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum;

  const tmp = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const v = src[row + x]!;
      if (v === 0) continue;
      const lo = Math.max(0, x - radius);
      const hi = Math.min(width - 1, x + radius);
      for (let k = lo; k <= hi; k++) tmp[row + k]! += v * kernel[k - x + radius]!;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const lo = Math.max(0, y - radius);
    const hi = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const v = tmp[y * width + x]!;
      if (v === 0) continue;
      for (let k = lo; k <= hi; k++) out[k * width + x]! += v * kernel[k - y + radius]!;
    }
  }
  return out;
}

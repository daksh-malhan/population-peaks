/** Wrap a step in a User Timing measure (visible in DevTools and Lighthouse traces). */
export function timed<T>(name: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    performance.measure(`pp:${name}`, { start, end: performance.now() });
  }
}

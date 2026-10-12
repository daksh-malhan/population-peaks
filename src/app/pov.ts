/**
 * Which official border view to draw. 'auto' follows the viewer's device time zone
 * (Google Maps similarly adapts borders per country); 'none' is de facto borders.
 * Returns a Natural Earth view code, or null for de facto.
 */
export function resolvePov(setting: string, timeZone: string | undefined, tzPov: Record<string, string>, available: readonly string[]): string | null {
  if (setting === 'none') return null;
  if (setting !== 'auto' && available.includes(setting)) return setting;
  const fromZone = timeZone ? tzPov[timeZone] : undefined;
  return fromZone && available.includes(fromZone) ? fromZone : null;
}

export function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

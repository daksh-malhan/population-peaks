const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function sig3(n: number): number {
  if (n === 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(Math.abs(n))) - 2);
  return Math.round(n / p) * p;
}

export function formatPopulation(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '≈ 0';
  if (n >= 1e9) return `≈ ${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `≈ ${(n / 1e6).toFixed(1)}M`;
  return `≈ ${int.format(sig3(n))}`;
}

export function formatDensity(d: number): string {
  const v = d >= 1000 ? sig3(d) : Math.round(d);
  return `${int.format(v)} /km²`;
}

export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export function defaultTitle(name: string): string {
  return `${possessive(name)} population distribution`;
}

import { describe, expect, it } from 'vitest';
import { defaultTitle, formatDensity, formatPopulation, possessive } from './format';

describe('formatting', () => {
  it('formats populations for cards', () => {
    expect(formatPopulation(9_631_859)).toBe('≈ 9.6M');
    expect(formatPopulation(1_412_000_000)).toBe('≈ 1.41B');
    expect(formatPopulation(41_312)).toBe('≈ 41,300');
    expect(formatPopulation(812)).toBe('≈ 812');
    expect(formatPopulation(4_567)).toBe('≈ 4,570');
    expect(formatPopulation(0)).toBe('≈ 0');
  });

  it('formats densities', () => {
    expect(formatDensity(18_745.4)).toBe('18,700 /km²');
    expect(formatDensity(3.2)).toBe('3 /km²');
  });

  it('builds possessive titles', () => {
    expect(possessive('Hungary')).toBe("Hungary's");
    expect(possessive('United States')).toBe("United States'");
    expect(defaultTitle('Hungary')).toBe("Hungary's population distribution");
  });
});

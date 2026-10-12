import { describe, expect, it } from 'vitest';
import { resolvePov } from './pov';

const tz = { 'Asia/Kolkata': 'IND', 'Asia/Calcutta': 'IND', 'America/New_York': 'USA' };
const available = ['IND', 'USA', 'CHN'];

describe('border view selection', () => {
  it('uses the viewer time zone on auto', () => {
    expect(resolvePov('auto', 'Asia/Calcutta', tz, available)).toBe('IND');
  });

  it('falls back to de facto borders for zones without an official view', () => {
    expect(resolvePov('auto', 'Europe/Copenhagen', tz, available)).toBeNull();
    expect(resolvePov('auto', undefined, tz, available)).toBeNull();
  });

  it('lets an explicit choice win over the time zone', () => {
    expect(resolvePov('CHN', 'Asia/Kolkata', tz, available)).toBe('CHN');
    expect(resolvePov('none', 'Asia/Kolkata', tz, available)).toBeNull();
  });

  it('ignores choices the data does not offer', () => {
    expect(resolvePov('XYZ', 'Asia/Kolkata', tz, available)).toBe('IND');
  });
});

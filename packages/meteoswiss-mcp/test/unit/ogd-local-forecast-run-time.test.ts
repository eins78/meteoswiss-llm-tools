import { describe, expect, it } from 'vitest';
import { forecastRunTime } from '../../src/data/ogd-local-forecast.js';
import type { StacItem } from '../../src/schemas/ogd-shared.js';

const item = (keys: string[]): StacItem => ({
  id: '20261115-ch',
  properties: { datetime: '2026-11-15T04:00:29Z' },
  assets: Object.fromEntries(keys.map((k) => [k, { href: 'https://example.invalid/x.csv' }])),
});
const file = (run: string, param: string): string => `vnut12.lssw.${run}.${param}.csv`;

describe('forecastRunTime', () => {
  it('is the newest run among the parameters read, not the item datetime', () => {
    const stac = item([
      file('202611150400', 'tre200h0'),
      file('202611151100', 'tre200h0'),
      file('202611151100', 'jww003i0'),
    ]);
    expect(forecastRunTime(stac, ['tre200h0', 'jww003i0'])).toBe('2026-11-15T11:00:00Z');
  });

  it('is null when no asset carries a run stamp', () => {
    expect(forecastRunTime(item(['tre200h0.csv']), ['tre200h0'])).toBeNull();
    expect(forecastRunTime(item([]), ['tre200h0'])).toBeNull();
  });
});

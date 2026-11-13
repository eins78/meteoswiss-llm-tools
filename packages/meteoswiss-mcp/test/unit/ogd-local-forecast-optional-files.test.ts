import { describe, expect, it, vi } from 'vitest';

/**
 * Unit, in-process: getLocalForecast is imported and called DIRECTLY here (no MCP client,
 * no child process), so vi.mock CAN reach getIndexedCsvData. USE_TEST_FIXTURES=true comes
 * from test/setup.ts — every request resolves to fixture files, no network.
 */

// Toggleable simulated download failure: getIndexedCsvData rejects whenever the requested
// cache key belongs to the param named here. `vi.hoisted` so the mock factory (which runs
// during the hoisted import of the data layer) can safely read it.
const failState = vi.hoisted(() => ({ param: '' as string }));

vi.mock('../../src/data/ogd-data-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data/ogd-data-store.js')>();
  return {
    ...actual,
    getIndexedCsvData: async (
      url: string,
      cacheKey: string,
      kind: 'forecast',
      build: (data: string, reload: () => Promise<string>) => Promise<unknown>
    ) => {
      if (failState.param && cacheKey.includes(`.${failState.param}.csv`)) {
        throw new Error(`simulated download failure for ${failState.param}`);
      }
      return actual.getIndexedCsvData(url, cacheKey, kind, build);
    },
  };
});

import { getLocalForecast } from '../../src/data/ogd-local-forecast.js';

type Hourly = {
  time: string;
  temperature_c: number | null;
  cloud_low_pct?: number | null;
  cloud_mid_pct?: number | null;
  cloud_high_pct?: number | null;
  weather_code?: number | null;
  weather?: string | null;
};

describe('getLocalForecast with a failed optional "sky" file', () => {
  it('succeeds with null cloud_low_pct and a warning when nprolohs fails (postal code)', async () => {
    failState.param = 'nprolohs';
    try {
      const result = await getLocalForecast({ location: '8001', days: 2, detail: 'sky' });

      const day1 = result.forecast.find((d) => d.date === '2026-03-28');
      expect(day1).toBeDefined();
      const hourly = day1!.hourly ?? [];
      expect(hourly.length).toBeGreaterThan(0);
      // The failed file's field is null on EVERY hour of every day…
      for (const day of result.forecast) {
        for (const h of (day.hourly ?? []) as Hourly[]) {
          expect(h.cloud_low_pct).toBeNull();
        }
      }
      // …while the other sky files still deliver (fixture: 09 UTC → mid 0.20, high 0.50)
      // and the measured series are untouched (fixture: tre200h0 09 UTC → 3.2).
      const ten = hourly.find((h) => h.time === '2026-03-28T10:00:00+01:00') as Hourly;
      expect(ten).toBeDefined();
      expect(ten.cloud_mid_pct).toBe(20);
      expect(ten.cloud_high_pct).toBe(50);
      expect(ten.temperature_c).toBe(3.2);
      // One warning, in the brief's wording — no error message, no URL, no path.
      expect(result.warnings).toEqual(['nprolohs (low cloud cover): download failed']);
    } finally {
      failState.param = '';
    }
  });

  it('succeeds with null hourly symbol and a warning when jww003i0 fails (station)', async () => {
    failState.param = 'jww003i0';
    try {
      const result = await getLocalForecast({ location: 'Napf', days: 1, detail: 'sky' });

      const day = result.forecast[0];
      expect(day).toBeDefined();
      const hourly = (day.hourly ?? []) as Hourly[];
      expect(hourly.length).toBeGreaterThan(0);
      for (const h of hourly) {
        expect(h.weather_code).toBeNull();
        expect(h.weather).toBeNull();
      }
      // The station's daily weather still comes from the official jp2000d0 aggregate.
      expect(day.weather).toBe('very cloudy, intermittent snow');
      expect(result.warnings).toEqual(['jww003i0 (hourly weather symbol): download failed']);
    } finally {
      failState.param = '';
    }
  });

  it('fails the call when a REQUIRED file fails (tre200h0)', async () => {
    failState.param = 'tre200h0';
    try {
      await expect(
        getLocalForecast({ location: '8001', days: 2, detail: 'sky' })
      ).rejects.toThrow();
    } finally {
      failState.param = '';
    }
  });

  it('has no warnings key for a plain "basic" call', async () => {
    const result = await getLocalForecast({ location: '8001', days: 2 });
    expect('warnings' in result).toBe(false);
    expect(result.warnings).toBeUndefined();
  });
});

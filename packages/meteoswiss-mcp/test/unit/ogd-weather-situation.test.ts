import { describe, expect, it, vi } from 'vitest';
import type { StacItem } from '../../src/schemas/ogd-shared.js';

/**
 * getWeatherSituation over the fixtures (USE_TEST_FIXTURES from test/setup.ts): the
 * synthetic situation rows of test/__fixtures__/ogd/forecasts/README.md, 28.03.2026
 * 07-11 UTC, with the synthetic regions of test/__fixtures__/forecast-regions/.
 * In-process, so vi.mock reaches getIndexedCsvData to simulate a failed cloud file.
 */

const failState = vi.hoisted(() => ({ param: '' as string }));

vi.mock('../../src/data/ogd-data-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data/ogd-data-store.js')>();
  return {
    ...actual,
    getIndexedCsvData: async (
      url: string,
      cacheKey: string,
      kind: 'forecast',
      build: (data: Buffer, reload: () => Promise<Buffer>) => Promise<unknown>
    ) => {
      if (failState.param && cacheKey.includes(`.${failState.param}.csv`)) {
        throw new Error(`simulated download failure for ${failState.param}`);
      }
      return actual.getIndexedCsvData(url, cacheKey, kind, build);
    },
  };
});

import { getWeatherSituation } from '../../src/data/ogd-weather-situation.js';
import { pickRunAssets } from '../../src/data/weather-situation-run.js';

const DEFAULT_BANDS = [500, 1000, 1500, 2000];

const NO_FOG_TOP = { fog_top_m: null, sunny_above_fog_pct: null, fog_top_points: null };

describe('getWeatherSituation (fixtures)', () => {
  it('counts the fog sea of 28.03 09:00 local per region and band', async () => {
    const result = await getWeatherSituation({ time: '2026-03-28T09:00', bands: DEFAULT_BANDS });

    expect(result.valid).toEqual({ from: '2026-03-28T09:00:00+01:00', hours: 1 });
    expect(result.run).toBe('2026-03-27T00:00:00+01:00');
    expect(result.points).toBe(33);
    expect(result.missing).toBe(1); // Napf has no row at this hour
    expect(result.warnings).toBeUndefined();
    expect(result.source).toBe('MeteoSwiss Open Data; forecast regions: Source: MeteoSwiss');
    expect(result.regions.map((r) => r.id)).toEqual([
      'jura',
      'mittelland',
      'alpennordhang',
      'wallis',
      'engadin',
      'nordundmittelbuenden',
      'alpensuedseite',
    ]);

    const byId = new Map(result.regions.map((r) => [r.id, r]));
    // Symbols 27/28, plus an overcast (35) and a partly sunny (3) hour under a low deck
    // (cloud rule); one overcast point keeps "cloudy" because of medium cloud above.
    expect(byId.get('mittelland')).toEqual({
      id: 'mittelland',
      name: 'Mittelland',
      points: 9,
      dominant: 'fog_or_stratus',
      bands: [
        { band: '<500', points: 5, pct: { fog_or_stratus: 100 }, dominant: 'fog_or_stratus' },
        {
          band: '500-999',
          points: 4,
          pct: { fog_or_stratus: 75, cloudy: 25 },
          dominant: 'fog_or_stratus',
        },
      ],
      // The fixture has far fewer than 5 points per 100 m band: no fog top
      // (the method is tested with synthetic points in weather-situation-fog.test.ts).
      ...NO_FOG_TOP,
    });
    // Andermatt lies outside all seven fixture regions and is counted in the nearest one.
    expect(byId.get('alpennordhang')).toEqual({
      id: 'alpennordhang',
      name: 'Alpennordhang',
      points: 9,
      dominant: 'fog_or_stratus',
      bands: [
        { band: '<500', points: 1, pct: { fog_or_stratus: 100 }, dominant: 'fog_or_stratus' },
        {
          band: '500-999',
          points: 5,
          pct: { fog_or_stratus: 60, sunny: 40 },
          dominant: 'fog_or_stratus',
        },
        { band: '1000-1499', points: 2, pct: { sunny: 100 }, dominant: 'sunny' },
        { band: '>=2000', points: 1, pct: { fog_or_stratus: 100 }, dominant: 'fog_or_stratus' },
      ],
      ...NO_FOG_TOP,
    });
    expect(byId.get('wallis')?.bands).toEqual([
      { band: '1500-1999', points: 2, pct: { sunny: 50, partly_sunny: 50 }, dominant: 'sunny' },
    ]);
    // Only the three regions north of the Alps carry the fog top fields.
    expect(result.regions.filter((r) => 'fog_top_m' in r).map((r) => r.id)).toEqual([
      'jura',
      'mittelland',
      'alpennordhang',
    ]);
    expect(byId.get('alpensuedseite')?.dominant).toBe('rain');
    expect(byId.get('nordundmittelbuenden')?.name).toBe('Nord- und Mittelbünden');

    expect(Object.keys(result.legend)).toEqual([
      'sunny',
      'partly_sunny',
      'cloudy',
      'high_cloud',
      'fog_or_stratus',
      'rain',
      'snow',
    ]);
  });

  it('sees the cloud above the deck at 12:00 local: overcast, not fog', async () => {
    const result = await getWeatherSituation({
      time: '2026-03-28T12:00',
      region: 'mittelland',
      bands: [],
    });
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]?.bands).toEqual([
      { band: 'all', points: 9, pct: { cloudy: 78, rain: 22 }, dominant: 'cloudy' },
    ]);
  });

  it('filters one region and leaves out "missing" when nothing is missing', async () => {
    const result = await getWeatherSituation({
      time: '2026-03-28T09:00',
      region: 'jura',
      bands: [1000],
    });
    expect(result.points).toBe(3);
    expect('missing' in result).toBe(false);
    expect(result.regions).toEqual([
      {
        id: 'jura',
        name: 'Jura',
        points: 3,
        dominant: 'sunny',
        bands: [
          { band: '<1000', points: 1, pct: { fog_or_stratus: 100 }, dominant: 'fog_or_stratus' },
          { band: '>=1000', points: 2, pct: { sunny: 100 }, dominant: 'sunny' },
        ],
        ...NO_FOG_TOP,
      },
    ]);
  });

  it('accepts a time with an offset from another tool', async () => {
    const result = await getWeatherSituation({
      time: '2026-03-28T09:00:00+01:00',
      region: 'jura',
      bands: DEFAULT_BANDS,
    });
    expect(result.valid.from).toBe('2026-03-28T09:00:00+01:00');
  });

  it('rejects an hour outside the run and names the range', async () => {
    await expect(
      getWeatherSituation({ time: '2026-04-05T10:00', bands: DEFAULT_BANDS })
    ).rejects.toThrow(/outside the forecast run of .* it covers 2026-03-26T11:00:00\+01:00 to/);
  });

  it('names the nearest hours where the run has only 3-hourly symbols', async () => {
    await expect(
      getWeatherSituation({ time: '2026-03-30T03:00', bands: DEFAULT_BANDS })
    ).rejects.toThrow(/nearest 2026-03-30T02:00:00\+02:00 and 2026-03-30T05:00:00\+02:00/);
  });

  it('rejects bad input before loading anything', async () => {
    await expect(getWeatherSituation({ time: 'soon', bands: DEFAULT_BANDS })).rejects.toThrow(
      RangeError
    );
    await expect(
      getWeatherSituation({ time: '2026-03-28T09:00', bands: [1000, 500] })
    ).rejects.toThrow(/ascending/);
  });

  it('turns the cloud rule off with a warning when a cloud file fails', async () => {
    failState.param = 'nprolohs';
    try {
      const result = await getWeatherSituation({
        time: '2026-03-28T09:00',
        region: 'mittelland',
        bands: DEFAULT_BANDS,
      });
      expect(result.warnings).toEqual([
        'nprolohs (low cloud cover): download failed',
        'Without the cloud cover the cloud rule is off: fog_or_stratus counts only the fog and stratus symbols.',
      ]);
      // The overcast and partly sunny points under the deck keep their symbol.
      expect(result.regions[0]?.bands).toEqual([
        {
          band: '<500',
          points: 5,
          pct: { fog_or_stratus: 80, partly_sunny: 20 },
          dominant: 'fog_or_stratus',
        },
        {
          band: '500-999',
          points: 4,
          pct: { cloudy: 50, fog_or_stratus: 50 },
          dominant: 'cloudy',
        },
      ]);
    } finally {
      failState.param = '';
    }
  });

  it('fails when the symbol file fails', async () => {
    failState.param = 'jww003i0';
    try {
      await expect(
        getWeatherSituation({ time: '2026-03-28T09:00', bands: DEFAULT_BANDS })
      ).rejects.toThrow(/simulated download failure/);
    } finally {
      failState.param = '';
    }
  });
});

describe('pickRunAssets', () => {
  const asset = { href: 'https://example.invalid/x.csv' };
  const item = (keys: string[]): StacItem => ({
    id: '20261113-ch',
    properties: {},
    assets: Object.fromEntries(keys.map((k) => [k, asset])),
  });
  const file = (run: string, param: string): string => `vnut12.lssw.${run}.${param}.csv`;
  const all = (run: string): string[] =>
    ['jww003i0', 'nprolohs', 'npromths', 'nprohihs'].map((p) => file(run, p));

  it('takes the newest run with all four files', () => {
    expect(pickRunAssets(item([...all('202611131000'), ...all('202611131100')]))).toEqual({
      run: '202611131100',
      symbolKey: file('202611131100', 'jww003i0'),
      cloudKeys: ['nprolohs', 'npromths', 'nprohihs'].map((p) => file('202611131100', p)),
    });
  });

  it('stays on the previous run while the newest is still uploading', () => {
    const picked = pickRunAssets(item([...all('202611131000'), file('202611131100', 'jww003i0')]));
    expect(picked.run).toBe('202611131000');
  });

  it('falls back to the newest symbol and each cloud file’s newest run', () => {
    const picked = pickRunAssets(
      item([file('202611131100', 'jww003i0'), file('202611131000', 'nprolohs')])
    );
    expect(picked).toEqual({
      run: '202611131100',
      symbolKey: file('202611131100', 'jww003i0'),
      cloudKeys: [file('202611131000', 'nprolohs'), null, null],
    });
  });

  it('fails without a symbol file', () => {
    expect(() => pickRunAssets(item(all('202611131000').slice(1)))).toThrow(/jww003i0/);
  });
});

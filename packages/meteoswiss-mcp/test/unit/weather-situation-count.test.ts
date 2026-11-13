import { describe, expect, it } from 'vitest';
import {
  bandIndex,
  bandLabels,
  checkBandEdges,
  countSituation,
  sharesPct,
  type SituationSample,
} from '../../src/data/weather-situation-count.js';
import { WEATHER_CATEGORIES, type WeatherCategory } from '../../src/support/weather-categories.js';

/** Counts indexed like WEATHER_CATEGORIES. */
function counts(by: Partial<Record<WeatherCategory, number>>): number[] {
  return WEATHER_CATEGORIES.map((c) => by[c] ?? 0);
}

describe('bands', () => {
  it('labels bands from their edges', () => {
    expect(bandLabels([500, 1000, 1500, 2000])).toEqual([
      '<500',
      '500-999',
      '1000-1499',
      '1500-1999',
      '>=2000',
    ]);
    expect(bandLabels([800])).toEqual(['<800', '>=800']);
    expect(bandLabels([])).toEqual(['all']);
  });

  it('puts an altitude on an edge into the band above it', () => {
    const edges = [500, 1000];
    expect(bandIndex(edges, 499)).toBe(0);
    expect(bandIndex(edges, 500)).toBe(1);
    expect(bandIndex(edges, 999.9)).toBe(1);
    expect(bandIndex(edges, 4000)).toBe(2);
    expect(bandIndex([], 4000)).toBe(0);
  });

  it('checks the edges', () => {
    expect(() => checkBandEdges([500, 1000])).not.toThrow();
    expect(() => checkBandEdges([])).not.toThrow();
    expect(() => checkBandEdges([1000, 500])).toThrow(/ascending/);
    expect(() => checkBandEdges([500, 500])).toThrow(/ascending/);
    expect(() => checkBandEdges([0])).toThrow(/1 to 4800/);
    expect(() => checkBandEdges([500.5])).toThrow(/whole number/);
    expect(() => checkBandEdges(Array.from({ length: 11 }, (_, i) => (i + 1) * 100))).toThrow(
      /at most 10/
    );
  });
});

describe('sharesPct', () => {
  it('rounds to whole percent that add up to 100, largest first', () => {
    const result = sharesPct(counts({ rain: 1, sunny: 1, snow: 1 }));
    expect(result?.pct).toEqual({ sunny: 34, rain: 33, snow: 33 });
    expect(Object.keys(result?.pct ?? {})).toEqual(['sunny', 'rain', 'snow']);
    expect(result?.dominant).toBe('sunny');
  });

  it('orders by count and leaves out categories without points', () => {
    const result = sharesPct(counts({ sunny: 2, fog_or_stratus: 7, cloudy: 1 }));
    expect(result?.pct).toEqual({ fog_or_stratus: 70, sunny: 20, cloudy: 10 });
    expect(Object.keys(result?.pct ?? {})).toEqual(['fog_or_stratus', 'sunny', 'cloudy']);
    expect(result?.dominant).toBe('fog_or_stratus');
  });

  it('drops a share that rounds to 0 and still adds up to 100', () => {
    const result = sharesPct(counts({ sunny: 999, rain: 1 }));
    expect(result?.pct).toEqual({ sunny: 100 });
  });

  it('returns null without counts', () => {
    expect(sharesPct(counts({}))).toBeNull();
  });
});

describe('countSituation', () => {
  const sample = (
    point: string,
    region: SituationSample['region'],
    altitude: number,
    category: WeatherCategory
  ): SituationSample => ({ point, region, altitude, category });

  it('counts per region and band, regions in MeteoSwiss order, empty bands left out', () => {
    const result = countSituation(
      [
        sample('1:1', 'mittelland', 450, 'fog_or_stratus'),
        sample('2:1', 'mittelland', 480, 'fog_or_stratus'),
        sample('3:1', 'mittelland', 700, 'sunny'),
        sample('4:1', 'jura', 1200, 'sunny'),
      ],
      [500, 1000]
    );
    expect(result).toEqual([
      {
        id: 'jura',
        points: 1,
        dominant: 'sunny',
        bands: [{ band: '>=1000', points: 1, pct: { sunny: 100 }, dominant: 'sunny' }],
      },
      {
        id: 'mittelland',
        points: 3,
        dominant: 'fog_or_stratus',
        bands: [
          { band: '<500', points: 2, pct: { fog_or_stratus: 100 }, dominant: 'fog_or_stratus' },
          { band: '500-999', points: 1, pct: { sunny: 100 }, dominant: 'sunny' },
        ],
      },
    ]);
  });

  it('counts a point once but each of its hours in the shares', () => {
    const result = countSituation(
      [
        sample('1:1', 'wallis', 1600, 'sunny'),
        sample('1:1', 'wallis', 1600, 'sunny'),
        sample('1:1', 'wallis', 1600, 'sunny'),
        sample('1:1', 'wallis', 1600, 'snow'),
      ],
      []
    );
    expect(result).toEqual([
      {
        id: 'wallis',
        points: 1,
        dominant: 'sunny',
        bands: [{ band: 'all', points: 1, pct: { sunny: 75, snow: 25 }, dominant: 'sunny' }],
      },
    ]);
  });

  it('handles thousands of points', () => {
    const many: SituationSample[] = [];
    for (let i = 0; i < 6000; i++) {
      many.push(sample(`${i}:2`, 'mittelland', 300 + (i % 1000), i % 3 ? 'sunny' : 'rain'));
    }
    const [region] = countSituation(many, [500, 1000]);
    expect(region?.points).toBe(6000);
    expect(region?.bands.map((b) => b.points)).toEqual([1200, 3000, 1800]);
    expect(region?.dominant).toBe('sunny');
  });
});

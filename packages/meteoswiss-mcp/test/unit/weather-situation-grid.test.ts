import { describe, expect, it } from 'vitest';
import { buildGrid, type GridSample } from '../../src/data/weather-situation-grid.js';
import { wgs84ToLv95 } from '../../src/support/swiss-coordinates.js';
import type { WeatherCategory } from '../../src/support/weather-categories.js';

describe('wgs84ToLv95', () => {
  // Pairs from the forecast point list (WGS84 and LV95 columns of the same point).
  it.each([
    ['Zürich 8001', 47.372289, 8.542189, 2683348, 1247414],
    ['Arosa', 46.792661, 9.679014, 2771031, 1184830],
    ['La Dôle', 46.424794, 6.099453, 2497059, 1142373],
    ['Sta. Maria', 46.602256, 10.426314, 2828862, 1165580],
  ])('places %s within 2 m of its LV95 coordinates', (_name, lat, lon, e, n) => {
    const p = wgs84ToLv95(lat, lon);
    expect(Math.abs(p.e - e)).toBeLessThan(2);
    expect(Math.abs(p.n - n)).toBeLessThan(2);
  });
});

describe('buildGrid', () => {
  const at = (e: number, n: number, category: WeatherCategory): GridSample => ({ e, n, category });

  it('draws one character per 5 km cell, north to south, cut to the cells with points', () => {
    const grid = buildGrid([
      at(2_600_100, 1_200_100, 'sunny'), // cell (24, 26)
      at(2_610_100, 1_200_100, 'fog_or_stratus'), // two cells east
      at(2_600_100, 1_205_100, 'rain'), // one cell north
    ]);
    expect(grid).toEqual({
      crs: 'EPSG:2056',
      cell_m: 5000,
      west: 2_600_000,
      north: 1_210_000,
      rows: ['R..', 'S.F'],
      key: { S: 'sunny', F: 'fog_or_stratus', R: 'rain', '.': 'no forecast point' },
    });
  });

  it('shows the most frequent category of a cell, legend order on a tie', () => {
    const cell = (cats: WeatherCategory[]): string | undefined =>
      buildGrid(cats.map((c) => at(2_700_000, 1_150_000, c)))?.rows[0];
    expect(cell(['rain', 'fog_or_stratus', 'fog_or_stratus'])).toBe('F');
    expect(cell(['rain', 'sunny'])).toBe('S');
    expect(cell(['snow', 'thunder', 'snow'])).toBe('W');
  });

  it('returns null without samples', () => {
    expect(buildGrid([])).toBeNull();
  });
});

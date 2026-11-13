import { describe, expect, it } from 'vitest';
import { getWeatherSituation } from '../../src/data/ogd-weather-situation.js';

/**
 * Window and area filters of getWeatherSituation over the fixtures (scenario in
 * test/__fixtures__/ogd/forecasts/README.md; regions are the synthetic boxes).
 */

const ids = (result: Awaited<ReturnType<typeof getWeatherSituation>>): string[] =>
  result.regions.map((r) => `${r.id}:${r.points}`);

describe('getWeatherSituation window', () => {
  it('counts point-hours over a window: points stay points, shares are of point-hours', async () => {
    // Jura, 08:00-12:00 CET: Delémont fog, fog, partly sunny, sunny, overcast;
    // Chaumont and La Dôle sunny for four hours, then rain.
    const result = await getWeatherSituation({
      time: '2026-03-28T08:00',
      until: '2026-03-28T12:00',
      region: 'jura',
      bands: [],
    });
    expect(result.valid).toEqual({
      from: '2026-03-28T08:00:00+01:00',
      until: '2026-03-28T12:00:00+01:00',
      hours: 5,
    });
    expect(result.points).toBe(3);
    expect(result.regions).toEqual([
      {
        id: 'jura',
        name: 'Jura',
        points: 3,
        dominant: 'sunny',
        bands: [
          {
            band: 'all',
            points: 3,
            pct: { sunny: 60, fog_or_stratus: 13, rain: 13, partly_sunny: 7, cloudy: 7 },
            dominant: 'sunny',
          },
        ],
        fog_top_m: null,
        sunny_above_fog_pct: null,
        fog_top_points: null,
      },
    ]);
  });

  it('counts missing point-hours (Napf has no row in the window)', async () => {
    const result = await getWeatherSituation({
      time: '2026-03-28T08:00',
      until: '2026-03-28T12:00',
      region: 'alpennordhang',
      bands: [],
    });
    expect(result.points).toBe(9);
    expect(result.missing).toBe(5);
  });

  it('uses the hours the run has where it has symbols only every few hours, and says so', async () => {
    // 30.03 is summer time: 02:00-05:00 CEST = 00-03 UTC; the fixture has 00 and 03 UTC only.
    const result = await getWeatherSituation({
      time: '2026-03-30T02:00',
      until: '2026-03-30T05:00',
      bands: [],
    });
    expect(result.valid.hours).toBe(2);
    expect(result.points).toBe(1); // only Zürich 8001 has rows that far ahead
    expect(result.warnings).toEqual([
      'The forecast run has symbols for 2 of the 4 hours asked for (further ahead it has values only every few hours); the counts use those 2.',
    ]);
  });

  it('rejects a window longer than 12 hours or ending before it starts', async () => {
    await expect(
      getWeatherSituation({ time: '2026-03-28T08:00', until: '2026-03-28T21:00', bands: [] })
    ).rejects.toThrow(/13 h after time; at most 12 h/);
    await expect(
      getWeatherSituation({ time: '2026-03-28T08:00', until: '2026-03-28T07:00', bands: [] })
    ).rejects.toThrow(/before time/);
  });
});

describe('getWeatherSituation area filters', () => {
  it('near: points within the air distance of a place', async () => {
    // Within 40 km of Zürich: Zürich 8001 and Hallau (Mittelland), Einsiedeln (Alpennordhang).
    const result = await getWeatherSituation({
      time: '2026-03-28T09:00',
      near: { lat: 47.372289, lon: 8.542189, radius_km: 40 },
      bands: [],
    });
    expect(ids(result)).toEqual(['mittelland:2', 'alpennordhang:1']);
    expect(result.points).toBe(3);
  });

  it('bbox: points inside a box, edges included', async () => {
    const result = await getWeatherSituation({
      time: '2026-03-28T09:00',
      bbox: [6.0, 46.0, 7.5, 47.0],
      bands: [],
    });
    expect(ids(result)).toEqual(['jura:1', 'mittelland:5', 'alpennordhang:1']);
  });

  it('altitude limits, inclusive', async () => {
    const result = await getWeatherSituation({
      time: '2026-03-28T09:00',
      min_altitude_m: 1000,
      max_altitude_m: 2000,
      bands: [],
    });
    expect(result.points).toBe(13);
    expect(result.missing).toBe(1); // Napf, 1404 m
  });

  it('combines region and filters (all must hold)', async () => {
    const result = await getWeatherSituation({
      time: '2026-03-28T09:00',
      region: 'mittelland',
      bbox: [6.0, 46.0, 7.5, 47.0],
      max_altitude_m: 500,
      bands: [],
    });
    // Payerne (490 m) and Genève (375 m); Fribourg, Bern and Zollikofen are higher.
    expect(ids(result)).toEqual(['mittelland:2']);
  });

  it('answers with no regions when no point passes', async () => {
    const result = await getWeatherSituation({
      time: '2026-03-28T09:00',
      near: { lat: 47.0, lon: 11.4, radius_km: 5 },
      bands: [],
    });
    expect(result.points).toBe(0);
    expect(result.regions).toEqual([]);
    expect(result.legend).toEqual({});
  });

  it('rejects an inverted box and crossed altitude limits', async () => {
    await expect(
      getWeatherSituation({ time: '2026-03-28T09:00', bbox: [8, 46, 7, 47], bands: [] })
    ).rejects.toThrow(/west must be less/);
    await expect(
      getWeatherSituation({
        time: '2026-03-28T09:00',
        min_altitude_m: 1500,
        max_altitude_m: 1000,
        bands: [],
      })
    ).rejects.toThrow(/above max_altitude_m/);
  });
});

describe('getWeatherSituation map grid', () => {
  it('adds the 5 km raster of the filtered points only with map: "grid"', async () => {
    const plain = await getWeatherSituation({ time: '2026-03-28T09:00', bands: [] });
    expect('grid' in plain).toBe(false);

    // Zürich 8001 and Hallau (fog), Einsiedeln (sunny), within 40 km of Zürich.
    const result = await getWeatherSituation({
      time: '2026-03-28T09:00',
      near: { lat: 47.372289, lon: 8.542189, radius_km: 40 },
      bands: [],
      map: 'grid',
    });
    expect(result.grid).toMatchObject({
      crs: 'EPSG:2056',
      cell_m: 5000,
      west: 2_675_000,
      north: 1_285_000,
      key: { S: 'sunny', F: 'fog_or_stratus', '.': 'no forecast point' },
    });
    const rows = result.grid?.rows ?? [];
    expect(rows).toHaveLength(13);
    expect(rows[0]).toBe('F....'); // Hallau, north
    expect(rows[7]).toBe('.F...'); // Zürich
    expect(rows[12]).toBe('....S'); // Einsiedeln, south-east
  });
});

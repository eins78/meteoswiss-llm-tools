import { describe, expect, it } from 'vitest';
import {
  assignRegion,
  getPointRegions,
  pointKey,
  regionOf,
} from '../../src/data/forecast-point-regions.js';
import type { ForecastRegion } from '../../src/data/forecast-regions.js';
import { getForecastPoints } from '../../src/data/ogd-station-resolver.js';

/**
 * Point → region on the synthetic fixtures (USE_TEST_FIXTURES, see
 * test/__fixtures__/forecast-regions/README.md): boxes around the fixture
 * points, Andermatt in none of them.
 */

describe('getPointRegions (fixtures)', () => {
  it('gives every fixture point a region', async () => {
    const points = await getForecastPoints();
    const byPoint = await getPointRegions();
    expect(points.length).toBeGreaterThan(30);
    for (const p of points) {
      expect(byPoint.get(pointKey(p.point_id, p.point_type_id)), p.name).toEqual(
        expect.objectContaining({ region: expect.any(String) })
      );
    }
  });

  it('maps hand-checked points inside their region', async () => {
    expect(await regionOf(800100, 2)).toEqual({
      region: 'mittelland',
      method: 'inside',
      distanceKm: 0,
    }); // Zürich
    expect(await regionOf(27, 1)).toEqual({
      region: 'nordundmittelbuenden',
      method: 'inside',
      distanceKm: 0,
    }); // Chur
    expect(await regionOf(24, 1)).toEqual({ region: 'engadin', method: 'inside', distanceKm: 0 }); // Segl-Maria
  });

  it('gives a point outside all seven the nearest region and says so', async () => {
    const andermatt = await regionOf(10, 1);
    expect(andermatt).toEqual({
      region: 'alpennordhang',
      method: 'nearest',
      distanceKm: expect.any(Number),
    });
    expect(andermatt!.distanceKm).toBeGreaterThan(20);
  });

  it('returns undefined for a point the point list does not hold', async () => {
    expect(await regionOf(999999, 2)).toBeUndefined();
  });

  it('computes the assignment once per region set and point list', async () => {
    expect(await getPointRegions()).toBe(await getPointRegions());
  });
});

describe('assignRegion', () => {
  const square = (id: ForecastRegion['id'], lon: number): ForecastRegion => ({
    id,
    names: { de: id, fr: id, it: id } as ForecastRegion['names'],
    polygons: [
      [
        [
          [lon, 46],
          [lon + 1, 46],
          [lon + 1, 47],
          [lon, 47],
          [lon, 46],
        ],
      ],
    ],
    bbox: [lon, 46, lon + 1, 47],
  });
  const regions = [square('jura', 6), square('mittelland', 8)];

  it('picks the containing region', () => {
    expect(assignRegion(regions, 8.5, 46.5)).toEqual({
      region: 'mittelland',
      method: 'inside',
      distanceKm: 0,
    });
  });

  it('picks the nearest boundary for a point in the gap', () => {
    // 7.1 is 0.1° from jura's east edge (7) and 0.9° from mittelland's west edge (8)
    expect(assignRegion(regions, 7.1, 46.5)).toEqual({
      region: 'jura',
      method: 'nearest',
      distanceKm: expect.closeTo(7.61, 1),
    });
  });

  it('returns null without regions', () => {
    expect(assignRegion([], 7, 46)).toBeNull();
  });
});

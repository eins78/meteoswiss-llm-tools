import { describe, expect, it } from 'vitest';
import {
  bboxOf,
  distanceToPolygonsKm,
  parseGeoJsonPolygons,
  polygonContains,
  type Polygon,
} from '../../src/support/geo-polygons.js';

// A 1° square from (7,46) to (8,47) with a hole from (7.4,46.4) to (7.6,46.6)
const SQUARE_WITH_HOLE: Polygon = [
  [
    [7, 46],
    [8, 46],
    [8, 47],
    [7, 47],
    [7, 46],
  ],
  [
    [7.4, 46.4],
    [7.6, 46.4],
    [7.6, 46.6],
    [7.4, 46.6],
    [7.4, 46.4],
  ],
];

describe('parseGeoJsonPolygons', () => {
  it('reads Polygon and MultiPolygon features and skips lines', () => {
    const polygons = parseGeoJsonPolygons({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: SQUARE_WITH_HOLE } },
        {
          type: 'Feature',
          geometry: { type: 'MultiPolygon', coordinates: [SQUARE_WITH_HOLE, SQUARE_WITH_HOLE] },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [7, 46],
              [8, 47],
            ],
          },
        },
      ],
    });
    expect(polygons).toHaveLength(3);
    expect(polygons[0]).toEqual(SQUARE_WITH_HOLE);
  });

  it('throws on a ring with fewer than four positions', () => {
    expect(() =>
      parseGeoJsonPolygons({
        type: 'Polygon',
        coordinates: [
          [
            [7, 46],
            [8, 46],
            [7, 46],
          ],
        ],
      })
    ).toThrow(/fewer than four/);
  });

  it('throws on a position that is not [lon, lat]', () => {
    expect(() =>
      parseGeoJsonPolygons({
        type: 'Polygon',
        coordinates: [
          [
            [7, 46],
            ['8', 46],
            [8, 47],
            [7, 46],
          ],
        ],
      })
    ).toThrow(/not \[lon, lat\]/);
  });

  it('throws on a FeatureCollection without features', () => {
    expect(() => parseGeoJsonPolygons({ type: 'FeatureCollection' })).toThrow(/no features/);
  });
});

describe('polygonContains', () => {
  it('is true inside, false in the hole and outside', () => {
    expect(polygonContains(SQUARE_WITH_HOLE, 7.2, 46.2)).toBe(true);
    expect(polygonContains(SQUARE_WITH_HOLE, 7.5, 46.5)).toBe(false);
    expect(polygonContains(SQUARE_WITH_HOLE, 8.5, 46.5)).toBe(false);
  });
});

describe('bboxOf', () => {
  it('spans all positions', () => {
    expect(bboxOf([SQUARE_WITH_HOLE])).toEqual([7, 46, 8, 47]);
  });

  it('throws for no positions', () => {
    expect(() => bboxOf([])).toThrow(/No positions/);
  });
});

describe('distanceToPolygonsKm', () => {
  it('measures to the nearest edge, holes included', () => {
    // 0.1° of latitude south of the square's south edge ≈ 11 km
    expect(distanceToPolygonsKm([SQUARE_WITH_HOLE], 7.5, 45.9)).toBeCloseTo(11.06, 1);
    // centre of the hole: 0.1° to the hole's edges ≈ 7.6 km east-west at 46.5°N
    expect(distanceToPolygonsKm([SQUARE_WITH_HOLE], 7.5, 46.5)).toBeCloseTo(7.61, 1);
  });

  it('is Infinity without polygons', () => {
    expect(distanceToPolygonsKm([], 7.5, 46.5)).toBe(Infinity);
  });
});

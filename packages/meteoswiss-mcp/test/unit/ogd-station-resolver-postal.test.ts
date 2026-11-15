import { describe, expect, it } from 'vitest';
import { indexByPostalCode } from '../../src/data/ogd-station-resolver.js';
import type { ForecastPoint } from '../../src/schemas/ogd-shared.js';

const point = (
  point_id: number,
  name: string,
  postal_code: string | null,
  point_type_id = 2
): ForecastPoint => ({
  point_id,
  point_type_id,
  station_abbr: null,
  postal_code,
  name,
  elevation: 300,
  coordinates: { lat: 46, lon: 8.9 },
});

describe('indexByPostalCode', () => {
  it("takes the postal code's own point (lowest id), not the last one listed", () => {
    // 6900 in the real point list: three points share it.
    const points = [
      point(690000, 'Lugano', '6900'),
      point(690005, 'Massagno', '6900'),
      point(690009, 'Paradiso', '6900'),
    ];
    expect(indexByPostalCode(points).get('6900')?.name).toBe('Lugano');
    expect(indexByPostalCode([...points].reverse()).get('6900')?.name).toBe('Lugano');
  });

  it('indexes only postal-code points', () => {
    const index = indexByPostalCode([point(47, 'Lugano', '6900', 1), point(800100, 'Zürich', '8001')]);
    expect([...index.keys()]).toEqual(['8001']);
  });
});

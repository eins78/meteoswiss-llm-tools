/**
 * WGS84 → Swiss LV95 (EPSG:2056), with swisstopo's approximate formulas.
 *
 * Accurate to about 1 m inside Switzerland, which is plenty for placing a
 * forecast point in a 5 km grid cell. Source: swisstopo, "Approximate formulas
 * for the transformation between Swiss projection coordinates and WGS84".
 */

/**
 * Convert WGS84 degrees to LV95 metres.
 *
 * @param lat - Latitude in degrees
 * @param lon - Longitude in degrees
 * @returns `e` (east, about 2.48–2.84 M in Switzerland) and `n` (north, about 1.07–1.30 M)
 */
export function wgs84ToLv95(lat: number, lon: number): { e: number; n: number } {
  const phi = (lat * 3600 - 169028.66) / 10000;
  const lambda = (lon * 3600 - 26782.5) / 10000;
  const e =
    2600072.37 +
    211455.93 * lambda -
    10938.51 * lambda * phi -
    0.36 * lambda * phi ** 2 -
    44.54 * lambda ** 3;
  const n =
    1200147.07 +
    308807.95 * phi +
    3745.25 * lambda ** 2 +
    76.63 * phi ** 2 -
    194.56 * lambda ** 2 * phi +
    119.79 * phi ** 3;
  return { e, n };
}

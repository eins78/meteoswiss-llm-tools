/**
 * Small WGS84 polygon helpers: GeoJSON polygon parsing, point-in-polygon and
 * distance to a polygon boundary. Enough for assigning ~6000 forecast points to a
 * handful of regions; not a general GIS library.
 */

/** A GeoJSON position, `[lon, lat]` in degrees. */
export type Position = readonly [number, number];

/** A closed ring of positions (GeoJSON repeats the first position at the end). */
export type Ring = readonly Position[];

/** A polygon: outer ring first, then holes. Containment is even-odd over all rings. */
export type Polygon = readonly Ring[];

/** `[minLon, minLat, maxLon, maxLat]` */
export type BBox = readonly [number, number, number, number];

/** Kilometres per degree of latitude (mean). */
const KM_PER_DEG_LAT = 110.57;

/**
 * Type guard for a GeoJSON position with finite `[lon, lat]` (extra ordinates allowed).
 */
export function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/**
 * Parse GeoJSON polygon coordinates (`[[[lon, lat], …], …]`).
 *
 * @throws {Error} If the value is not an array of rings of at least four positions
 */
function parsePolygonCoordinates(value: unknown): Polygon {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Polygon has no rings');
  }
  return value.map((ring: unknown): Ring => {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new Error('Polygon ring has fewer than four positions');
    }
    return ring.map((position: unknown): Position => {
      if (!isPosition(position)) {
        throw new Error('Polygon ring holds a position that is not [lon, lat]');
      }
      return [position[0], position[1]];
    });
  });
}

/** Type guard for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read `obj[key]` from an unknown value, or `undefined`. */
function prop(obj: unknown, key: string): unknown {
  return isRecord(obj) ? obj[key] : undefined;
}

/**
 * Collect the polygons of a GeoJSON geometry; other geometry types yield none.
 */
function polygonsOfGeometry(geometry: unknown): Polygon[] {
  const type = prop(geometry, 'type');
  const coordinates = prop(geometry, 'coordinates');
  if (type === 'Polygon') {
    return [parsePolygonCoordinates(coordinates)];
  }
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates)) {
      throw new Error('MultiPolygon coordinates are not an array');
    }
    return coordinates.map((polygon: unknown) => parsePolygonCoordinates(polygon));
  }
  return [];
}

/**
 * Extract every polygon from a GeoJSON FeatureCollection, Feature or geometry.
 * Line and point geometries are skipped; malformed polygons throw.
 *
 * @param geojson - Parsed GeoJSON
 * @returns The polygons, in document order
 * @throws {Error} If a polygon is malformed
 */
export function parseGeoJsonPolygons(geojson: unknown): Polygon[] {
  const type = prop(geojson, 'type');
  if (type === 'FeatureCollection') {
    const features = prop(geojson, 'features');
    if (!Array.isArray(features)) {
      throw new Error('FeatureCollection has no features array');
    }
    return features.flatMap((feature: unknown) => polygonsOfGeometry(prop(feature, 'geometry')));
  }
  if (type === 'Feature') {
    return polygonsOfGeometry(prop(geojson, 'geometry'));
  }
  return polygonsOfGeometry(geojson);
}

/**
 * Bounding box over all positions of the given polygons.
 *
 * @throws {Error} If there are no positions
 */
export function bboxOf(polygons: readonly Polygon[]): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (minLon === Infinity) {
    throw new Error('No positions to bound');
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** Whether `[lon, lat]` lies inside the bounding box (edges included). */
export function bboxContains(bbox: BBox, lon: number, lat: number): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/**
 * Even-odd point-in-polygon test over all rings (so holes work).
 *
 * @param polygon - Outer ring and holes, `[lon, lat]`
 * @param lon - Longitude in degrees
 * @param lat - Latitude in degrees
 */
export function polygonContains(polygon: Polygon, lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const [xi, yi] = ring[i] ?? [0, 0];
      const [xk, yk] = ring[k] ?? [0, 0];
      if (yi > lat !== yk > lat && lon < ((xk - xi) * (lat - yi)) / (yk - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Distance in km from `[lon, lat]` to the nearest ring edge of any polygon.
 *
 * Uses a local equirectangular projection around the point: within the few
 * hundred kilometres of Switzerland the error is well under 1 %, which is plenty
 * for picking the nearest region.
 *
 * @returns Distance in km, `Infinity` for no polygons
 */
export function distanceToPolygonsKm(
  polygons: readonly Polygon[],
  lon: number,
  lat: number
): number {
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1] ?? [0, 0];
        const [bx, by] = ring[i] ?? [0, 0];
        const d = segmentDistance(
          (ax - lon) * kmPerDegLon,
          (ay - lat) * KM_PER_DEG_LAT,
          (bx - lon) * kmPerDegLon,
          (by - lat) * KM_PER_DEG_LAT
        );
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** Distance from the origin to the segment a–b, in the segment's units. */
function segmentDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

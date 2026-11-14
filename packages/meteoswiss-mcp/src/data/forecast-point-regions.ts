/**
 * Which MeteoSwiss forecast region each forecast point belongs to.
 *
 * A point inside one of the seven region polygons gets that region. A point
 * outside all seven (border peaks and passes, the Urseren valley with Andermatt
 * and Realp: about 50 of ~5800) gets the region whose boundary is nearest, and
 * the result says so (`method: 'nearest'`), so a tool can tell its users.
 */

import type { ForecastPoint } from '../schemas/ogd-shared.js';
import { bboxContains, distanceToPolygonsKm, polygonContains } from '../support/geo-polygons.js';
import { debugData } from '../support/logging.js';
import type { ForecastRegionId } from './forecast-regions-source.js';
import {
  getForecastRegions,
  type ForecastRegion,
  type ForecastRegionSet,
} from './forecast-regions.js';
import { getForecastPoints } from './ogd-station-resolver.js';

/** The region of one forecast point. */
export type PointRegion = {
  region: ForecastRegionId;
  /** `inside`: the point lies in the region; `nearest`: outside all seven, nearest boundary */
  method: 'inside' | 'nearest';
  /** Distance to the region's boundary in km; 0 for `inside` */
  distanceKm: number;
};

/** Point key as the OGD files use it: point ids repeat across point types. */
export function pointKey(pointId: number, pointTypeId: number): string {
  return `${pointId}:${pointTypeId}`;
}

/**
 * Assign one position to a region.
 *
 * @param regions - The seven regions
 * @param lon - Longitude in degrees
 * @param lat - Latitude in degrees
 * @returns The region, or null if `regions` is empty
 */
export function assignRegion(
  regions: readonly ForecastRegion[],
  lon: number,
  lat: number
): PointRegion | null {
  for (const region of regions) {
    if (
      bboxContains(region.bbox, lon, lat) &&
      region.polygons.some((p) => polygonContains(p, lon, lat))
    ) {
      return { region: region.id, method: 'inside', distanceKm: 0 };
    }
  }
  let best: PointRegion | null = null;
  for (const region of regions) {
    const distanceKm = distanceToPolygonsKm(region.polygons, lon, lat);
    if (best === null || distanceKm < best.distanceKm) {
      best = { region: region.id, method: 'nearest', distanceKm };
    }
  }
  return best;
}

/**
 * Assign every point to a region (pure; the seven regions do not overlap, so the
 * first containing region is the only one).
 *
 * @param points - Forecast points
 * @param regions - The seven regions
 * @returns Region per {@link pointKey}
 */
export function assignPointRegions(
  points: readonly ForecastPoint[],
  regions: readonly ForecastRegion[]
): Map<string, PointRegion> {
  const out = new Map<string, PointRegion>();
  for (const point of points) {
    const assigned = assignRegion(regions, point.coordinates.lon, point.coordinates.lat);
    if (assigned) {
      out.set(pointKey(point.point_id, point.point_type_id), assigned);
    }
  }
  return out;
}

let memo: {
  set: ForecastRegionSet;
  points: readonly ForecastPoint[];
  byPoint: Map<string, PointRegion>;
} | null = null;

/**
 * Region of every forecast point, recomputed only when the region set or the
 * point list changes (a few hundred milliseconds for ~5800 points).
 *
 * @throws {Error} If the regions cannot be loaded at all
 */
export async function getPointRegions(): Promise<Map<string, PointRegion>> {
  const [set, points] = await Promise.all([getForecastRegions(), getForecastPoints()]);
  if (memo && memo.set === set && memo.points === points) {
    return memo.byPoint;
  }
  const started = Date.now();
  const byPoint = assignPointRegions(points, set.regions);
  const nearest = [...byPoint.values()].filter((r) => r.method === 'nearest').length;
  debugData(
    '[forecast-regions] Assigned %d points (%d by nearest boundary) in %dms',
    byPoint.size,
    nearest,
    Date.now() - started
  );
  memo = { set, points, byPoint };
  return byPoint;
}

/**
 * Region of one forecast point.
 *
 * @param pointId - `point_id` from the OGD point list
 * @param pointTypeId - `point_type_id` (1 station, 2 postal code centre, 3 point of interest)
 * @returns The region, or undefined for a point the point list does not hold
 */
export async function regionOf(
  pointId: number,
  pointTypeId: number
): Promise<PointRegion | undefined> {
  return (await getPointRegions()).get(pointKey(pointId, pointTypeId));
}

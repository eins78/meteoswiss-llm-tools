/**
 * The time window and the area filters of the weather-situation tool. Pure
 * functions: they check the caller's input and decide which points and hours
 * are counted.
 */

import { haversineDistance } from '../support/haversine.js';
import { ogdTimestampToMs, toOgdTimestamp } from '../support/zurich-time.js';

/** A window ends at most this many hours after its first hour. */
export const MAX_WINDOW_HOURS = 12;

/** Largest `near` radius in km. */
export const MAX_NEAR_RADIUS_KM = 150;

const HOUR_MS = 3_600_000;

/** The area filters as the tool takes them. */
export type AreaInput = {
  bbox?: readonly number[] | undefined;
  near?: { lat: number; lon: number; radius_km: number } | undefined;
  min_altitude_m?: number | undefined;
  max_altitude_m?: number | undefined;
};

/** The area filters, checked. Every field present must hold for a point to count. */
export type AreaFilter = {
  box?: { west: number; south: number; east: number; north: number };
  near?: { lat: number; lon: number; radiusKm: number };
  minAltitude?: number;
  maxAltitude?: number;
};

/** What a filter needs to know of a point. */
export type FilterPoint = { lat: number; lon: number; altitude: number };

/**
 * Check the area filters.
 *
 * @throws {RangeError} With a message for the caller
 */
export function parseAreaFilter(input: AreaInput): AreaFilter {
  const filter: AreaFilter = {};
  if (input.bbox !== undefined) {
    const [west, south, east, north] = input.bbox;
    if (
      input.bbox.length !== 4 ||
      west === undefined ||
      south === undefined ||
      east === undefined ||
      north === undefined
    ) {
      throw new RangeError('bbox: four numbers, [west, south, east, north] in degrees');
    }
    if (!(west < east && south < north)) {
      throw new RangeError('bbox: west must be less than east, and south less than north');
    }
    filter.box = { west, south, east, north };
  }
  if (input.near !== undefined) {
    const { lat, lon, radius_km } = input.near;
    if (!(radius_km > 0 && radius_km <= MAX_NEAR_RADIUS_KM)) {
      throw new RangeError(`near.radius_km: more than 0 and at most ${MAX_NEAR_RADIUS_KM}`);
    }
    filter.near = { lat, lon, radiusKm: radius_km };
  }
  const { min_altitude_m: min, max_altitude_m: max } = input;
  if (min !== undefined && max !== undefined && min > max) {
    throw new RangeError('min_altitude_m is above max_altitude_m');
  }
  if (min !== undefined) filter.minAltitude = min;
  if (max !== undefined) filter.maxAltitude = max;
  return filter;
}

/**
 * Whether a point passes all filters. Altitude limits are inclusive, the box
 * includes its edges, `near` is the air distance (haversine).
 */
export function inArea(filter: AreaFilter, point: FilterPoint): boolean {
  const { box, near, minAltitude, maxAltitude } = filter;
  if (minAltitude !== undefined && point.altitude < minAltitude) return false;
  if (maxAltitude !== undefined && point.altitude > maxAltitude) return false;
  if (
    box &&
    (point.lon < box.west || point.lon > box.east || point.lat < box.south || point.lat > box.north)
  ) {
    return false;
  }
  return !near || haversineDistance(near.lat, near.lon, point.lat, point.lon) <= near.radiusKm;
}

/**
 * The hours of a window as UTC OGD timestamps, from `fromTs` to `untilTs`, both included.
 *
 * @param fromTs - First hour, `YYYYMMDDhh00`
 * @param untilTs - Last hour; none for a single hour
 * @throws {RangeError} If the last hour is before the first or more than {@link MAX_WINDOW_HOURS} after it
 */
export function windowTimestamps(fromTs: string, untilTs?: string): string[] {
  if (untilTs === undefined) return [fromTs];
  const from = ogdTimestampToMs(fromTs);
  const hours = (ogdTimestampToMs(untilTs) - from) / HOUR_MS;
  if (hours < 0) throw new RangeError('until is before time');
  if (hours > MAX_WINDOW_HOURS) {
    throw new RangeError(`until is ${hours} h after time; at most ${MAX_WINDOW_HOURS} h`);
  }
  return Array.from({ length: hours + 1 }, (_, i) => toOgdTimestamp(from + i * HOUR_MS));
}

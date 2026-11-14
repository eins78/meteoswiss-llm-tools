/**
 * Station and location resolver for MeteoSwiss OGD data.
 * Resolves natural language queries (place names, postal codes, station abbreviations)
 * to specific forecast points or weather stations.
 */

import { getCollection } from './ogd-stac-client.js';
import { getLatin1CsvData } from './ogd-data-store.js';
import { parseNumeric } from '../support/ogd-csv-parser.js';
import { debugData } from '../support/logging.js';
import { OGD_COLLECTIONS } from '../schemas/ogd-shared.js';
import type { ForecastPoint } from '../schemas/ogd-shared.js';
import { normalize } from '../support/normalize.js';
import { scoreNameMatch, geocodedNameMatchesQuery } from '../support/name-matcher.js';
import { findNearest } from '../support/haversine.js';
import { geocodeSwissLocation, type GeocodeOrigin } from '../support/geocode.js';
import { classifyQuery } from '../support/query-classifier.js';
import { isBlocklisted } from '../support/location-blocklist.js';

/** Max distance (km) for geocoding fallback — forecast points are dense (~6000) */
const MAX_GEOCODE_DISTANCE_KM = 30;

/** Indexed forecast point data for fast lookups */
type ForecastIndex = {
  points: ForecastPoint[];
  byPostalCode: Map<string, ForecastPoint>;
  byAbbr: Map<string, ForecastPoint>;
};

let indexCache: ForecastIndex | null = null;

/**
 * Load forecast point metadata from the OGD STAC API and build lookup indexes.
 * Cached in memory after first load.
 */
async function loadForecastIndex(): Promise<ForecastIndex> {
  if (indexCache) {
    return indexCache;
  }

  debugData('[ogd-resolver] Loading forecast point metadata...');
  const collection = await getCollection(OGD_COLLECTIONS.LOCAL_FORECASTING);
  const metaAsset =
    collection.assets?.['ogd-local-forecasting_meta_point.csv'] ??
    collection.assets?.['ogd-local-forcasting_meta_point.csv']; // typo in official data

  if (!metaAsset) {
    throw new Error('Forecast point metadata asset not found in collection');
  }

  const rows = await getLatin1CsvData(metaAsset.href, 'metadata/forecast-points.csv', 'metadata');
  debugData('[ogd-resolver] Loaded %d forecast point rows', rows.length);

  const points: ForecastPoint[] = rows.map((row) => ({
    point_id: parseNumeric(row.point_id ?? null) ?? 0,
    point_type_id: parseNumeric(row.point_type_id ?? null) ?? 0,
    station_abbr: row.station_abbr ?? null,
    postal_code: row.postal_code ?? null,
    name: row.point_name ?? '',
    elevation: parseNumeric(row.point_height_masl ?? null) ?? 0,
    coordinates: {
      lat: parseNumeric(row.point_coordinates_wgs84_lat ?? null) ?? 0,
      lon: parseNumeric(row.point_coordinates_wgs84_lon ?? null) ?? 0,
    },
  }));

  const byPostalCode = new Map<string, ForecastPoint>();
  const byAbbr = new Map<string, ForecastPoint>();
  for (const p of points) {
    if (p.point_type_id === 2 && p.postal_code) {
      byPostalCode.set(p.postal_code.toLowerCase(), p);
    }
    if (p.point_type_id === 1 && p.station_abbr) {
      byAbbr.set(p.station_abbr.toLowerCase(), p);
    }
  }

  debugData('[ogd-resolver] Indexed %d postal codes, %d stations', byPostalCode.size, byAbbr.size);
  indexCache = { points, byPostalCode, byAbbr };
  return indexCache;
}

/**
 * All forecast points of the OGD local forecast (~5800 stations, postal code
 * centres and points of interest), loaded once and cached like the resolver's index.
 *
 * @returns The points; the same array on every call until the cache is cleared
 */
export async function getForecastPoints(): Promise<ForecastPoint[]> {
  return (await loadForecastIndex()).points;
}

/** Result of a station/location resolution */
export type ResolveResult = {
  match: ForecastPoint;
  alternatives: ForecastPoint[];
  confidence: 'exact' | 'fuzzy';
};

/**
 * Resolve a query string to a forecast point.
 * Matches against station abbreviations, postal codes, and place names.
 *
 * @param query - Station name, abbreviation, postal code, or place name
 * @returns Best match and alternatives
 */
export async function resolveForecastPoint(query: string): Promise<ResolveResult> {
  const { points, byPostalCode, byAbbr } = await loadForecastIndex();
  const q = normalize(query.trim());

  if (q === '') {
    throw new Error(
      'Location query must not be empty. Try a Swiss postal code (e.g., "8001"), ' +
        'station abbreviation (e.g., "SMA"), or place name (e.g., "Zurich").'
    );
  }

  // Reject well-known international city names before any lookup.
  if (isBlocklisted(query.trim())) {
    throw new Error(
      `"${query}" is a well-known international city name, not a Swiss location. ` +
        `Use a specific Swiss location instead (Swiss postal code, station abbreviation, or place name). ` +
        `Examples: "8001" for Zürich, "GVE" for Geneva. Use meteoswissStations to discover valid stations.`
    );
  }

  // O(1) exact match on postal code
  const postalMatch = byPostalCode.get(q);
  if (postalMatch) {
    return { match: postalMatch, alternatives: [], confidence: 'exact' };
  }

  // Postal-code prefix fallback: round-number parent codes like "1200"
  // (Geneva) and "3000" (Bern) are not in the MeteoSwiss grid metadata;
  // pick the numerically closest indexed neighbour with the same 3- or
  // 2-digit prefix before falling through to geocoding.
  const kind = classifyQuery(query.trim());
  if (kind === 'postal_code') {
    const prefixMatch = findPostalCodeNeighbour(q, byPostalCode);
    if (prefixMatch) {
      debugData(
        '[ogd-resolver] Postal code "%s" → prefix neighbour %s',
        q,
        prefixMatch.postal_code
      );
      return { match: prefixMatch, alternatives: [], confidence: 'fuzzy' };
    }
  }

  // O(1) exact match on station abbreviation
  const abbrMatch = byAbbr.get(q);
  if (abbrMatch) {
    return { match: abbrMatch, alternatives: [], confidence: 'exact' };
  }

  // Scored name match — word-boundary matches beat substring matches
  const scored = points
    .map((p) => ({ point: p, score: scoreNameMatch(q, normalize(p.name)) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      // Higher score first
      if (b.score !== a.score) return b.score - a.score;
      // Postal codes before stations for city names (at same score)
      if (a.point.point_type_id === 2 && b.point.point_type_id !== 2) return -1;
      if (b.point.point_type_id === 2 && a.point.point_type_id !== 2) return 1;
      // Shorter names preferred (more specific)
      return a.point.name.length - b.point.name.length;
    });

  if (scored.length > 0) {
    const best = scored[0]!;
    return {
      match: best.point,
      alternatives: scored.slice(1, 4).map((s) => s.point),
      confidence: best.score >= 50 ? 'exact' : 'fuzzy',
    };
  }

  // Geocoding fallback: resolve query to coordinates, find nearest forecast point.
  // Restrict swisstopo origins by query shape so non-Swiss queries ("Paris")
  // can't match Swiss street labels; widen to 'all' for address-shaped input.
  const geocodeOrigins: GeocodeOrigin = kind === 'address' ? 'all' : 'place';
  debugData(
    '[ogd-resolver] No direct match for "%s", geocoding (origins=%s)...',
    query,
    geocodeOrigins
  );
  const geocoded = await geocodeSwissLocation(query, { origins: geocodeOrigins });
  if (geocoded) {
    // Reject geocoding hits where the query bears no textual resemblance to the
    // geocoded place name. Prevents gibberish queries from returning random Swiss points.
    if (!geocodedNameMatchesQuery(query, geocoded.name)) {
      debugData(
        '[ogd-resolver] Geocoded name "%s" does not match query "%s" — rejected',
        geocoded.name,
        query
      );
    } else {
      // Prefer postal code points for geocoded locations
      const candidates = points.filter((p) => p.point_type_id === 2);
      const pool = candidates.length > 0 ? candidates : points;
      const result = findNearest(
        pool,
        (p) => p.coordinates.lat,
        (p) => p.coordinates.lon,
        geocoded.lat,
        geocoded.lon
      );
      if (result && result.distance_km <= MAX_GEOCODE_DISTANCE_KM) {
        debugData(
          '[ogd-resolver] Geocoded "%s" → %s, nearest point: %s (%.1f km)',
          query,
          geocoded.name,
          result.item.name,
          result.distance_km
        );
        return { match: result.item, alternatives: [], confidence: 'fuzzy' };
      }
      if (result) {
        debugData(
          '[ogd-resolver] Geocoded "%s" too far from nearest point: %.1f km (limit: %d km)',
          query,
          result.distance_km,
          MAX_GEOCODE_DISTANCE_KM
        );
      }
    }
  }

  throw new Error(
    `No forecast location found for "${query}". ` +
      `Try a Swiss postal code (e.g., "8001" for Zurich), station abbreviation ` +
      `(e.g., "BER", "SMA"), or place name (e.g., "Zurich", "Bern", "Lugano"). ` +
      `Use meteoswissStations to discover valid stations.`
  );
}

/**
 * Given a 4-digit postal code not present in the index, pick the numerically
 * closest postal code that shares the same 3- or 2-digit prefix. Returns null
 * when no same-prefix neighbour exists — falls through to geocoding.
 *
 * Swiss postal codes group regionally: 1200s → Geneva, 3000s → Bern, so the
 * same-prefix neighbour is almost always in the same city area.
 */
function findPostalCodeNeighbour(
  q: string,
  byPostalCode: Map<string, ForecastPoint>
): ForecastPoint | null {
  const target = Number(q);
  if (!Number.isFinite(target)) return null;

  for (const prefixLen of [3, 2]) {
    const prefix = q.slice(0, prefixLen);
    const candidates: { point: ForecastPoint; distance: number }[] = [];
    for (const [code, point] of byPostalCode.entries()) {
      if (!code.startsWith(prefix)) continue;
      const value = Number(code);
      if (!Number.isFinite(value)) continue;
      candidates.push({ point, distance: Math.abs(value - target) });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.distance - b.distance);
      return candidates[0]!.point;
    }
  }
  return null;
}

/**
 * Clear the in-memory forecast points cache. Useful for testing.
 */
export function clearResolverCache(): void {
  indexCache = null;
}

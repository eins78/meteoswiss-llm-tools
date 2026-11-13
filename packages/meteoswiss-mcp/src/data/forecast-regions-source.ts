/**
 * Where MeteoSwiss's forecast regions come from: the one place to change when
 * the source changes.
 *
 * MeteoSwiss does not publish its forecast regions as Open Data. Its website's
 * "Prognoseregionen" / "Forecast regions" map loads them as GeoJSON files under
 * `/static/resources/forecast-regions/`. Seven of those files split the country
 * with no overlap; the server uses only these seven, fetches each at most once
 * per {@link FORECAST_REGION_SOURCE.ttlMs} (default 30 days, the website's own
 * `max-age`) and credits "Source: MeteoSwiss". The files are never committed to
 * this repository. If MeteoSwiss publishes the regions as Open Data (STAC), point
 * this config at that source instead.
 */

import { envNumber, PINNED_CACHE_DIR } from './ogd-data-store.js';

/** Ids of the seven regions that split the country, in north-to-south order. */
export const FORECAST_REGION_IDS = [
  'jura',
  'mittelland',
  'alpennordhang',
  'wallis',
  'engadin',
  'nordundmittelbuenden',
  'alpensuedseite',
] as const;

/** Id of one of the seven forecast regions. */
export type ForecastRegionId = (typeof FORECAST_REGION_IDS)[number];

/** Region names as MeteoSwiss writes them (its English pages use the German names). */
export type ForecastRegionNames = { readonly de: string; readonly fr: string; readonly it: string };

const REGION_NAMES: Record<ForecastRegionId, ForecastRegionNames> = {
  jura: { de: 'Jura', fr: 'Jura', it: 'Giura' },
  mittelland: { de: 'Mittelland', fr: 'Moyen-Pays', it: 'Altopiano' },
  alpennordhang: { de: 'Alpennordhang', fr: 'Versant nord des Alpes', it: 'Versante nordalpino' },
  wallis: { de: 'Wallis', fr: 'Valais', it: 'Vallese' },
  engadin: { de: 'Engadin', fr: 'Engadine', it: 'Engadina' },
  nordundmittelbuenden: {
    de: 'Nord- und Mittelbünden',
    fr: 'Nord et Centre des Grisons',
    it: 'Nord e centro dei Grigioni',
  },
  alpensuedseite: { de: 'Alpensüdseite', fr: 'Sud des Alpes', it: 'Sud delle Alpi' },
};

/** The seven regions with their names, in the order of {@link FORECAST_REGION_IDS}. */
export const FORECAST_REGIONS: readonly { id: ForecastRegionId; names: ForecastRegionNames }[] =
  FORECAST_REGION_IDS.map((id) => ({ id, names: REGION_NAMES[id] }));

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Default base URL: the MeteoSwiss website's map resources. */
const DEFAULT_BASE_URL = 'https://www.meteoswiss.admin.ch/static/resources/forecast-regions/';

/**
 * Normalise a base URL so a file name can be appended.
 */
function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Source and cache settings for the forecast regions.
 *
 * - `baseUrl`: `FORECAST_REGIONS_BASE_URL` overrides it (a mirror, or a test server).
 * - `ttlMs`: `FORECAST_REGIONS_CACHE_TTL` (ms) overrides it; never below one hour,
 *   so a mistaken `0` cannot turn the cache into a fetch per call.
 * - `retryStaleMs`: after a failed refresh with an older copy at hand, how long
 *   that copy is served before the next attempt.
 * - `retryEmptyMs`: after a failed first load (no copy at all), how long calls
 *   fail fast before the next attempt.
 * - `cacheDir`: subdirectory of the OGD disk cache, inside the pinned area the
 *   cache prune never evicts (`PINNED_CACHE_DIR`).
 */
export const FORECAST_REGION_SOURCE = {
  baseUrl: withTrailingSlash(process.env.FORECAST_REGIONS_BASE_URL || DEFAULT_BASE_URL),
  ttlMs: Math.max(envNumber('FORECAST_REGIONS_CACHE_TTL', 30 * DAY_MS), HOUR_MS),
  retryStaleMs: HOUR_MS,
  retryEmptyMs: 5 * 60_000,
  cacheDir: `${PINNED_CACHE_DIR}/forecast-regions`,
  attribution: 'Source: MeteoSwiss',
} as const;

/**
 * Download URL of one region file.
 */
export function forecastRegionUrl(id: ForecastRegionId): string {
  return `${FORECAST_REGION_SOURCE.baseUrl}${id}.geojson`;
}

/**
 * Disk-cache key of one region file (relative to the OGD cache directory).
 */
export function forecastRegionCacheKey(id: ForecastRegionId): string {
  return `${FORECAST_REGION_SOURCE.cacheDir}/${id}.geojson`;
}

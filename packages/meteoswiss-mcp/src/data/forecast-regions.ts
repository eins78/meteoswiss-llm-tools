/**
 * MeteoSwiss's seven forecast regions as polygons, loaded lazily and cached for a
 * long time (see `forecast-regions-source.ts` for the source and its terms).
 *
 * States: a fresh set is served as is. A stale set triggers one refresh; if that
 * fails, the old set keeps being served (logged) and the next attempt waits
 * `retryStaleMs`. With no set at all a failed load throws, and calls fail fast
 * for `retryEmptyMs`. A refresh replaces the set only when all seven files parse
 * as polygons, so one bad or missing file never leaves a partial set.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fetchWithRetry } from '../support/http-communication.js';
import { debugData } from '../support/logging.js';
import { USE_TEST_FIXTURES, OGD_FIXTURES_ROOT } from '../support/test-fixtures.js';
import {
  bboxContains,
  bboxOf,
  parseGeoJsonPolygons,
  type BBox,
  type Polygon,
} from '../support/geo-polygons.js';
import { cacheWriteBestEffort, resolveCachePath } from './ogd-data-store.js';
import {
  FORECAST_REGIONS,
  FORECAST_REGION_SOURCE,
  forecastRegionCacheKey,
  forecastRegionUrl,
  type ForecastRegionId,
  type ForecastRegionNames,
} from './forecast-regions-source.js';

/** One region with its geometry. */
export type ForecastRegion = {
  id: ForecastRegionId;
  names: ForecastRegionNames;
  polygons: Polygon[];
  bbox: BBox;
};

/** The seven regions as one consistent set. */
export type ForecastRegionSet = {
  regions: ForecastRegion[];
  /** When the files were downloaded (ms since epoch; the oldest file for a disk copy). */
  fetchedAt: number;
};

/**
 * Plausible WGS84 extent of Swiss region files. A file outside it is rejected,
 * which catches a projected (LV95) or unrelated file before it replaces a good set.
 */
const SWISS_EXTENT: BBox = [5.0, 45.0, 11.5, 48.5];

/** Synthetic test geometry: never MeteoSwiss's files, which stay out of the repo. */
const FIXTURE_DIR = path.join(OGD_FIXTURES_ROOT, '..', 'forecast-regions');

let current: ForecastRegionSet | null = null;
let nextAttemptAt = 0;
let lastError: Error | null = null;
let inflight: Promise<ForecastRegionSet> | null = null;

/**
 * Parse and check the seven files into a region set.
 *
 * @param texts - GeoJSON text per region id
 * @param fetchedAt - Download time to record
 * @throws {Error} If a file is not JSON, holds no polygon or lies outside Switzerland
 */
export function buildForecastRegionSet(
  texts: ReadonlyMap<ForecastRegionId, string>,
  fetchedAt: number
): ForecastRegionSet {
  const regions = FORECAST_REGIONS.map(({ id, names }): ForecastRegion => {
    const text = texts.get(id);
    if (text === undefined) {
      throw new Error(`Forecast region "${id}": file missing`);
    }
    let polygons: Polygon[];
    try {
      polygons = parseGeoJsonPolygons(JSON.parse(text));
    } catch (error) {
      throw new Error(
        `Forecast region "${id}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    if (polygons.length === 0) {
      throw new Error(`Forecast region "${id}": no polygon in the file`);
    }
    const bbox = bboxOf(polygons);
    if (
      !bboxContains(SWISS_EXTENT, bbox[0], bbox[1]) ||
      !bboxContains(SWISS_EXTENT, bbox[2], bbox[3])
    ) {
      throw new Error(`Forecast region "${id}": coordinates outside Switzerland (not WGS84?)`);
    }
    return { id, names, polygons, bbox };
  });
  return { regions, fetchedAt };
}

/**
 * Read the seven cached files. Returns null if any is missing.
 */
async function readDiskCopy(): Promise<{
  texts: Map<ForecastRegionId, string>;
  fetchedAt: number;
} | null> {
  const texts = new Map<ForecastRegionId, string>();
  let oldest = Infinity;
  for (const { id } of FORECAST_REGIONS) {
    const file = resolveCachePath(forecastRegionCacheKey(id));
    try {
      const [stat, text] = await Promise.all([fs.stat(file), fs.readFile(file, 'utf-8')]);
      texts.set(id, text);
      oldest = Math.min(oldest, stat.mtimeMs);
    } catch {
      return null;
    }
  }
  return { texts, fetchedAt: oldest };
}

/**
 * Download the seven files and build a set; caches them only once all are valid.
 */
async function download(): Promise<ForecastRegionSet> {
  const texts = new Map<ForecastRegionId, string>();
  // allSettled, not all: a failed file must not leave the others retrying in the
  // background after the load has already given up.
  const results = await Promise.allSettled(
    FORECAST_REGIONS.map(async ({ id }) => {
      debugData('[forecast-regions] Downloading %s', forecastRegionUrl(id));
      const text = await fetchWithRetry(forecastRegionUrl(id), {
        useCache: false,
        retries: 1,
        timeout: 30_000,
        maxBytes: 5_000_000,
        headers: { Accept: 'application/geo+json, application/json' },
      });
      texts.set(id, text);
    })
  );
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }
  const set = buildForecastRegionSet(texts, Date.now());
  for (const [id, text] of texts) {
    const key = forecastRegionCacheKey(id);
    await cacheWriteBestEffort(resolveCachePath(key), text, key);
  }
  return set;
}

/**
 * Load from disk if fresh, else download; fall back to the last good set.
 */
async function refresh(): Promise<ForecastRegionSet> {
  const now = Date.now();
  const disk = await readDiskCopy();
  let diskSet: ForecastRegionSet | null = null;
  if (disk) {
    try {
      diskSet = buildForecastRegionSet(disk.texts, disk.fetchedAt);
    } catch (error) {
      console.error(
        '[forecast-regions] Cached region files are invalid, downloading again:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  if (diskSet && now - diskSet.fetchedAt < FORECAST_REGION_SOURCE.ttlMs) {
    debugData(
      '[forecast-regions] Using cached files from %s',
      new Date(diskSet.fetchedAt).toISOString()
    );
    return diskSet;
  }

  try {
    const set = await download();
    lastError = null;
    return set;
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
    const fallback = newer(current, diskSet);
    if (fallback) {
      nextAttemptAt = now + FORECAST_REGION_SOURCE.retryStaleMs;
      console.error(
        `[forecast-regions] Refresh failed, serving the copy from ${new Date(fallback.fetchedAt).toISOString()}:`,
        lastError.message
      );
      return fallback;
    }
    nextAttemptAt = now + FORECAST_REGION_SOURCE.retryEmptyMs;
    console.error('[forecast-regions] Could not load the forecast regions:', lastError.message);
    throw new Error(`MeteoSwiss forecast regions are unavailable: ${lastError.message}`, {
      cause: error,
    });
  }
}

/** The more recently fetched of two sets. */
function newer(a: ForecastRegionSet | null, b: ForecastRegionSet | null): ForecastRegionSet | null {
  if (!a) return b;
  if (!b) return a;
  return b.fetchedAt > a.fetchedAt ? b : a;
}

/**
 * Load the synthetic test regions (`test/__fixtures__/forecast-regions/`).
 *
 * @throws {Error} If a fixture file is missing — tests never fall through to the network
 */
async function loadFixtures(): Promise<ForecastRegionSet> {
  const texts = new Map<ForecastRegionId, string>();
  for (const { id } of FORECAST_REGIONS) {
    texts.set(id, await fs.readFile(path.join(FIXTURE_DIR, `${id}.geojson`), 'utf-8'));
  }
  return buildForecastRegionSet(texts, 0);
}

/**
 * The seven MeteoSwiss forecast regions with their polygons.
 *
 * The first call loads them (disk cache or download); later calls return the
 * same set until it is older than the TTL. Concurrent callers share one load.
 *
 * @returns The current region set (possibly stale if a refresh failed)
 * @throws {Error} If no set could be loaded at all
 */
export async function getForecastRegions(): Promise<ForecastRegionSet> {
  if (USE_TEST_FIXTURES) {
    current ??= await loadFixtures();
    return current;
  }
  const now = Date.now();
  if (current && now - current.fetchedAt < FORECAST_REGION_SOURCE.ttlMs) {
    return current;
  }
  if (now < nextAttemptAt) {
    if (current) return current;
    throw new Error(
      `MeteoSwiss forecast regions are unavailable: ${lastError?.message ?? 'load failed'}`
    );
  }
  inflight ??= refresh()
    .then((set) => {
      current = set;
      return set;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Forget the loaded set and any back-off (tests only).
 */
export function resetForecastRegions(): void {
  current = null;
  nextAttemptAt = 0;
  lastError = null;
  inflight = null;
}

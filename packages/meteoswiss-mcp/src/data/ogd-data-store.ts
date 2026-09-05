/**
 * Disk-based CSV cache for MeteoSwiss OGD data.
 * Downloads CSV files, caches them on disk with TTL-based refresh,
 * and returns parsed rows.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fetchWithRetry, fetchBinary } from '../support/http-communication.js';
import { parseCsv, type CsvRow } from '../support/ogd-csv-parser.js';
import { debugData } from '../support/logging.js';
import { USE_TEST_FIXTURES, OGD_FIXTURES_ROOT } from '../support/test-fixtures.js';

const LATIN1_DECODER = new TextDecoder('latin1');

/**
 * Map known URLs to fixture files for test mode.
 * Only the filename portion of the URL is matched against fixtures.
 */
function resolveFixturePath(url: string): string | null {
  if (!USE_TEST_FIXTURES) return null;

  // Map known URL patterns to fixture directories
  if (url.includes('VQHA80.csv')) return path.join(OGD_FIXTURES_ROOT, 'measurements', 'VQHA80.csv');

  // SMN-precip metadata and data (must come BEFORE SMN to avoid 'smn' substring match)
  if (url.includes('meta_stations.csv') && url.includes('smn-precip'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-smn-precip_meta_stations.csv');
  if (url.includes('ogd-smn-precip') && url.includes('_t_recent.csv'))
    return path.join(OGD_FIXTURES_ROOT, 'measurements', 'smn-precip-abe-t-recent.csv');

  // SMN (weather station) metadata
  if (url.includes('meta_stations.csv') && url.includes('smn'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-smn_meta_stations.csv');
  if (url.includes('meta_parameters.csv') && url.includes('smn'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-smn_meta_parameters.csv');

  // NBCN metadata and data (nbcn-precip must come BEFORE nbcn)
  if (url.includes('meta_stations.csv') && url.includes('nbcn-precip'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-nbcn-precip_meta_stations.csv');
  if (url.includes('meta_stations.csv') && url.includes('nbcn'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-nbcn_meta_stations.csv');
  if (url.includes('ogd-nbcn') && url.includes('_m.csv'))
    return path.join(OGD_FIXTURES_ROOT, 'climate', 'nbcn-bas-m.csv');
  if (url.includes('ogd-nbcn') && url.includes('_d_recent.csv'))
    return path.join(OGD_FIXTURES_ROOT, 'climate', 'nbcn-bas-d-recent.csv');

  // OBS (visual observations) data
  if (url.includes('ogd-obs') && url.includes('_d_recent.csv'))
    return path.join(OGD_FIXTURES_ROOT, 'observations', 'obs-sma-d-recent.csv');

  // Pollen metadata and data
  if (url.includes('meta_stations.csv') && url.includes('pollen'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-pollen_meta_stations.csv');
  if (url.includes('meta_parameters.csv') && url.includes('pollen'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-pollen_meta_parameters.csv');
  if (url.includes('ogd-pollen') && url.includes('_d_recent.csv'))
    return path.join(OGD_FIXTURES_ROOT, 'pollen', 'pzh-daily-recent.csv');

  // Forecast metadata
  if (url.includes('meta_point.csv'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-local-forecasting_meta_point.csv');
  if (url.includes('meta_parameters.csv') && url.includes('forecasting'))
    return path.join(OGD_FIXTURES_ROOT, 'metadata', 'ogd-local-forecasting_meta_parameters.csv');

  // Forecast CSVs: match by parameter name
  for (const param of [
    'tre200dx',
    'tre200dn',
    'rka150d0',
    'jp2000d0',
    'tre200h0',
    'rre150h0',
    'jww003i0',
    'sre000h0',
    'fu3010h0',
    'fu3010h1',
  ]) {
    if (url.includes(`.${param}.csv`))
      return path.join(OGD_FIXTURES_ROOT, 'forecasts', `${param}.csv`);
  }

  return null;
}

/**
 * Parse an env var as a number, returning the default if unset.
 * Respects explicit zero (unlike `Number(x) || default` which treats 0 as falsy).
 */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Cache TTLs in milliseconds */
export const CACHE_TTL = {
  realtime: envNumber('OGD_CACHE_TTL_REALTIME', 60_000),
  forecast: envNumber('OGD_CACHE_TTL_FORECAST', 3_600_000),
  metadata: envNumber('OGD_CACHE_TTL_METADATA', 86_400_000),
  climate: envNumber('OGD_CACHE_TTL_CLIMATE', 604_800_000),
} as const;

export type CacheTier = keyof typeof CACHE_TTL;

const CACHE_DIR = process.env.OGD_CACHE_DIR || path.join(os.tmpdir(), 'meteoswiss-ogd');

/** Total-bytes ceiling for the on-disk cache before LRU eviction kicks in. */
const CACHE_MAX_BYTES = envNumber('OGD_CACHE_MAX_BYTES', 268_435_456); // 256 MiB

/**
 * Resolve a cache key to an absolute path and assert it stays under CACHE_DIR.
 *
 * Cache keys are currently built from server-controlled STAC metadata and
 * validated enums (not raw user input), so this is defense-in-depth: it makes a
 * future `..`/absolute-path key a hard failure instead of a path traversal.
 *
 * @throws {Error} If the resolved path escapes CACHE_DIR
 */
export function resolveCachePath(cacheKey: string): string {
  const resolved = path.resolve(CACHE_DIR, cacheKey);
  const root = path.resolve(CACHE_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Unsafe cache key escapes cache directory: ${cacheKey}`);
  }
  return resolved;
}

/**
 * Write data to disk cache atomically (write to .tmp then rename).
 */
async function writeToDiskCache(cachePath: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(cachePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${cachePath}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, cachePath);
}

/**
 * Persist to the disk cache without ever failing the caller.
 *
 * The cache is an optimisation. By the time this runs the upstream fetch has
 * already succeeded and the data is in memory, about to be returned either way,
 * so a cache-layer fault must degrade to "slower next time" — never to a failed
 * tool call. Before this guard, a concurrent prune deleting the temp file turned
 * a completed download into `ENOENT: … rename` and took the whole request with
 * it, which is how a reachable forecast became a user-visible outage.
 *
 * Logged via `console.error` rather than `debugData` on purpose: a swallowed
 * error that nothing reports is how this stayed invisible, and `DEBUG` is not
 * set in production.
 *
 * @param cachePath - Absolute path the entry should be written to
 * @param data - Payload to persist
 * @param cacheKey - Human-readable key, for the log line only
 */
async function cacheWriteBestEffort(
  cachePath: string,
  data: string,
  cacheKey: string
): Promise<void> {
  try {
    await writeToDiskCache(cachePath, data);
    debugData('[ogd-store] Cached %d bytes to %s', data.length, cacheKey);
  } catch (error) {
    console.error(
      `[ogd-store] Cache write failed for ${cacheKey} (serving fetched data anyway):`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Recursively collect regular files under `dir` with their size and mtime.
 * Missing directory → empty list.
 */
async function listCacheFiles(
  dir: string
): Promise<Array<{ path: string; size: number; mtimeMs: number; isTmp: boolean }>> {
  const out: Array<{ path: string; size: number; mtimeMs: number; isTmp: boolean }> = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listCacheFiles(full)));
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(full);
        out.push({
          path: full,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          isTmp: entry.name.endsWith('.tmp'),
        });
      } catch {
        // file vanished between readdir and stat — ignore
      }
    }
  }
  return out;
}

/** Serializes prune passes so concurrent fetches don't double-evict. */
let prunePromise: Promise<void> | null = null;

/**
 * Bound the on-disk cache: delete orphaned `.tmp` files, then evict oldest
 * entries (LRU by mtime) until total size is under CACHE_MAX_BYTES. Best-effort
 * and never throws — a cache-maintenance failure must not fail a data request.
 */
async function pruneDiskCache(): Promise<void> {
  if (prunePromise) return prunePromise;
  prunePromise = (async () => {
    try {
      const files = await listCacheFiles(CACHE_DIR);
      let totalBytes = 0;
      const live: Array<{ path: string; size: number; mtimeMs: number }> = [];
      for (const file of files) {
        if (file.isTmp) {
          await fs.rm(file.path, { force: true });
          continue;
        }
        totalBytes += file.size;
        live.push(file);
      }
      if (totalBytes <= CACHE_MAX_BYTES) return;

      // Evict oldest-first until under the ceiling.
      live.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const file of live) {
        if (totalBytes <= CACHE_MAX_BYTES) break;
        await fs.rm(file.path, { force: true });
        totalBytes -= file.size;
        debugData('[ogd-store] Evicted cache file %s (%d bytes)', file.path, file.size);
      }
    } catch (error) {
      debugData('[ogd-store] Cache prune failed (non-fatal): %O', error);
    } finally {
      prunePromise = null;
    }
  })();
  return prunePromise;
}

/**
 * Read a cached file, decoding it as UTF-8 text.
 * Returns null if the cache entry is missing or stale.
 */
async function readCacheUtf8(cachePath: string, ttl: number): Promise<string | null> {
  try {
    const stat = await fs.stat(cachePath);
    const age = Date.now() - stat.mtimeMs;
    if (age < ttl) {
      return await fs.readFile(cachePath, 'utf-8');
    }
  } catch {
    // cache miss
  }
  return null;
}

/**
 * Get parsed CSV data, fetching as UTF-8 text (for CSVs served with proper charset).
 *
 * @param url - Direct download URL for the CSV file
 * @param cacheKey - Unique key for disk cache
 * @param tier - Cache TTL tier
 * @param filter - Optional row filter to reduce memory for large CSVs
 */
export async function getCsvData(
  url: string,
  cacheKey: string,
  tier: CacheTier,
  filter?: (row: CsvRow) => boolean
): Promise<CsvRow[]> {
  // Test fixture support — fail-fast if no fixture matches
  const fixturePath = resolveFixturePath(url);
  if (fixturePath) {
    debugData('[ogd-store] Using fixture: %s', fixturePath);
    const text = await fs.readFile(fixturePath, 'utf-8');
    return parseCsv(text, filter);
  }
  if (USE_TEST_FIXTURES) {
    throw new Error(`No test fixture for URL: ${url}. Add a mapping in resolveFixturePath.`);
  }

  const cachePath = resolveCachePath(cacheKey);
  const ttl = CACHE_TTL[tier];

  const cached = await readCacheUtf8(cachePath, ttl);
  if (cached !== null) {
    debugData('[ogd-store] Cache hit for %s', cacheKey);
    return parseCsv(cached, filter);
  }

  debugData('[ogd-store] Downloading %s', url);
  const text = await fetchWithRetry(url, { useCache: false, timeout: 60_000 });
  await cacheWriteBestEffort(cachePath, text, cacheKey);
  void pruneDiskCache();
  return parseCsv(text, filter);
}

/**
 * Get parsed CSV data, fetching as binary and decoding from Latin1.
 * MeteoSwiss metadata CSVs are served without charset header and are Latin1-encoded.
 *
 * @param url - Direct download URL for the CSV file
 * @param cacheKey - Unique key for disk cache
 * @param tier - Cache TTL tier
 * @param filter - Optional row filter
 */
export async function getLatin1CsvData(
  url: string,
  cacheKey: string,
  tier: CacheTier,
  filter?: (row: CsvRow) => boolean
): Promise<CsvRow[]> {
  // Test fixture support — fail-fast if no fixture matches
  const fixturePath = resolveFixturePath(url);
  if (fixturePath) {
    debugData('[ogd-store] Using fixture: %s', fixturePath);
    const text = await fs.readFile(fixturePath, 'utf-8');
    return parseCsv(text, filter);
  }
  if (USE_TEST_FIXTURES) {
    throw new Error(`No test fixture for URL: ${url}. Add a mapping in resolveFixturePath.`);
  }

  const cachePath = resolveCachePath(cacheKey);
  const ttl = CACHE_TTL[tier];

  // Cache stores the decoded UTF-8 text
  const cached = await readCacheUtf8(cachePath, ttl);
  if (cached !== null) {
    debugData('[ogd-store] Cache hit for %s', cacheKey);
    return parseCsv(cached, filter);
  }

  debugData('[ogd-store] Downloading (binary/Latin1) %s', url);
  const buffer = await fetchBinary(url, { timeout: 60_000 });
  const text = LATIN1_DECODER.decode(buffer);
  await cacheWriteBestEffort(cachePath, text, cacheKey);
  void pruneDiskCache();
  return parseCsv(text, filter);
}

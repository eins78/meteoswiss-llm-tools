/**
 * In-memory memo of *parsed* CSV data, keyed by disk-cache key and versioned by
 * the cache file's identity.
 *
 * The disk cache stores raw CSV text; without this memo every request re-parses
 * it (a forecast run is ~178 MB across six files). The memo holds a compact
 * derived form instead, so the parse happens once per cached file version.
 *
 * Contract:
 * - **Version-keyed**: an entry is a hit only when its `version` matches (callers
 *   pass `mtimeMs:size` of the disk-cache file). A mismatch replaces the entry, so
 *   the old parsed form is released when the file refreshes.
 * - **Single-flight**: concurrent callers for one key share one in-flight promise.
 * - **Never caches failures**: a rejected build is removed, the next caller retries.
 * - **Byte-bounded**: sizes are reported by the builder; least-recently-used entries
 *   are evicted past `OGD_PARSE_CACHE_MAX_BYTES`. A new forecast run is a new
 *   cache key, so the bound — not the version check — is what releases old runs.
 *   An entry larger than the whole bound is served but not retained.
 */

import { debugData } from '../support/logging.js';

/** What a builder returns: the derived value and its approximate retained size. */
export type MemoBuild<T> = { value: T; bytes: number };

type Entry = {
  version: string;
  promise: Promise<MemoBuild<unknown>>;
  /** 0 until the build resolves. */
  bytes: number;
  settled: boolean;
};

/** Parse an env var as a non-negative number, falling back when unset/invalid. */
function envBytes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Retained-bytes ceiling for parsed forms. `0` disables retention (single-flight still applies). */
const PARSE_CACHE_MAX_BYTES = envBytes('OGD_PARSE_CACHE_MAX_BYTES', 134_217_728); // 128 MiB

const entries = new Map<string, Entry>();

function totalBytes(): number {
  let sum = 0;
  for (const entry of entries.values()) sum += entry.bytes;
  return sum;
}

function evictToBound(protectedKey: string): void {
  let total = totalBytes();
  for (const [key, entry] of entries) {
    if (total <= PARSE_CACHE_MAX_BYTES) return;
    if (key === protectedKey || !entry.settled) continue;
    entries.delete(key);
    total -= entry.bytes;
    debugData('[ogd-memo] Evicted %s (%d bytes)', key, entry.bytes);
  }
}

/**
 * Return the memoised value for `key`/`version`, building it at most once across
 * concurrent callers.
 *
 * @param key - Disk-cache key
 * @param version - Identity of the source data; a different version forces a rebuild
 * @param build - Produces the derived value and its size in bytes
 * @returns The derived value
 */
export async function memoize<T>(
  key: string,
  version: string,
  build: () => Promise<MemoBuild<T>>
): Promise<T> {
  const existing = entries.get(key);
  if (existing && existing.version === version) {
    // Touch for LRU: Map iteration order is insertion order.
    entries.delete(key);
    entries.set(key, existing);
    return ((await existing.promise) as MemoBuild<T>).value;
  }

  const entry: Entry = {
    version,
    promise: Promise.resolve().then(build),
    bytes: 0,
    settled: false,
  };
  entries.set(key, entry); // replaces (and so releases) a stale-version entry

  try {
    const built = (await entry.promise) as MemoBuild<T>;
    entry.bytes = built.bytes;
    entry.settled = true;
    if (entries.get(key) === entry) {
      if (built.bytes > PARSE_CACHE_MAX_BYTES) {
        entries.delete(key);
      } else {
        evictToBound(key);
      }
    }
    return built.value;
  } catch (error) {
    if (entries.get(key) === entry) entries.delete(key);
    throw error;
  }
}

/** Drop one entry (e.g. when its backing file is gone). */
export function forgetMemo(key: string): void {
  entries.delete(key);
}

/** Current memo size, for tests and the benchmark. */
export function memoStats(): { entries: number; bytes: number } {
  return { entries: entries.size, bytes: totalBytes() };
}

/** Empty the memo. Test hook. */
export function clearMemo(): void {
  entries.clear();
}

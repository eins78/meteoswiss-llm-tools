/**
 * The forecast files the weather-situation tool reads: which run, loading them
 * through the shared forecast caches, and the error for an hour a run lacks.
 *
 * The hourly symbol `jww003i0` is required. The cloud cover files `nprolohs`,
 * `npromths` and `nprohihs` are optional: a failed one only turns the cloud
 * rule off, with a warning.
 */

import { resolveAssetUrl } from './ogd-stac-client.js';
import { getIndexedCsvData } from './ogd-data-store.js';
import type { ForecastIndex } from './ogd-forecast-index.js';
import { buildForecastIndexOffThread } from './ogd-forecast-pool.js';
import { zurichIso } from '../support/zurich-time.js';
import { logSafe } from '../support/log-safe.js';
import type { StacItem } from '../schemas/ogd-shared.js';

const SYMBOL_PARAM = 'jww003i0';

const CLOUD_PARAMS = [
  { param: 'nprolohs', label: 'low cloud cover' },
  { param: 'npromths', label: 'medium cloud cover' },
  { param: 'nprohihs', label: 'high cloud cover' },
] as const;

/** The asset keys of one forecast run. */
export type RunAssets = {
  /** Run time, UTC `YYYYMMDDhhmm` */
  run: string;
  symbolKey: string;
  /** Low, medium, high cloud cover; null if the item has no such file */
  cloudKeys: (string | null)[];
};

/** The loaded files of one run. */
export type RunFiles = {
  assets: RunAssets;
  symbols: ForecastIndex;
  /** Low, medium, high cloud cover; null where a file could not be loaded */
  clouds: (ForecastIndex | null)[];
  /** One line per cloud file that could not be loaded, plus what that means */
  warnings: string[];
};

/** Run timestamp → asset key of one parameter (keys like `vnut12.lssw.202603262300.jww003i0.csv`). */
function runsOf(item: StacItem, param: string): Map<string, string> {
  const out = new Map<string, string>();
  const suffix = `.${param}.csv`;
  for (const key of Object.keys(item.assets)) {
    if (!key.endsWith(suffix)) continue;
    const run = /\.(\d{12})\.[^.]+\.csv$/.exec(key)?.[1];
    if (run !== undefined) out.set(run, key);
  }
  return out;
}

/** The asset key of a parameter's newest run. */
function newestKey(runs: Map<string, string>): string | null {
  const newest = [...runs.keys()].sort().at(-1);
  return newest === undefined ? null : (runs.get(newest) ?? null);
}

/**
 * Pick the files to read: the newest run whose symbol file and all three cloud
 * files are uploaded, so symbol and cloud cover belong together. While a run is
 * still uploading, that is the run before it. If no run has all four, the newest
 * symbol file and each cloud file's newest run.
 *
 * @param item - Latest STAC item of the local forecast collection
 * @throws {Error} If the item holds no symbol file
 */
export function pickRunAssets(item: StacItem): RunAssets {
  const symbolRuns = runsOf(item, SYMBOL_PARAM);
  const cloudRuns = CLOUD_PARAMS.map(({ param }) => runsOf(item, param));
  const newestFirst = [...symbolRuns.keys()].sort().reverse();
  const run = newestFirst.find((r) => cloudRuns.every((m) => m.has(r))) ?? newestFirst[0];
  const symbolKey = run === undefined ? undefined : symbolRuns.get(run);
  if (run === undefined || symbolKey === undefined) {
    throw new Error(`No weather symbol file (${SYMBOL_PARAM}) in forecast item ${item.id}`);
  }
  return {
    run,
    symbolKey,
    cloudKeys: cloudRuns.map((m) => m.get(run) ?? newestKey(m)),
  };
}

/** Load one parameter file's index through the shared forecast caches. */
async function loadIndex(item: StacItem, assetKey: string, param: string): Promise<ForecastIndex> {
  return getIndexedCsvData(
    resolveAssetUrl(item, assetKey),
    `forecasts/${item.id}/${assetKey}`,
    'forecast',
    (data, reload) => buildForecastIndexOffThread(data, param, reload)
  );
}

/** Load one cloud cover file; a failure becomes a warning, not an error. */
async function loadCloud(
  item: StacItem,
  key: string | null,
  { param, label }: (typeof CLOUD_PARAMS)[number]
): Promise<{ index: ForecastIndex | null; warning: string | null }> {
  if (key === null)
    return { index: null, warning: `${param} (${label}): not in this forecast run` };
  try {
    return { index: await loadIndex(item, key, param), warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ogd-situation] ${param} download failed: ${logSafe(message)}`);
    return { index: null, warning: `${param} (${label}): download failed` };
  }
}

/**
 * Load the symbol file and the cloud cover files of the run {@link pickRunAssets} picks.
 *
 * @throws {Error} If the item holds no symbol file or the symbol file cannot be loaded
 */
export async function loadRunFiles(item: StacItem): Promise<RunFiles> {
  const assets = pickRunAssets(item);
  const [symbols, clouds] = await Promise.all([
    loadIndex(item, assets.symbolKey, SYMBOL_PARAM),
    Promise.all(
      CLOUD_PARAMS.map((cloud, i) => loadCloud(item, assets.cloudKeys[i] ?? null, cloud))
    ),
  ]);
  const warnings = clouds.map((c) => c.warning).filter((w): w is string => w !== null);
  if (warnings.length > 0) {
    warnings.push(
      'Without the cloud cover the cloud rule is off: fog_or_stratus counts only the fog and stratus symbols.'
    );
  }
  return { assets, symbols, clouds: clouds.map((c) => c.index), warnings };
}

/**
 * The error for an hour the run has no symbol for: outside the run, or between
 * the steps further ahead where the run has values only every few hours.
 *
 * @param index - The symbol file's index
 * @param ts - The hour asked for, UTC `YYYYMMDDhhmm`
 * @param time - The hour as the caller wrote it
 * @param run - The run, UTC `YYYYMMDDhhmm`
 */
export function hourNotInRun(index: ForecastIndex, ts: string, time: string, run: string): Error {
  const all = [...index.timestampTable].sort();
  const first = all[0];
  const last = all.at(-1);
  if (first === undefined || last === undefined) {
    return new Error(`The forecast run of ${zurichIso(run)} has no weather symbols`);
  }
  if (ts < first || ts > last) {
    return new Error(
      `${time} is outside the forecast run of ${zurichIso(run)}: it covers ${zurichIso(first)} to ${zurichIso(last)}`
    );
  }
  const before = all.filter((t) => t < ts).at(-1) ?? first;
  const after = all.find((t) => t > ts) ?? last;
  return new Error(
    `The forecast run of ${zurichIso(run)} has no symbol for ${time}: further ahead it has values every few hours; nearest ${zurichIso(before)} and ${zurichIso(after)}`
  );
}

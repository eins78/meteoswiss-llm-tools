/**
 * Data layer for the meteoswissWeatherSituation tool: the weather over all
 * ~5800 forecast points at one hour, counted per MeteoSwiss forecast region
 * and altitude band.
 *
 * It reads the same files as `meteoswissLocalForecast` with `detail: "sky"`
 * (the hourly symbol `jww003i0` and the cloud cover `nprolohs`, `npromths`,
 * `nprohihs`) through the same caches, so it adds no download of its own.
 * The symbol file is required; a cloud cover file that fails only turns the
 * cloud rule off, with a warning.
 */

import { getLatestItem, resolveAssetUrl } from './ogd-stac-client.js';
import { getIndexedCsvData } from './ogd-data-store.js';
import { forecastValueAt, timestampId, type ForecastIndex } from './ogd-forecast-index.js';
import { buildForecastIndexOffThread } from './ogd-forecast-pool.js';
import { getForecastPoints } from './ogd-station-resolver.js';
import { getPointRegions, pointKey } from './forecast-point-regions.js';
import { FORECAST_REGIONS, FORECAST_REGION_SOURCE } from './forecast-regions-source.js';
import { checkBandEdges, countSituation, type SituationSample } from './weather-situation-count.js';
import {
  CATEGORY_LEGEND,
  WEATHER_CATEGORIES,
  categorizeHour,
  type WeatherCategory,
} from '../support/weather-categories.js';
import { localHourToUtcTs, zurichIso } from '../support/zurich-time.js';
import { debugData } from '../support/logging.js';
import { logSafe } from '../support/log-safe.js';
import { OGD_COLLECTIONS, SOURCE_ATTRIBUTION, type StacItem } from '../schemas/ogd-shared.js';
import type {
  GetWeatherSituationParams,
  WeatherSituationResponse,
} from '../schemas/ogd-weather-situation.js';

const SYMBOL_PARAM = 'jww003i0';

const CLOUD_PARAMS = [
  { param: 'nprolohs', label: 'low cloud cover' },
  { param: 'npromths', label: 'medium cloud cover' },
  { param: 'nprohihs', label: 'high cloud cover' },
] as const;

const REGION_NAMES = new Map(FORECAST_REGIONS.map((r) => [r.id, r.names.de] as const));

/** The asset keys of one forecast run. */
export type RunAssets = {
  /** Run time, UTC `YYYYMMDDhhmm` */
  run: string;
  symbolKey: string;
  /** Per {@link CLOUD_PARAMS} entry; null if the item has no such file */
  cloudKeys: (string | null)[];
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

/** Load the cloud cover files; a failure becomes a warning, not an error. */
async function loadCloudIndexes(
  item: StacItem,
  keys: readonly (string | null)[]
): Promise<{ indexes: (ForecastIndex | null)[]; warnings: string[] }> {
  const results = await Promise.all(
    CLOUD_PARAMS.map(async ({ param, label }, i) => {
      const key = keys[i] ?? null;
      if (key === null)
        return { index: null, warning: `${param} (${label}): not in this forecast run` };
      try {
        return { index: await loadIndex(item, key, param), warning: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ogd-situation] ${param} download failed: ${logSafe(message)}`);
        return { index: null, warning: `${param} (${label}): download failed` };
      }
    })
  );
  const warnings = results.map((r) => r.warning).filter((w): w is string => w !== null);
  if (warnings.length > 0) {
    warnings.push(
      'Without the cloud cover the cloud rule is off: fog_or_stratus counts only the fog and stratus symbols.'
    );
  }
  return { indexes: results.map((r) => r.index), warnings };
}

/**
 * The error for an hour the run has no symbol for: outside the run, or between
 * the 3-hourly steps further ahead.
 */
function hourNotInRun(index: ForecastIndex, ts: string, time: string, run: string): Error {
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

/**
 * Count the weather of all forecast points at one hour per region and altitude band.
 *
 * @param params - Tool input (schema defaults applied)
 * @returns The tool's answer
 * @throws {RangeError} For a bad `time` or `bands`
 * @throws {Error} If the symbol file, the point list or the regions cannot be loaded,
 *   or the run has no symbol for the hour
 */
export async function getWeatherSituation(
  params: GetWeatherSituationParams
): Promise<WeatherSituationResponse> {
  const started = performance.now();
  checkBandEdges(params.bands);
  const ts = localHourToUtcTs(params.time);

  const [item, points, pointRegions] = await Promise.all([
    getLatestItem(OGD_COLLECTIONS.LOCAL_FORECASTING),
    getForecastPoints(),
    getPointRegions(),
  ]);
  const assets = pickRunAssets(item);
  const [symbols, clouds] = await Promise.all([
    loadIndex(item, assets.symbolKey, SYMBOL_PARAM),
    loadCloudIndexes(item, assets.cloudKeys),
  ]);

  const tsId = timestampId(symbols, ts);
  if (tsId < 0) throw hourNotInRun(symbols, ts, params.time, assets.run);
  const cloudTs = clouds.indexes.map((index) => (index ? timestampId(index, ts) : -1));
  const cloudAt = (i: number, key: string): number => {
    const index = clouds.indexes[i];
    return index ? forecastValueAt(index, key, cloudTs[i] ?? -1) : NaN;
  };

  const samples: SituationSample[] = [];
  const seen = new Set<string>();
  const present = new Set<WeatherCategory>();
  let missing = 0;
  for (const point of points) {
    const key = pointKey(point.point_id, point.point_type_id);
    if (seen.has(key)) continue; // a few stations are listed twice
    seen.add(key);
    const region = pointRegions.get(key);
    if (!region || (params.region !== undefined && region.region !== params.region)) continue;
    const category = categorizeHour(
      forecastValueAt(symbols, key, tsId),
      cloudAt(0, key),
      cloudAt(1, key),
      cloudAt(2, key)
    );
    if (category === null) {
      missing++;
      continue;
    }
    present.add(category);
    samples.push({ point: key, region: region.region, altitude: point.elevation, category });
  }

  const regions = countSituation(samples, params.bands).map((r) => ({
    id: r.id,
    name: REGION_NAMES.get(r.id) ?? r.id,
    points: r.points,
    dominant: r.dominant,
    bands: r.bands,
  }));
  const legend: Partial<Record<WeatherCategory, string>> = {};
  for (const category of WEATHER_CATEGORIES) {
    if (present.has(category)) legend[category] = CATEGORY_LEGEND[category];
  }
  debugData(
    '[ogd-situation] %s: %d points, %d missing, %d ms',
    ts,
    samples.length,
    missing,
    Math.round(performance.now() - started)
  );

  return {
    valid: { from: zurichIso(ts), hours: 1 },
    run: zurichIso(assets.run),
    points: samples.length,
    ...(missing > 0 ? { missing } : {}),
    regions,
    legend,
    ...(clouds.warnings.length > 0 ? { warnings: clouds.warnings } : {}),
    source: `${SOURCE_ATTRIBUTION}; forecast regions: ${FORECAST_REGION_SOURCE.attribution}`,
  };
}

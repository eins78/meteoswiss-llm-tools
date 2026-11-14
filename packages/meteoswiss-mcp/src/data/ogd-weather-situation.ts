/**
 * Data layer for the meteoswissWeatherSituation tool: the weather over all
 * ~5800 forecast points at one hour or over a window of up to 12 hours,
 * counted per MeteoSwiss forecast region and altitude band.
 *
 * It reads the same files as `meteoswissLocalForecast` with `detail: "sky"`
 * (see `weather-situation-run.ts`) through the same caches, so it adds no
 * download of its own.
 */

import { getLatestItem } from './ogd-stac-client.js';
import { forecastValuesAt, timestampId, timestampSlots } from './ogd-forecast-index.js';
import { getForecastPoints } from './ogd-station-resolver.js';
import { getPointRegions, pointKey } from './forecast-point-regions.js';
import { FORECAST_REGIONS, FORECAST_REGION_SOURCE } from './forecast-regions-source.js';
import { checkBandEdges, countSituation, type SituationSample } from './weather-situation-count.js';
import { inArea, parseAreaFilter, windowTimestamps } from './weather-situation-filters.js';
import { hourNotInRun, loadRunFiles, type RunFiles } from './weather-situation-run.js';
import { FOG_TOP_REGIONS, fogTop } from './weather-situation-fog.js';
import { buildGrid, type GridSample } from './weather-situation-grid.js';
import { wgs84ToLv95 } from '../support/swiss-coordinates.js';
import {
  CATEGORY_LEGEND,
  WEATHER_CATEGORIES,
  categorizeHour,
  type WeatherCategory,
} from '../support/weather-categories.js';
import { localHourToUtcTs, zurichIso } from '../support/zurich-time.js';
import { debugData } from '../support/logging.js';
import { OGD_COLLECTIONS, SOURCE_ATTRIBUTION } from '../schemas/ogd-shared.js';
import type {
  GetWeatherSituationParams,
  WeatherSituationResponse,
} from '../schemas/ogd-weather-situation.js';

const REGION_NAMES = new Map(FORECAST_REGIONS.map((r) => [r.id, r.names.de] as const));

/** Reads one point's symbol and cloud cover at each counted hour. */
type HourReader = (key: string) => {
  codes: Float64Array;
  low: Float64Array | null;
  mid: Float64Array | null;
  high: Float64Array | null;
};

/** The fog top fields of a northern region (experimental, see `weather-situation-fog.ts`). */
function fogFields(samples: readonly SituationSample[]): {
  fog_top_m: number | null;
  sunny_above_fog_pct: number | null;
  fog_top_points: number | null;
} {
  const fog = fogTop(samples);
  return {
    fog_top_m: fog?.topM ?? null,
    sunny_above_fog_pct: fog?.clearAbovePct ?? null,
    fog_top_points: fog?.points ?? null,
  };
}

/** Build a reader for the counted hours of a run. */
function hourReader(files: RunFiles, hours: readonly string[]): HourReader {
  const symbolSlots = timestampSlots(files.symbols, hours);
  const clouds = files.clouds.map((index) =>
    index ? { index, slots: timestampSlots(index, hours) } : null
  );
  const cloud = (i: number, key: string): Float64Array | null => {
    const c = clouds[i];
    return c ? forecastValuesAt(c.index, key, c.slots) : null;
  };
  return (key) => ({
    codes: forecastValuesAt(files.symbols, key, symbolSlots),
    low: cloud(0, key),
    mid: cloud(1, key),
    high: cloud(2, key),
  });
}

/**
 * Count the weather of the forecast points per region and altitude band, at one
 * hour or over a window.
 *
 * @param params - Tool input (schema defaults applied; `map` may be left out, as "none")
 * @returns The tool's answer
 * @throws {RangeError} For a bad `time`, `until`, `bands` or area filter
 * @throws {Error} If the symbol file, the point list or the regions cannot be loaded,
 *   or the run has no symbol for any hour asked for
 */
export async function getWeatherSituation(
  params: Omit<GetWeatherSituationParams, 'map'> & { map?: GetWeatherSituationParams['map'] }
): Promise<WeatherSituationResponse> {
  const started = performance.now();
  checkBandEdges(params.bands);
  const area = parseAreaFilter(params);
  const fromTs = localHourToUtcTs(params.time);
  const untilTs = params.until === undefined ? undefined : localHourToUtcTs(params.until);
  const wanted = windowTimestamps(fromTs, untilTs);

  const [item, points, pointRegions] = await Promise.all([
    getLatestItem(OGD_COLLECTIONS.LOCAL_FORECASTING),
    getForecastPoints(),
    getPointRegions(),
  ]);
  const files = await loadRunFiles(item);
  const hours = wanted.filter((ts) => timestampId(files.symbols, ts) >= 0);
  if (hours.length === 0) throw hourNotInRun(files.symbols, fromTs, params.time, files.assets.run);
  const warnings = [...files.warnings];
  if (hours.length < wanted.length) {
    warnings.push(
      `The forecast run has symbols for ${hours.length} of the ${wanted.length} hours asked for (further ahead it has values only every few hours); the counts use those ${hours.length}.`
    );
  }
  const read = hourReader(files, hours);

  const samples: SituationSample[] = [];
  const gridSamples: GridSample[] | null = params.map === 'grid' ? [] : null;
  const seen = new Set<string>();
  const present = new Set<WeatherCategory>();
  let counted = 0;
  let missing = 0;
  for (const point of points) {
    const key = pointKey(point.point_id, point.point_type_id);
    if (seen.has(key)) continue; // a few stations are listed twice
    seen.add(key);
    const region = pointRegions.get(key);
    if (!region || (params.region !== undefined && region.region !== params.region)) continue;
    const { lat, lon } = point.coordinates;
    if (!inArea(area, { lat, lon, altitude: point.elevation })) continue;
    const { codes, low, mid, high } = read(key);
    const lv95 = gridSamples ? wgs84ToLv95(lat, lon) : null;
    let any = false;
    for (let h = 0; h < hours.length; h++) {
      const category = categorizeHour(
        codes[h] ?? NaN,
        low?.[h] ?? NaN,
        mid?.[h] ?? NaN,
        high?.[h] ?? NaN
      );
      if (category === null) {
        missing++;
        continue;
      }
      any = true;
      present.add(category);
      samples.push({ point: key, region: region.region, altitude: point.elevation, category });
      if (gridSamples && lv95) gridSamples.push({ ...lv95, category });
    }
    if (any) counted++;
  }

  const regions = countSituation(samples, params.bands).map((r) => ({
    id: r.id,
    name: REGION_NAMES.get(r.id) ?? r.id,
    points: r.points,
    dominant: r.dominant,
    bands: r.bands,
    ...(FOG_TOP_REGIONS.includes(r.id) ? fogFields(samples.filter((s) => s.region === r.id)) : {}),
  }));
  const legend: Partial<Record<WeatherCategory, string>> = {};
  for (const category of WEATHER_CATEGORIES) {
    if (present.has(category)) legend[category] = CATEGORY_LEGEND[category];
  }
  debugData(
    '[ogd-situation] %s +%dh: %d points, %d point-hours missing, %d ms',
    fromTs,
    hours.length,
    counted,
    missing,
    Math.round(performance.now() - started)
  );

  const last = wanted.at(-1);
  const grid = gridSamples ? buildGrid(gridSamples) : null;
  return {
    valid: {
      from: zurichIso(fromTs),
      ...(untilTs !== undefined && last !== undefined ? { until: zurichIso(last) } : {}),
      hours: hours.length,
    },
    run: zurichIso(files.assets.run),
    points: counted,
    ...(missing > 0 ? { missing } : {}),
    regions,
    legend,
    ...(grid ? { grid } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    source: `${SOURCE_ATTRIBUTION}; forecast regions: ${FORECAST_REGION_SOURCE.attribution}`,
  };
}

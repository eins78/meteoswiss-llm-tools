/**
 * Data layer for the getLocalForecast tool.
 * Fetches forecast CSVs from MeteoSwiss OGD, filters by location, and aggregates into daily summaries.
 *
 * Daily parameters (tre200dx, tre200dn, rka150d0, jp2000d0) are MeteoSwiss's own official daily
 * aggregates, only published for stations (point_type_id=1). Every point type also has hourly
 * parameters (tre200h0 etc.) — postal codes/mountain points aggregate these to daily summaries
 * (see `buildHourlyAggregatedForecast`); stations fetch BOTH: the official daily aggregates
 * (used for `temperature_min_c`/`temperature_max_c`/`precipitation_total_mm` — a different,
 * MeteoSwiss-curated product that may not exactly equal re-summing the hourly series) AND the
 * hourly series (used for `hourly[]` and for the two series with no daily-aggregate product,
 * sunshine/wind — see `buildStationForecast`).
 */

import { getLatestItem, resolveAssetUrl } from './ogd-stac-client.js';
import { getIndexedCsvData } from './ogd-data-store.js';
import { buildForecastIndex, lookupForecastSeries } from './ogd-forecast-index.js';
import { roundByUnit, roundNullable } from '../support/round-measurements.js';
import { resolveForecastPoint } from './ogd-station-resolver.js';
import { debugData } from '../support/logging.js';
import { OGD_COLLECTIONS, pointTypeFromId, SOURCE_ATTRIBUTION } from '../schemas/ogd-shared.js';
import { weatherIconDescription, weatherIconUrl } from '../support/weather-icons.js';
import type {
  GetLocalForecastParams,
  LocalForecastResponse,
  DailyForecast,
  HourlyEntry,
} from '../schemas/ogd-local-forecast.js';
import type { StacItem } from '../schemas/ogd-shared.js';

/** Official daily aggregates — only available for stations (point_type_id=1) */
const DAILY_PARAMS = ['tre200dx', 'tre200dn', 'rka150d0', 'jp2000d0'] as const;

/** Hourly series params — available for all point types. jww003i0 (weather pictogram) is
 * 3-hourly and used only for daily icon selection (`pickDaytimeIcon`), not exposed per-hour. */
const HOURLY_PARAMS = [
  'tre200h0',
  'rre150h0',
  'jww003i0',
  'sre000h0',
  'fu3010h0',
  'fu3010h1',
] as const;

/** Maps each exposed hourly series to its OGD param code, for `groupUnifiedHourlyByDate`. */
const HOURLY_SERIES_PARAM = {
  temperature: 'tre200h0',
  precipitation: 'rre150h0',
  sunshine: 'sre000h0',
  wind: 'fu3010h0',
  windGust: 'fu3010h1',
} as const;

/**
 * Find the latest asset key for a parameter (picks the most recent forecast run).
 */
function findLatestAssetKey(item: StacItem, param: string): string | null {
  const suffix = `.${param}.csv`;
  const keys = Object.keys(item.assets)
    .filter((k) => k.endsWith(suffix))
    .sort();
  return keys.length > 0 ? keys[keys.length - 1]! : null;
}

/**
 * Convert a MeteoSwiss timestamp (YYYYMMDDhhmm) to a date string (YYYY-MM-DD).
 */
function timestampToDate(ts: string): string {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

/**
 * Formatter that renders a UTC instant as local Europe/Zurich wall-clock time
 * plus its UTC offset (DST-aware). Reused across calls since constructing an
 * `Intl.DateTimeFormat` repeatedly is comparatively expensive.
 */
const zurichFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

/**
 * Render a UTC timestamp's local Europe/Zurich date and wall-clock time, DST-correct.
 */
function zurichParts(ts: string): { date: string; time: string; offset: string } {
  const utcMs = Date.UTC(
    Number(ts.slice(0, 4)),
    Number(ts.slice(4, 6)) - 1,
    Number(ts.slice(6, 8)),
    Number(ts.slice(8, 10)),
    Number(ts.slice(10, 12))
  );
  const parts = zurichFormatter.formatToParts(new Date(utcMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
    offset: get('timeZoneName').replace('GMT', ''),
  };
}

/**
 * Convert a MeteoSwiss UTC timestamp (YYYYMMDDhhmm) to its local Europe/Zurich
 * calendar date (YYYY-MM-DD), DST-correct. Used to bucket hourly readings into
 * days that match the local wall-clock times we surface, so a day's `hourly`
 * entries never spill across the local midnight boundary into a neighboring day.
 */
function utcTimestampToZurichDate(ts: string): string {
  return zurichParts(ts).date;
}

/**
 * Get today's date in YYYY-MM-DD format as the **Europe/Zurich** local calendar
 * date. Forecast days are bucketed by Zurich-local date (see
 * {@link utcTimestampToZurichDate}); comparing them against a UTC "today" dropped
 * the wrong day every night between local midnight and 01:00/02:00 UTC-offset
 * (FUN-2). In test fixture mode, returns a far-past date so no fixture day is
 * filtered out.
 */
function todayZurich(): string {
  if (process.env.USE_TEST_FIXTURES === 'true') {
    // Don't filter dates in test mode — fixture dates are static
    return '1900-01-01';
  }
  const parts = zurichFormatter.formatToParts(new Date());
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Group every hourly series (temperature, precipitation, sunshine, wind, wind gust) into one
 * unified per-hour object per timestamp — "Shape B" (see
 * packages/meteoswiss-forecast-evals/docs/results/2026-07-09-forecast-json-comprehension.md and
 * packages/meteoswiss-forecast-evals/docs/results/2026-07-11-hourly-multiseries-shape-refinement.md
 * for why this shape, and the wind-gust field specifically, were chosen over parallel
 * per-parameter arrays / speed-only wind).
 * Bucketed by local Europe/Zurich date (not raw UTC) — the same day boundary used everywhere
 * else — so a day's entries never spill across local midnight into a neighboring day.
 *
 * An hour is included whenever AT LEAST ONE series has a reading for it; each field is
 * independently `null` if that specific series has no reading for that hour (a genuine data
 * gap in just one series, not the whole hour). Entries within a day are chronological.
 */
function groupUnifiedHourlyByDate(
  paramData: Map<string, Map<string, number | null>>
): Map<string, HourlyEntry[]> {
  const empty = new Map<string, number | null>();
  const tempMap = paramData.get(HOURLY_SERIES_PARAM.temperature) ?? empty;
  const precipMap = paramData.get(HOURLY_SERIES_PARAM.precipitation) ?? empty;
  const sunshineMap = paramData.get(HOURLY_SERIES_PARAM.sunshine) ?? empty;
  const windMap = paramData.get(HOURLY_SERIES_PARAM.wind) ?? empty;
  const gustMap = paramData.get(HOURLY_SERIES_PARAM.windGust) ?? empty;

  const allTimestamps = new Set([
    ...tempMap.keys(),
    ...precipMap.keys(),
    ...sunshineMap.keys(),
    ...windMap.keys(),
    ...gustMap.keys(),
  ]);

  const byDate = new Map<string, HourlyEntry[]>();
  for (const ts of [...allTimestamps].sort()) {
    const temperature_c = roundNullable(tempMap.get(ts) ?? null, '°C');
    const precip_mm = roundNullable(precipMap.get(ts) ?? null, 'mm');
    const sunshine_minutes = roundNullable(sunshineMap.get(ts) ?? null, 'min');
    const wind_kmh = roundNullable(windMap.get(ts) ?? null, 'km/h');
    const wind_gust_kmh = roundNullable(gustMap.get(ts) ?? null, 'km/h');
    if (
      temperature_c === null &&
      precip_mm === null &&
      sunshine_minutes === null &&
      wind_kmh === null &&
      wind_gust_kmh === null
    ) {
      continue;
    }

    const { date, time, offset } = zurichParts(ts);
    const entry: HourlyEntry = {
      time: `${date}T${time}${offset}`,
      temperature_c,
      precip_mm,
      sunshine_minutes,
      wind_kmh,
      wind_gust_kmh,
    };
    const existing = byDate.get(date) ?? [];
    existing.push(entry);
    byDate.set(date, existing);
  }
  return byDate;
}

/**
 * Derive a day's summary fields from its own `hourly[]` entries — sums/min/max/avg of the
 * SAME (already-rounded) values shown in the series, so a summary can never disagree with the
 * hourly breakdown it's derived from (the discipline established for precipitation in #99,
 * extended here to every series). Used directly for postal codes/mountain points (every field);
 * used for stations only where no official daily aggregate exists (sunshine, wind — see
 * `buildStationForecast`, which keeps MeteoSwiss's own daily temperature/precipitation product
 * instead of this derivation for those two fields).
 */
function summarizeHourlyEntries(entries: HourlyEntry[]): {
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  precipitationTotalMm: number | null;
  sunshineTotalMinutes: number | null;
  windAvgKmh: number | null;
  windGustMaxKmh: number | null;
} {
  const isNumber = (v: number | null): v is number => v !== null;
  const temps = entries.map((e) => e.temperature_c).filter(isNumber);
  const precips = entries.map((e) => e.precip_mm).filter(isNumber);
  const sunshines = entries.map((e) => e.sunshine_minutes).filter(isNumber);
  const winds = entries.map((e) => e.wind_kmh).filter(isNumber);
  const gusts = entries.map((e) => e.wind_gust_kmh).filter(isNumber);
  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

  return {
    temperatureMinC: temps.length > 0 ? roundByUnit(Math.min(...temps), '°C') : null,
    temperatureMaxC: temps.length > 0 ? roundByUnit(Math.max(...temps), '°C') : null,
    precipitationTotalMm: precips.length > 0 ? roundByUnit(sum(precips), 'mm') : null,
    sunshineTotalMinutes: sunshines.length > 0 ? roundByUnit(sum(sunshines), 'min') : null,
    windAvgKmh: winds.length > 0 ? roundByUnit(sum(winds) / winds.length, 'km/h') : null,
    windGustMaxKmh: gusts.length > 0 ? roundByUnit(Math.max(...gusts), 'km/h') : null,
  };
}

/**
 * Build a daily forecast from station data. Stations get MeteoSwiss's official daily
 * aggregates for temperature/precipitation (a distinct, curated product — see the file header)
 * plus a real `hourly[]` breakdown and hourly-derived sunshine/wind summaries (no official
 * daily aggregate exists for those two series).
 */
function buildStationForecast(
  paramData: Map<string, Map<string, number | null>>,
  days: number
): DailyForecast[] {
  const today = todayZurich();

  const dateKeyed = new Map(
    [...paramData.entries()].map(([param, tsMap]) => [
      param,
      new Map([...tsMap.entries()].map(([ts, val]) => [timestampToDate(ts), val])),
    ])
  );

  const hourlyByDate = groupUnifiedHourlyByDate(paramData);
  // Distinguishes "no hourly breakdown exists for this point at all" (null — e.g. a station
  // whose forecast run genuinely has none of the hourly series, the way some observation
  // stations only report a subset of parameters) from "this point supports hourly data but
  // none was available for this specific day" ([] per day, handled below).
  const hourlyTrulyUnavailable = hourlyByDate.size === 0;

  // Date set = union of EVERY official daily-aggregate's dates AND the hourly days,
  // not just tre200dx's. Deriving from tre200dx alone returned an empty forecast
  // when that single asset was missing even though hourly data was in hand (FUN-6);
  // this mirrors the union the hourly-aggregated path already uses.
  const dailyDates = DAILY_PARAMS.flatMap((param) => [...(dateKeyed.get(param)?.keys() ?? [])]);
  const dates = [...new Set([...dailyDates, ...hourlyByDate.keys()])]
    .sort()
    .filter((d) => d >= today)
    .slice(0, days);

  return dates.map((date) => {
    const iconCode = dateKeyed.get('jp2000d0')?.get(date) ?? null;
    const hourly = hourlyTrulyUnavailable ? null : (hourlyByDate.get(date) ?? []);
    const hourlySummary = summarizeHourlyEntries(hourly ?? []);
    return {
      date,
      weather: iconCode !== null ? weatherIconDescription(iconCode) : null,
      weather_icon_url: iconCode !== null ? weatherIconUrl(iconCode) : null,
      // Official MeteoSwiss daily aggregates — kept even though `hourly` is now populated:
      // this is a different, MeteoSwiss-curated product that may not exactly equal
      // re-summing the hourly series shown alongside it (Max's ruling; see file header).
      temperature_min_c: roundNullable(dateKeyed.get('tre200dn')?.get(date) ?? null, '°C'),
      temperature_max_c: roundNullable(dateKeyed.get('tre200dx')?.get(date) ?? null, '°C'),
      precipitation_total_mm: roundNullable(dateKeyed.get('rka150d0')?.get(date) ?? null, 'mm'),
      // No official daily aggregate exists for these two series — derive from the hourly data.
      sunshine_total_minutes: hourlySummary.sunshineTotalMinutes,
      wind_avg_kmh: hourlySummary.windAvgKmh,
      wind_gust_max_kmh: hourlySummary.windGustMaxKmh,
      hourly,
    };
  });
}

/**
 * Pick the most representative weather icon for a day.
 * `date` is a local Europe/Zurich calendar date (see `utcTimestampToZurichDate`).
 * Prefers midday hours (09-15 local, ~07-13 UTC) for daytime representation.
 * Falls back to the most frequent icon code if no midday data.
 */
function pickDaytimeIcon(entries: Map<string, number | null>, date: string): number | null {
  const dayEntries: Array<{ hour: number; code: number }> = [];
  for (const [ts, val] of entries.entries()) {
    if (val === null) continue;
    if (utcTimestampToZurichDate(ts) !== date) continue;
    const hour = Number(ts.slice(8, 10));
    dayEntries.push({ hour, code: val });
  }
  if (dayEntries.length === 0) return null;

  // Prefer midday hours (07-13 UTC ≈ 09-15 CET)
  const midday = dayEntries.filter((e) => e.hour >= 7 && e.hour <= 13);
  if (midday.length > 0) {
    // Pick the icon closest to noon UTC (11)
    midday.sort((a, b) => Math.abs(a.hour - 11) - Math.abs(b.hour - 11));
    return midday[0]!.code;
  }

  // Fallback: most frequent icon
  const counts = new Map<number, number>();
  for (const e of dayEntries) {
    counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
  }
  let best = dayEntries[0]!.code;
  let bestCount = 0;
  for (const [code, count] of counts.entries()) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Build a daily forecast from hourly data: every summary field is derived from the same
 * `hourly[]` series it's shown alongside (see `summarizeHourlyEntries`), so they cannot
 * disagree with each other. Icon selection stays separate (`jww003i0` is 3-hourly and only
 * ever used for daily icon selection, never exposed per-hour).
 */
function buildHourlyAggregatedForecast(
  paramData: Map<string, Map<string, number | null>>,
  days: number
): DailyForecast[] {
  const hourlyIcon = paramData.get('jww003i0') ?? new Map<string, number | null>();
  const hourlyByDate = groupUnifiedHourlyByDate(paramData);
  // Distinguishes "no hourly breakdown exists for this location at all" (null — every one of
  // the 5 hourly series came back empty across every timestamp, not just for one day) from
  // "this location supports hourly data but a specific day has none" ([] per day, handled
  // below) — the same distinction `buildStationForecast` already makes for stations.
  const hourlyTrulyUnavailable = hourlyByDate.size === 0;

  // The date set is the union of days with hourly-series data AND days with icon data (icon is
  // fetched independently, 3-hourly), NOT just `hourlyByDate.keys()` alone — a day where every
  // one of the 5 hourly series is a total gap (but the icon still reported) would otherwise be
  // dropped from `forecast[]` entirely instead of appearing with `hourly: []`, silently hiding
  // a day the forecast run does cover.
  const iconDates = new Set([...hourlyIcon.keys()].map(utcTimestampToZurichDate));
  const today = todayZurich();
  const dates = [...new Set([...hourlyByDate.keys(), ...iconDates])]
    .sort()
    .filter((d) => d >= today)
    .slice(0, days);

  return dates.map((date) => {
    const hourly = hourlyTrulyUnavailable ? null : (hourlyByDate.get(date) ?? []);
    const summary = summarizeHourlyEntries(hourly ?? []);
    const iconCode = pickDaytimeIcon(hourlyIcon, date);

    return {
      date,
      weather: iconCode !== null ? weatherIconDescription(iconCode) : null,
      weather_icon_url: iconCode !== null ? weatherIconUrl(iconCode) : null,
      temperature_min_c: summary.temperatureMinC,
      temperature_max_c: summary.temperatureMaxC,
      precipitation_total_mm: summary.precipitationTotalMm,
      sunshine_total_minutes: summary.sunshineTotalMinutes,
      wind_avg_kmh: summary.windAvgKmh,
      wind_gust_max_kmh: summary.windGustMaxKmh,
      hourly,
    };
  });
}

/**
 * Fetch and assemble the local forecast for a given location.
 */
export async function getLocalForecast(
  params: GetLocalForecastParams
): Promise<LocalForecastResponse> {
  const { location, days } = params;

  // Resolve location and get latest STAC item concurrently
  debugData('[ogd-forecast] Resolving location: %s', location);
  const [resolved, item] = await Promise.all([
    resolveForecastPoint(location),
    getLatestItem(OGD_COLLECTIONS.LOCAL_FORECASTING),
  ]);

  const point = resolved.match;
  const isStation = point.point_type_id === 1;
  debugData(
    '[ogd-forecast] Resolved to: %s (point_id=%d, type=%d/%s, confidence=%s)',
    point.name,
    point.point_id,
    point.point_type_id,
    isStation ? 'station' : 'non-station',
    resolved.confidence
  );

  const generated = String(item.properties.datetime ?? item.properties.updated ?? item.id);
  const pointIdStr = String(point.point_id);
  const pointTypeStr = String(point.point_type_id);

  // Non-station points only need the hourly series (aggregated to daily summaries). Stations
  // fetch BOTH: their official daily aggregates AND the hourly series (for `hourly[]` and the
  // two series with no official daily product — sunshine, wind; see `buildStationForecast`) —
  // except `jww003i0`, which stations never use (their icon comes from the official `jp2000d0`
  // daily param instead; `groupUnifiedHourlyByDate` doesn't touch `jww003i0` either), so
  // fetching it for stations would be a wasted upstream CSV download.
  const paramsToFetch = isStation
    ? [...DAILY_PARAMS, ...HOURLY_PARAMS.filter((p) => p !== 'jww003i0')]
    : HOURLY_PARAMS;

  // Download all parameter CSVs concurrently
  const paramEntries = await Promise.all(
    paramsToFetch.map(async (param) => {
      const assetKey = findLatestAssetKey(item, param);
      if (!assetKey) {
        debugData('[ogd-forecast] No asset found for param: %s', param);
        return [param, new Map<string, number | null>()] as const;
      }

      const url = resolveAssetUrl(item, assetKey);
      const cacheKey = `forecasts/${item.id}/${assetKey}`;
      debugData('[ogd-forecast] Downloading %s...', param);
      const index = await getIndexedCsvData(url, cacheKey, 'forecast', (text) =>
        buildForecastIndex(text, param)
      );
      const dateValues = lookupForecastSeries(index, pointIdStr, pointTypeStr);
      debugData('[ogd-forecast] Got %d values for %s', dateValues.size, param);
      return [param, dateValues] as const;
    })
  );

  const paramData = new Map(paramEntries);

  // Build daily forecast from the appropriate data source
  const forecast = isStation
    ? buildStationForecast(paramData, days)
    : buildHourlyAggregatedForecast(paramData, days);

  return {
    location: {
      name: point.name,
      type: pointTypeFromId(point.point_type_id),
      elevation: point.elevation,
      coordinates: point.coordinates,
    },
    generated,
    forecast,
    source: SOURCE_ATTRIBUTION,
  };
}

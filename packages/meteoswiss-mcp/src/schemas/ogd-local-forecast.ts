/**
 * Zod schemas for the getLocalForecast MCP tool.
 */

import { z } from 'zod';
import { CoordinatesSchema } from './ogd-shared.js';

export const GetLocalForecastParamsSchema = z.object({
  location: z
    .string()
    .min(1)
    .max(200, { message: 'Location must be at most 200 characters.' })
    .describe(
      'Swiss location: postal code (e.g., "8001"), station abbreviation (e.g., "SMA"), or place name (e.g., "Zurich")'
    ),
  days: z
    .number()
    .int()
    .min(1)
    .max(9)
    .optional()
    .default(5)
    .describe('Number of forecast days (1-9, default 5)'),
  detail: z
    .enum(['basic', 'sky'])
    .optional()
    .default('basic')
    .describe(
      'Hourly detail. "basic" (default): each hour has time, temperature, precipitation, sunshine, wind and gust. "sky": each hour also has the MeteoSwiss weather symbol (e.g. fog, stratus) and the low, medium and high cloud cover. Use "sky" for questions about fog, stratus, low cloud or where the sun shines; the answer is about 75 % larger.'
    ),
});
export type GetLocalForecastParams = z.infer<typeof GetLocalForecastParamsSchema>;

/**
 * A single hour's readings across every hourly series (unified per-hour object — "Shape B",
 * chosen over parallel per-parameter arrays by eval evidence; see
 * packages/meteoswiss-forecast-evals/docs/results/2026-07-09-forecast-json-comprehension.md
 * and packages/meteoswiss-forecast-evals/docs/results/2026-07-11-hourly-multiseries-shape-refinement.md
 * for the gust/all-flat follow-up).
 * The five "sky" fields (`weather_code`, `weather`, `cloud_low_pct`, `cloud_mid_pct`,
 * `cloud_high_pct`) are present ONLY when the caller asks for `detail: "sky"` — with the
 * default "basic" they are absent (no key), keeping the answer byte-for-byte the pre-#183 one.
 * Each field is independently nullable — an hour is included whenever at least one series has
 * a reading for it, even if others are missing for that specific hour.
 */
export const HourlyEntrySchema = z.object({
  time: z
    .string()
    .describe(
      'ISO 8601 timestamp with UTC offset, in local Europe/Zurich time (e.g. "2026-03-28T09:00:00+01:00")'
    ),
  temperature_c: z.number().nullable().describe('Temperature at this hour, in °C'),
  precip_mm: z.number().nullable().describe('Precipitation sum for this hour, in mm'),
  sunshine_minutes: z
    .number()
    .nullable()
    .describe('Sunshine duration within this hour, in minutes'),
  wind_kmh: z.number().nullable().describe('Mean wind speed for this hour, in km/h'),
  wind_gust_kmh: z.number().nullable().describe('Peak wind gust for this hour, in km/h'),
  weather_code: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      'MeteoSwiss weather symbol code (OGD jww003i0), one value per hour, describing the 3 hours that end at this time: 1-42 by day, 101-142 by night; 27 = stratus, 28 = fog.'
    ),
  weather: z
    .string()
    .nullable()
    .optional()
    .describe('Text for weather_code, e.g. "fog", "stratus", "very cloudy, light rain"'),
  cloud_low_pct: z
    .number()
    .nullable()
    .optional()
    .describe(
      'Low cloud cover at this time, in % of the sky (0-100, OGD nprolohs). Fog and low stratus count as low cloud.'
    ),
  cloud_mid_pct: z
    .number()
    .nullable()
    .optional()
    .describe('Medium-level cloud cover at this time, in % of the sky (0-100, OGD npromths)'),
  cloud_high_pct: z
    .number()
    .nullable()
    .optional()
    .describe('High cloud cover at this time, in % of the sky (0-100, OGD nprohihs)'),
});
export type HourlyEntry = z.infer<typeof HourlyEntrySchema>;

/** Daily forecast summary for one day */
export const DailyForecastSchema = z.object({
  date: z
    .string()
    .describe(
      "Local Europe/Zurich calendar date (YYYY-MM-DD) for postal codes/mountain points; the station data source's native daily date for weather stations."
    ),
  weather: z.string().nullable().describe('Human-readable weather description'),
  weather_icon_url: z.string().nullable().describe('URL of the official MeteoSwiss weather icon'),
  temperature_min_c: z
    .number()
    .nullable()
    .describe(
      "Daily temperature minimum, °C. For postal codes/mountain points, derived from the same hourly series as `hourly` (so they cannot disagree). For weather stations, MeteoSwiss's official daily aggregate (`tre200dn`) — may capture sub-hourly extremes the hourly series alone wouldn't show."
    ),
  temperature_max_c: z
    .number()
    .nullable()
    .describe(
      'Daily temperature maximum, °C. Same sourcing rules as temperature_min_c (station aggregate: `tre200dx`).'
    ),
  precipitation_total_mm: z
    .number()
    .nullable()
    .describe(
      "Daily precipitation total, mm. For postal codes/mountain points, the sum of `hourly`'s `precip_mm` (cannot disagree with the series). For weather stations, MeteoSwiss's official daily aggregate (`rka150d0`) — a *different* product than re-summing the station's hourly series, so it may legitimately NOT equal `sum(hourly precip_mm)` for stations. This is expected, not a data inconsistency."
    ),
  sunshine_total_minutes: z
    .number()
    .nullable()
    .describe(
      "Daily sunshine total, minutes. Derived from `hourly`'s `sunshine_minutes` for every point type (no official daily aggregate exists for this parameter)."
    ),
  wind_avg_kmh: z
    .number()
    .nullable()
    .describe(
      "Daily mean wind speed, km/h. Derived from `hourly`'s `wind_kmh` for every point type."
    ),
  wind_gust_max_kmh: z
    .number()
    .nullable()
    .describe(
      "Daily peak wind gust, km/h. Derived from `hourly`'s `wind_gust_kmh` for every point type."
    ),
  hourly: z
    .array(HourlyEntrySchema)
    .nullable()
    .describe(
      "Per-hour breakdown across every series, keyed to the local Europe/Zurich calendar day this `date` represents (each entry's `time` always falls within this day). `null` when no hourly breakdown exists for this location at all (a total data gap); `[]` when the point type supports hourly data but none was available for this specific day. A dry/calm/sunless hour still appears with its measured 0 value — 0-valued readings are kept, not omitted."
    ),
});
export type DailyForecast = z.infer<typeof DailyForecastSchema>;

/** Full forecast response */
export const LocalForecastResponseSchema = z.object({
  location: z.object({
    name: z.string().describe('Resolved location name'),
    type: z.string().describe('Point type: "station", "postal_code", or "mountain"'),
    elevation: z.number().describe('Elevation in metres above sea level'),
    coordinates: CoordinatesSchema.describe('WGS84 coordinates of the resolved point'),
  }),
  generated: z.string().describe('Timestamp the forecast was generated (ISO 8601)'),
  forecast: z.array(DailyForecastSchema).describe('One entry per forecast day, in date order'),
  source: z.string().describe('Data attribution'),
});
export type LocalForecastResponse = z.infer<typeof LocalForecastResponseSchema>;

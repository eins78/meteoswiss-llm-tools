/**
 * Zod schemas for the meteoswissWeatherSituation MCP tool.
 */

import { z } from 'zod';
import { WEATHER_CATEGORIES } from '../support/weather-categories.js';
import { FORECAST_REGION_IDS } from '../data/forecast-regions-source.js';

const REGION_IDS = FORECAST_REGION_IDS;

const CategorySchema = z.enum(WEATHER_CATEGORIES);

/** Tool description for `tools/list`. */
export const WEATHER_SITUATION_DESCRIPTION = `Count the weather over Switzerland at one hour: MeteoSwiss's hourly weather symbol at all ~5800 forecast points (postal code centres, weather stations, mountain points), grouped into weather categories per MeteoSwiss forecast region and altitude band. Use it for area questions: where it is sunny, how high the fog or low stratus reaches, whether it is sunny above it, where it rains or snows. For the forecast at one place, use meteoswissLocalForecast.

Regions are MeteoSwiss's seven forecast regions: jura, mittelland (Swiss Plateau), alpennordhang (northern Alps and Prealps), wallis (Valais), engadin, nordundmittelbuenden (northern and central Grisons), alpensuedseite (southern side of the Alps: Ticino and the southern valleys of Grisons). Points outside MeteoSwiss's seven regions are counted in the nearest one.

Narrow the count with region, bbox (a WGS84 box), near (air distance around a place, at most 150 km) and min_altitude_m / max_altitude_m; given together, a point must pass all of them. With until, the count covers every hour of a window of up to 12 hours.

Categories: sunny, clear_night, partly_sunny, cloudy, high_cloud, fog_or_stratus, rain, sleet, snow, thunder; the answer's "legend" gives the symbol codes of each. fog_or_stratus also counts an overcast or partly sunny hour under a low cloud deck (low cloud >= 80 %, medium and high cloud < 50 %): MeteoSwiss's symbol often shows such a deck as "overcast".

Reading the answer:
- Times are local Europe/Zurich time with the UTC offset. The symbol of an hour describes the 3 hours that end at that time.
- "points" counts forecast points, not area: they are dense in towns and the lowlands and sparse in the mountains. A band with few points says little.
- Per band, "pct" holds the shares in whole percent (they add up to 100) and "dominant" the most frequent category.
- jura, mittelland and alpennordhang also carry "fog_top_m" (experimental): the top of a fog sea to the nearest 100 m: the 100 m bands that are mostly fog_or_stratus, starting with the region's lowest band (below 1000 m) up, with mostly sun in the 300 m above ("sunny_above_fog_pct"). null means no fog sea with sun above: no fog layer low down, or cloud above it. For a fog question, also read the bands yourself.
- With map: "grid", "grid.rows" is a coarse map, north at the top: one character per 5 km cell, the most frequent category there ("grid.key"). Use it to say where (west or east, which valleys) rather than how much.
- The forecast is updated hourly. Further ahead it may have symbols only every few hours; a time the run does not cover is an error that names the hours it has.

Source: MeteoSwiss Open Data; the forecast regions come from the MeteoSwiss website (Source: MeteoSwiss).`;

export const GetWeatherSituationParamsSchema = z.object({
  time: z
    .string()
    .min(1)
    .max(40)
    .describe(
      'The hour to count, in local Swiss time: "2026-11-14T10:00" (minutes are ignored). A time with a UTC offset, e.g. "2026-11-14T10:00:00+01:00" from meteoswissLocalForecast, is also accepted.'
    ),
  until: z
    .string()
    .min(1)
    .max(40)
    .optional()
    .describe(
      'Last hour of a window, included, at most 12 h after time; same format as time. Every hour from time to until is counted: "points" stay points, the shares in "pct" are then shares of point-hours (each point once per hour).'
    ),
  region: z
    .enum(REGION_IDS)
    .optional()
    .describe(
      'Only this MeteoSwiss forecast region: jura, mittelland (Swiss Plateau), alpennordhang (northern Alps and Prealps), wallis (Valais), engadin, nordundmittelbuenden (northern and central Grisons), alpensuedseite (southern side of the Alps, Ticino). Default: all seven.'
    ),
  bbox: z
    .array(z.number())
    .length(4)
    .optional()
    .describe(
      'Only points inside this WGS84 box: [west, south, east, north] in degrees, e.g. [7.0, 46.5, 8.5, 47.5].'
    ),
  near: z
    .object({
      lat: z.number().min(45).max(48.5).describe('Latitude, WGS84 degrees'),
      lon: z.number().min(5).max(11.5).describe('Longitude, WGS84 degrees'),
      radius_km: z.number().positive().max(150).describe('Radius in km, air distance, at most 150'),
    })
    .optional()
    .describe(
      'Only points within radius_km of a place, e.g. {"lat": 47.37, "lon": 8.54, "radius_km": 40} around Zurich. Air distance, not travel time.'
    ),
  min_altitude_m: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .optional()
    .describe('Only points at or above this altitude, in m above sea level'),
  max_altitude_m: z
    .number()
    .int()
    .min(0)
    .max(5000)
    .optional()
    .describe('Only points at or below this altitude, in m above sea level'),
  bands: z
    .array(z.number().int().min(1).max(4800))
    .max(10)
    .optional()
    .default([500, 1000, 1500, 2000])
    .describe(
      'Altitude band edges in metres, ascending, e.g. [600, 800, 1000] for a fog question; default [500, 1000, 1500, 2000] gives the bands <500, 500-999, 1000-1499, 1500-1999, >=2000. [] gives one band.'
    ),
  map: z
    .enum(['none', 'grid'])
    .optional()
    .default('none')
    .describe(
      '"grid" adds a coarse map: the most frequent category in each 5 km cell, as text rows (about 3 KB more for the whole country). Default "none".'
    ),
});
export type GetWeatherSituationParams = z.infer<typeof GetWeatherSituationParamsSchema>;

const PctSchema = z
  .partialRecord(CategorySchema, z.number().int())
  .describe(
    'Share of the points (over a window: of the point-hours) per category, in whole percent, largest first; they add up to 100. Categories at 0 % are left out.'
  );

export const SituationBandSchema = z.object({
  band: z.string().describe('Altitude band in m, e.g. "<500", "500-999", ">=2000"'),
  points: z.number().int().describe('Forecast points in this band'),
  pct: PctSchema,
  dominant: CategorySchema.describe('The most frequent category in this band'),
});

export const SituationRegionSchema = z.object({
  id: z.enum(REGION_IDS).describe('MeteoSwiss forecast region id'),
  name: z.string().describe("The region's German name as MeteoSwiss writes it"),
  points: z.number().int().describe('Forecast points in this region'),
  dominant: CategorySchema.describe('The most frequent category over the whole region'),
  bands: z.array(SituationBandSchema).describe('Altitude bands with points, lowest first'),
  fog_top_m: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      'Experimental. Top of a fog sea in m, to the nearest 100 m: starting at the lowest 100 m band of the region, which must be mostly fog_or_stratus (and start below 1000 m), up as long as the bands stay so, with mostly sun above. null when the points show no fog sea with sun above. Only for jura, mittelland and alpennordhang.'
    ),
  sunny_above_fog_pct: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      'Experimental. Share of the points in the 300 m above fog_top_m that are sunny, partly sunny or a clear night, in whole percent; null without a fog top'
    ),
  fog_top_points: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      'Experimental. Points (over a window: point-hours) the fog top rests on: the fog layer and the 300 m above; null without a fog top'
    ),
});

export const WeatherSituationResponseSchema = z.object({
  valid: z.object({
    from: z
      .string()
      .describe(
        'First counted hour in local Europe/Zurich time with offset, e.g. "2026-11-14T10:00:00+01:00"'
      ),
    until: z
      .string()
      .optional()
      .describe('Last hour of the window, same format; present only when until was given'),
    hours: z.number().int().describe('Number of hours counted'),
  }),
  run: z.string().describe('The forecast run the counts come from, local time with offset'),
  points: z.number().int().describe('Forecast points counted (after the filters)'),
  missing: z
    .number()
    .int()
    .optional()
    .describe(
      'Point-hours left out because the run has no weather symbol for them; present only when more than 0'
    ),
  regions: z
    .array(SituationRegionSchema)
    .describe('MeteoSwiss forecast regions, west to east and north to south'),
  legend: z
    .partialRecord(CategorySchema, z.string())
    .describe('What each category in this answer means, with its MeteoSwiss symbol codes'),
  grid: z
    .object({
      crs: z.literal('EPSG:2056').describe('Swiss LV95 coordinates, metres'),
      cell_m: z.number().int().describe('Cell size in m (5000)'),
      west: z.number().int().describe('LV95 east coordinate of the west edge of the rows, m'),
      north: z
        .number()
        .int()
        .describe('LV95 north coordinate of the north edge of the first row, m'),
      rows: z
        .array(z.string())
        .describe(
          'One string per row of cells, north to south; character i is the cell i × cell_m east of "west". Each character is the most frequent category of the points in the cell (see "key").'
        ),
      key: z
        .record(z.string(), z.string())
        .describe('Character → category; "." = no forecast point'),
    })
    .optional()
    .describe(
      'Present only with map: "grid" and at least one point: a coarse map of the categories'
    ),
  warnings: z
    .array(z.string())
    .optional()
    .describe(
      'Present only when something limits the answer: a cloud cover file could not be loaded (the cloud rule is then off and fog_or_stratus counts only the fog and stratus symbols), or the run has symbols for only some hours of the window.'
    ),
  source: z.string().describe('Data attribution'),
});
export type WeatherSituationResponse = z.infer<typeof WeatherSituationResponseSchema>;

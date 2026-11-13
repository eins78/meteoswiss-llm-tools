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

Categories: sunny, clear_night, partly_sunny, cloudy, high_cloud, fog_or_stratus, rain, sleet, snow, thunder; the answer's "legend" gives the symbol codes of each. fog_or_stratus also counts an overcast or partly sunny hour under a low cloud deck (low cloud >= 80 %, medium and high cloud < 50 %): MeteoSwiss's symbol often shows such a deck as "overcast".

Reading the answer:
- Times are local Europe/Zurich time with the UTC offset. The symbol of an hour describes the 3 hours that end at that time.
- "points" counts forecast points, not area: they are dense in towns and the lowlands and sparse in the mountains. A band with few points says little.
- Per band, "pct" holds the shares in whole percent (they add up to 100) and "dominant" the most frequent category.
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
  region: z
    .enum(REGION_IDS)
    .optional()
    .describe(
      'Only this MeteoSwiss forecast region: jura, mittelland (Swiss Plateau), alpennordhang (northern Alps and Prealps), wallis (Valais), engadin, nordundmittelbuenden (northern and central Grisons), alpensuedseite (southern side of the Alps, Ticino). Default: all seven.'
    ),
  bands: z
    .array(z.number().int().min(1).max(4800))
    .max(10)
    .optional()
    .default([500, 1000, 1500, 2000])
    .describe(
      'Altitude band edges in metres, ascending, e.g. [600, 800, 1000] for a fog question; default [500, 1000, 1500, 2000] gives the bands <500, 500-999, 1000-1499, 1500-1999, >=2000. [] gives one band.'
    ),
});
export type GetWeatherSituationParams = z.infer<typeof GetWeatherSituationParamsSchema>;

const PctSchema = z
  .partialRecord(CategorySchema, z.number().int())
  .describe(
    'Share of the points per category, in whole percent, largest first; they add up to 100. Categories at 0 % are left out.'
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
});

export const WeatherSituationResponseSchema = z.object({
  valid: z.object({
    from: z
      .string()
      .describe(
        'Start of the counted hour in local Europe/Zurich time with offset, e.g. "2026-11-14T10:00:00+01:00"'
      ),
    hours: z.number().int().describe('Number of hours counted'),
  }),
  run: z.string().describe('The forecast run the counts come from, local time with offset'),
  points: z.number().int().describe('Forecast points counted'),
  missing: z
    .number()
    .int()
    .optional()
    .describe('Points left out because the run has no weather symbol for them at this hour'),
  regions: z
    .array(SituationRegionSchema)
    .describe('MeteoSwiss forecast regions, west to east and north to south'),
  legend: z
    .partialRecord(CategorySchema, z.string())
    .describe('What each category in this answer means, with its MeteoSwiss symbol codes'),
  warnings: z
    .array(z.string())
    .optional()
    .describe(
      'Present only when a cloud cover file could not be loaded; the cloud rule is then off and fog_or_stratus counts only the fog and stratus symbols.'
    ),
  source: z.string().describe('Data attribution'),
});
export type WeatherSituationResponse = z.infer<typeof WeatherSituationResponseSchema>;

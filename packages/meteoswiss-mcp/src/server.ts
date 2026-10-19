/**
 * Core MCP server implementation for MeteoSwiss weather data
 * Transport-agnostic server logic
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchMeteoSwissContentSchema, SearchResultsSchema } from './schemas/meteoswiss-search.js';
import type { SearchMeteoSwissContentInput } from './schemas/meteoswiss-search.js';
import { fetchMeteoSwissContentSchema, ContentResponseSchema } from './schemas/meteoswiss-fetch.js';
import type { FetchMeteoSwissContentInput } from './schemas/meteoswiss-fetch.js';
import { meteoswissSearchTool } from './tools/meteoswiss-search.js';
import { meteoswissFetchTool } from './tools/meteoswiss-fetch.js';
import {
  GetLocalForecastParamsSchema,
  LocalForecastResponseSchema,
} from './schemas/ogd-local-forecast.js';
import type { GetLocalForecastParams } from './schemas/ogd-local-forecast.js';
import { getLocalForecast } from './data/ogd-local-forecast.js';
import {
  GetCurrentWeatherParamsSchema,
  CurrentWeatherResponseSchema,
} from './schemas/ogd-current-weather.js';
import type { GetCurrentWeatherParams } from './schemas/ogd-current-weather.js';
import { getCurrentWeather } from './data/ogd-current-weather.js';
import { ListStationsParamsSchema, StationListResponseSchema } from './schemas/ogd-station-list.js';
import type { ListStationsParams } from './schemas/ogd-station-list.js';
import { listStations } from './data/ogd-station-list.js';
import { GetPollenDataParamsSchema, PollenDataResponseSchema } from './schemas/ogd-pollen-data.js';
import type { GetPollenDataParams } from './schemas/ogd-pollen-data.js';
import { getPollenData } from './data/ogd-pollen-data.js';
import {
  GetClimateDataParamsSchema,
  ClimateDataResponseSchema,
} from './schemas/ogd-climate-data.js';
import type { GetClimateDataParams } from './schemas/ogd-climate-data.js';
import { getClimateData } from './data/ogd-climate-data.js';
import { debugServer, debugTools } from './support/logging.js';
import { recordToolCall } from './support/metrics.js';
import type { McpPromptResponse } from './types/mcp-prompts.js';
import { getVersion } from './support/version.js';

/**
 * Sanitize a user-supplied value for a single-line stderr log entry: truncate
 * and JSON-stringify so embedded newlines / control characters cannot forge
 * additional log lines (e.g. fake `[MCP Server Error]` entries) — SEC-10.
 *
 * @param value - The raw user input to log
 * @param maxLength - Maximum characters to retain before truncation
 * @returns A quoted, escaped, length-bounded representation safe to interpolate
 */
function logSafe(value: unknown, maxLength = 200): string {
  const str = typeof value === 'string' ? value : String(value);
  const truncated = str.length > maxLength ? `${str.slice(0, maxLength)}…` : str;
  return JSON.stringify(truncated);
}

/**
 * Log a tool failure as one sanitized stderr line. Resolver errors embed the raw
 * tool argument in their message, so logging the Error object itself would let a
 * newline in that argument forge further log lines (SEC-10 on the error path).
 * The full error, stack included, goes to the debug logger only.
 *
 * @param label - Fixed, non-user text identifying the tool
 * @param error - The caught error
 */
function logToolError(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${label}: ${logSafe(message, 500)}`);
}

/**
 * Create and configure the MeteoSwiss MCP server
 * @returns Configured MCP server instance
 */
export function createServer(): McpServer {
  debugServer('Creating MCP server instance');
  const server = new McpServer({
    name: 'meteoswiss-mcp',
    version: getVersion(),
    description:
      'Access official MeteoSwiss weather data for Switzerland. Provides multi-day forecasts, real-time measurements, station listings, and pollen data from the MeteoSwiss app and website.',
  });
  debugServer('MCP server created with name: meteoswiss-mcp');

  // Register error handler
  server.server.onerror = (error: Error) => {
    console.error(`[MCP Server Error] ${logSafe(error.message, 500)}`);
    debugServer('Server error: %O', error);
    debugServer('Error stack: %s', error.stack);
  };

  // Log protocol events if debug is enabled
  if (process.env.DEBUG?.includes('mcp:server') || process.env.DEBUG_MCHMCP === 'true') {
    debugServer('Protocol event logging enabled');
  }

  // Register tools

  // Register search tool
  debugServer('Registering tool: search');
  server.registerTool(
    'search',
    {
      description:
        'Search MeteoSwiss website content in multiple languages (DE, FR, IT, EN). Returns relevant pages with URLs that can be passed to the fetch tool. Always returns up to 10 results per page — the upstream API has a fixed page size that cannot be changed. Note: pagination may return duplicate results across pages (upstream API limitation).',
      inputSchema: searchMeteoSwissContentSchema.shape,
      outputSchema: SearchResultsSchema.shape,
    },
    async (params: SearchMeteoSwissContentInput) => {
      const _t0 = performance.now();
      try {
        console.error(
          `Processing search request: query=${logSafe(params.query)}, language=${logSafe(params.language || 'de')}`
        );
        debugTools('search called with params: %O', params);
        const results = await meteoswissSearchTool(params);
        console.error(`Search returned ${results.totalResults} results`);
        debugTools('Search completed successfully');
        recordToolCall('search', performance.now() - _t0);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
          structuredContent: results,
        };
      } catch (error: unknown) {
        logToolError('Error in search tool', error);
        debugTools('Error in search: %O', error);
        recordToolCall('search', performance.now() - _t0);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Search failed: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register fetch tool with ChatGPT-compatible name
  debugServer('Registering tool: fetch');
  server.registerTool(
    'fetch',
    {
      description:
        'Fetch full content from a MeteoSwiss webpage and convert to markdown or plain text. Use the search tool first to discover valid page URLs, then pass the full URL as the id parameter.',
      inputSchema: fetchMeteoSwissContentSchema.shape,
      outputSchema: ContentResponseSchema.shape,
    },
    async (params: FetchMeteoSwissContentInput) => {
      const _t0 = performance.now();
      try {
        console.error(
          `Processing fetch request: id=${logSafe(params.id)}, format=${logSafe(params.format || 'markdown')}`
        );
        debugTools('fetch called with params: %O', params);
        const content = await meteoswissFetchTool(params);
        console.error('Successfully fetched content');
        debugTools('Fetch completed successfully');
        recordToolCall('fetch', performance.now() - _t0);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(content, null, 2),
            },
          ],
          structuredContent: content,
        };
      } catch (error: unknown) {
        logToolError('Error in fetch tool', error);
        debugTools('Error in fetch: %O', error);
        recordToolCall('fetch', performance.now() - _t0);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Fetch failed: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register getLocalForecast tool (OGD)
  debugServer('Registering tool: getLocalForecast');
  server.registerTool(
    'meteoswissLocalForecast',
    {
      description: `Get a multi-day weather forecast for any Swiss location. Returns daily summaries (temperature, precipitation, sunshine, wind, weather icon) plus a hierarchical hourly breakdown of every series.

This uses official MeteoSwiss Open Data — the same forecasts powering the MeteoSwiss app and website.

Accepts:
- Postal codes: "8001" (Zurich), "3000" (Bern), "1200" (Geneva)
- Station abbreviations: "SMA" (Zurich Fluntern), "BER" (Bern)
- Place names: "Zurich", "Basel", "Lugano"

Coverage: ~6000 Swiss locations (all postal codes + weather stations + mountain points).
Forecast horizon: up to 9 days. Updated hourly.

Each day's summary fields: temperature_min_c, temperature_max_c, precipitation_total_mm,
sunshine_total_minutes, wind_avg_kmh, wind_gust_max_kmh, weather, weather_icon_url.

Each day also includes "hourly": one array of per-hour objects covering every series
together — { time, temperature_c, precip_mm, sunshine_minutes, wind_kmh, wind_gust_kmh } —
useful for judging *when* rain, sun, or wind is expected, not just the daily summary:
- Each entry's "time" is already local wall-clock time for the location (Europe/Zurich),
  with the UTC offset included, e.g. "2026-07-09T14:00:00+02:00". It is NOT UTC — do not
  convert it.
- A dry/calm/sunless hour is reported as its measured value (often 0), not omitted. A
  fully dry day is still a full array of zero-precipitation hours, not an empty array.
- Each field is independently null if just THAT series has no reading for a given hour —
  the other fields for that same hour are still populated. An hour is omitted entirely
  only when every series is missing for it.
- "hourly" itself is null when no hourly breakdown exists for this location at all (a
  total data gap); [] only when this location supports hourly data but none was available
  for that specific day.
- For weather stations, temperature_min_c/temperature_max_c/precipitation_total_mm are
  MeteoSwiss's own official daily aggregates — a different, separately-curated product
  from the hourly series shown alongside them. They can legitimately NOT match summing/
  averaging the hourly entries for that day; this is expected, not a data error.
  sunshine_total_minutes/wind_avg_kmh/wind_gust_max_kmh have no official daily product for
  stations and are always derived from the hourly series. For postal codes/mountain
  points, every summary field is derived from the same hourly series shown alongside it,
  so it always matches summing/averaging that series exactly.`,
      inputSchema: GetLocalForecastParamsSchema.shape,
      outputSchema: LocalForecastResponseSchema.shape,
    },
    async (params: GetLocalForecastParams) => {
      const _t0 = performance.now();
      try {
        console.error(
          `Processing getLocalForecast request for location: ${logSafe(params.location)}, days: ${params.days}`
        );
        debugTools('getLocalForecast called with params: %O', params);
        const result = await getLocalForecast(params);
        console.error('Successfully retrieved local forecast');
        debugTools('Local forecast retrieved successfully');
        recordToolCall('meteoswissLocalForecast', performance.now() - _t0);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        logToolError('Error in getLocalForecast tool', error);
        debugTools('Error in getLocalForecast: %O', error);
        recordToolCall('meteoswissLocalForecast', performance.now() - _t0);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get local forecast: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register getCurrentWeather tool (OGD)
  debugServer('Registering tool: getCurrentWeather');
  server.registerTool(
    'meteoswissCurrentWeather',
    {
      description: `Get real-time weather measurements from ~300 Swiss automatic weather stations (~160 full weather + ~140 precipitation-only). Returns temperature, precipitation, wind, humidity, pressure, sunshine, and more. Data updates every 10 minutes. Precipitation-only stations return only rainfall data.

For 8 stations (Zurich, Basel, Chur, Sion, Altdorf, Säntis, Jungfraujoch, Grand St-Bernard), also includes daily visual observations: cloud cover, fog, rain, snowfall, hail, and snow coverage.

Accepts station names ("Zurich"), abbreviations ("SMA"), addresses ("Bahnhofplatz 1 Bern"), or WGS84 coordinates. Automatically finds the nearest station.`,
      inputSchema: GetCurrentWeatherParamsSchema.shape,
      outputSchema: CurrentWeatherResponseSchema.shape,
    },
    async (params: GetCurrentWeatherParams) => {
      const _t0 = performance.now();
      try {
        console.error(
          `Processing meteoswissCurrentWeather request: station=${logSafe(params.station ?? '')}, coords=${params.coordinates ? `${params.coordinates.lat},${params.coordinates.lon}` : ''}`
        );
        debugTools('getCurrentWeather called with params: %O', params);
        const result = await getCurrentWeather(params);
        console.error('Successfully retrieved current weather');
        recordToolCall('meteoswissCurrentWeather', performance.now() - _t0);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        logToolError('Error in meteoswissCurrentWeather tool', error);
        debugTools('Error in getCurrentWeather: %O', error);
        recordToolCall('meteoswissCurrentWeather', performance.now() - _t0);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get current weather: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register listStations tool (OGD)
  debugServer('Registering tool: listStations');
  server.registerTool(
    'meteoswissStations',
    {
      description: `List and search MeteoSwiss measurement stations. Filter by name, canton, or browse the full network of ~300 stations (~160 full weather + ~140 precipitation-only) across Switzerland.`,
      inputSchema: ListStationsParamsSchema.shape,
      outputSchema: StationListResponseSchema.shape,
    },
    async (params: ListStationsParams) => {
      const _t0 = performance.now();
      try {
        console.error(
          `Processing meteoswissStations request: search=${logSafe(params.search ?? '')}, canton=${logSafe(params.canton ?? '')}`
        );
        debugTools('listStations called with params: %O', params);
        const result = await listStations(params);
        console.error(`Successfully listed ${result.total} stations`);
        recordToolCall('meteoswissStations', performance.now() - _t0);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        logToolError('Error in meteoswissStations tool', error);
        debugTools('Error in listStations: %O', error);
        recordToolCall('meteoswissStations', performance.now() - _t0);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to list stations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register getPollenData tool (OGD)
  debugServer('Registering tool: getPollenData');
  server.registerTool(
    'meteoswissPollenData',
    {
      description: `Get current pollen concentration data from MeteoSwiss monitoring stations (~15 stations across Switzerland). Shows pollen levels for 7 measured species (alder, birch, hazel, beech, ash, oak, grasses) — each is always included, with a "no-current-data" status when out of season. Ambrosia (ragweed) is a MeteoSwiss forecast-only category and is not part of this OGD measurement network, so it is not included. Useful for allergy sufferers.`,
      inputSchema: GetPollenDataParamsSchema.shape,
      outputSchema: PollenDataResponseSchema.shape,
    },
    async (params: GetPollenDataParams) => {
      const _t0 = performance.now();
      try {
        console.error(
          `Processing meteoswissPollenData request: station=${logSafe(params.station ?? 'all')}`
        );
        debugTools('getPollenData called with params: %O', params);
        const result = await getPollenData(params);
        console.error(`Successfully retrieved pollen data for ${result.stations.length} stations`);
        recordToolCall('meteoswissPollenData', performance.now() - _t0);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        logToolError('Error in meteoswissPollenData tool', error);
        debugTools('Error in getPollenData: %O', error);
        recordToolCall('meteoswissPollenData', performance.now() - _t0);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get pollen data: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register getClimateData tool (OGD NBCN)
  debugServer('Registering tool: getClimateData');
  server.registerTool(
    'meteoswissClimateData',
    {
      description: `Get homogeneous climate measurement series from Switzerland's National Basic Climatic Network (NBCN). Returns temperature, precipitation, sunshine, radiation, wind, pressure, and climate indicators (frost days, summer days, heat days) going back decades.

29 climate stations + 46 precipitation stations with daily, monthly, and yearly resolution.

Use cases: "What are typical January temperatures in Zurich?", "How has precipitation changed in Basel over 50 years?", "How many heat days did Lugano have last year?"

Accepts station names ("Zurich", "Basel"), abbreviations ("SMA", "BAS"), or WGS84 coordinates.`,
      inputSchema: GetClimateDataParamsSchema.shape,
      outputSchema: ClimateDataResponseSchema.shape,
    },
    async (params: GetClimateDataParams) => {
      const _t0 = performance.now();
      try {
        console.error(
          `Processing meteoswissClimateData request: station=${logSafe(params.station ?? '')}, resolution=${logSafe(params.resolution ?? 'monthly')}`
        );
        debugTools('getClimateData called with params: %O', params);
        const result = await getClimateData(params);
        console.error(`Successfully retrieved climate data: ${result.data.length} rows`);
        recordToolCall('meteoswissClimateData', performance.now() - _t0);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        logToolError('Error in meteoswissClimateData tool', error);
        debugTools('Error in getClimateData: %O', error);
        recordToolCall('meteoswissClimateData', performance.now() - _t0);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get climate data: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register prompts
  debugServer('Registering prompts');

  // German prompt for Northern Switzerland
  server.prompt(
    'wetterNordschweiz',
    'Wetterprognose und aktuelle Messdaten für die Nordschweiz',
    (): McpPromptResponse => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Wie ist das Wetter in der Nordschweiz heute und in den nächsten Tagen?',
            },
          },
          {
            role: 'assistant',
            content: {
              type: 'text',
              text: 'Ich hole die aktuelle Wetterprognose und Messdaten für die Nordschweiz.\n\n[Tool: meteoswissLocalForecast mit location="Zürich"]\n[Tool: meteoswissCurrentWeather mit station="Zürich"]',
            },
          },
        ],
      };
    }
  );

  // German prompt for flexible location
  server.prompt(
    'wetterSchweiz',
    'Wetter für einen beliebigen Ort in der Schweiz',
    (): McpPromptResponse => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Für welchen Ort möchten Sie das Wetter wissen? Sie können einen Ortsnamen, eine Postleitzahl oder eine Wetterstation angeben.\n\nBeispiele:\n- «Zürich» oder «8001»\n- «Genf» oder «1200»\n- «Lugano» oder «6900»',
            },
          },
        ],
      };
    }
  );

  // French prompt for Western Switzerland (Romandy)
  server.prompt(
    'meteoSuisseRomande',
    'Prévisions et mesures actuelles pour la Suisse romande',
    (): McpPromptResponse => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: "Quel temps fait-il en Suisse romande aujourd'hui et pour les prochains jours?",
            },
          },
          {
            role: 'assistant',
            content: {
              type: 'text',
              text: 'Je vais chercher les prévisions et mesures actuelles pour la Suisse romande.\n\n[Tool: meteoswissLocalForecast avec location="Genève"]\n[Tool: meteoswissCurrentWeather avec station="Genève"]',
            },
          },
        ],
      };
    }
  );

  // Italian prompt for Southern Switzerland (Ticino)
  server.prompt('meteoTicino', 'Previsioni e dati attuali per il Ticino', (): McpPromptResponse => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: "Com'è il tempo in Ticino oggi e nei prossimi giorni?",
          },
        },
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: 'Recupero le previsioni e i dati attuali per il Ticino.\n\n[Tool: meteoswissLocalForecast con location="Lugano"]\n[Tool: meteoswissCurrentWeather con station="Lugano"]',
          },
        },
      ],
    };
  });

  return server;
}

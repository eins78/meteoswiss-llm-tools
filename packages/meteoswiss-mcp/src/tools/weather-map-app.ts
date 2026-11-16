/**
 * The weather map MCP App: the `meteoswissWeatherMapExperimental` tool and the `ui://` view it points at.
 *
 * The tool takes the inputs of `meteoswissWeatherSituation` (with `map` fixed to "grid") and
 * returns the same answer. A client that renders MCP Apps shows the view next to it, which
 * colours the grid; any other client gets the same text. To keep the tool away from clients
 * that cannot render views (they would only see a second situation tool), it is switched on
 * per session, once the client has said in `initialize` that it renders views.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getWeatherSituation } from '../data/ogd-weather-situation.js';
import {
  GetWeatherSituationParamsSchema,
  WeatherSituationResponseSchema,
} from '../schemas/ogd-weather-situation.js';
import { debugTools } from '../support/logging.js';
import { logSafe } from '../support/log-safe.js';
import { recordToolCall } from '../support/metrics.js';
import {
  SITUATION_MAP_URI,
  UI_MIME_TYPE,
  WEATHER_MAP_TOOL,
  clientRendersViews,
} from '../support/map-app.js';
import { SITUATION_MAP_HTML } from '../views/situation-map.js';

/** Same inputs as meteoswissWeatherSituation, without `map` (the map is the point of this tool). */
const WeatherMapParamsSchema = GetWeatherSituationParamsSchema.omit({ map: true }).strict();

const WEATHER_MAP_DESCRIPTION = `Experimental: this tool may change or go away. Show a map of the weather over Switzerland at one hour (or a window of up to 12 hours): one coloured cell per 5 km, the most frequent weather there, with the seven MeteoSwiss forecast regions and a legend. Use it when the user wants to see where it is sunny, foggy, wet or snowing. It takes the inputs of meteoswissWeatherSituation and returns the same answer with the grid, so the counts per region and altitude band can be read from the text as well. For one place use meteoswissLocalForecast.`;

/**
 * Register the map tool and its view on a server, switched off until the client has said that
 * it renders MCP App views.
 *
 * @param server - The server to register on (one per session)
 */
export function registerWeatherMapApp(server: McpServer): void {
  const view = server.registerResource(
    'situation-map-view',
    SITUATION_MAP_URI,
    {
      title: 'Weather map of Switzerland',
      description:
        'Self-contained view that draws the grid of a meteoswissWeatherMapExperimental answer.',
      mimeType: UI_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: UI_MIME_TYPE,
          text: SITUATION_MAP_HTML,
          // No _meta.ui.csp: the default CSP (no network, inline script and style) is all the view needs.
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    })
  );

  const tool = server.registerTool(
    WEATHER_MAP_TOOL,
    {
      title: 'Weather map (experimental)',
      description: WEATHER_MAP_DESCRIPTION,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: WeatherMapParamsSchema,
      outputSchema: WeatherSituationResponseSchema.shape,
      _meta: { ui: { resourceUri: SITUATION_MAP_URI, visibility: ['model', 'app'] } },
    },
    async (params) => {
      const _t0 = performance.now();
      try {
        debugTools('%s called with params: %O', WEATHER_MAP_TOOL, params);
        const result = await getWeatherSituation({ ...params, map: 'grid' });
        recordToolCall(WEATHER_MAP_TOOL, performance.now() - _t0);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error in ${WEATHER_MAP_TOOL} tool: ${logSafe(message, 500)}`);
        recordToolCall(WEATHER_MAP_TOOL, performance.now() - _t0);
        return {
          content: [{ type: 'text' as const, text: `Failed to get the weather map: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // Off until the client says it renders views: tools/list then leaves the tool out, and the
  // server tells a client that already listed tools through tools/list_changed.
  tool.disable();
  view.disable();
  server.server.oninitialized = () => {
    if (!clientRendersViews(server.server.getClientCapabilities())) return;
    debugTools('Client renders MCP App views: offering %s', WEATHER_MAP_TOOL);
    view.enable();
    tool.enable();
  };
}

/**
 * Constants and checks for the weather map MCP App (the `meteoswissWeatherMapExperimental` tool and its
 * `ui://` view). An MCP App is an extension of the protocol: the client says in `initialize`
 * that it can render views, and the server then offers a tool that points at one.
 *
 * Off by default: the app is behind the environment flag `METEOSWISS_MAP_APP=true`.
 */

/** Name of the extension in `capabilities.extensions`, on both sides of `initialize`. */
export const UI_EXTENSION_ID = 'io.modelcontextprotocol/ui';

/** The only MIME type of a view that MCP Apps defines. */
export const UI_MIME_TYPE = 'text/html;profile=mcp-app';

/** Resource URI of the map view; the tool's `_meta.ui.resourceUri` points here. */
export const SITUATION_MAP_URI = 'ui://meteoswiss/situation-map.html';

/** Name of the tool that shows the map. */
export const WEATHER_MAP_TOOL = 'meteoswissWeatherMapExperimental';

/**
 * Whether the map app is switched on (`METEOSWISS_MAP_APP=true`). Anything else is off.
 *
 * @param env - The environment to read, `process.env` by default
 */
export function isMapAppEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.METEOSWISS_MAP_APP?.trim().toLowerCase() === 'true';
}

/**
 * Whether a client says it can render MCP App views: it lists the UI extension in its
 * capabilities with the view MIME type, as the extension requires.
 *
 * @param capabilities - The client's capabilities from `initialize` (may be undefined)
 */
export function clientRendersViews(
  capabilities: { extensions?: Record<string, unknown> | undefined } | undefined
): boolean {
  const ui = capabilities?.extensions?.[UI_EXTENSION_ID];
  if (typeof ui !== 'object' || ui === null) return false;
  const mimeTypes = (ui as { mimeTypes?: unknown }).mimeTypes;
  return Array.isArray(mimeTypes) && mimeTypes.includes(UI_MIME_TYPE);
}

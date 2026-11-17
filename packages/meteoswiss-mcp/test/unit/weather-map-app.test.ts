import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const getWeatherSituation = vi.fn();
vi.mock('../../src/data/ogd-weather-situation.js', () => ({
  getWeatherSituation: (...args: unknown[]) => getWeatherSituation(...args),
}));

const { createServer } = await import('../../src/server.js');
const { SITUATION_MAP_HTML } = await import('../../src/views/situation-map.js');
const { clientRendersViews, isMapAppEnabled, SITUATION_MAP_URI, UI_EXTENSION_ID, UI_MIME_TYPE } =
  await import('../../src/support/map-app.js');

const VIEW_CAPABILITY = { extensions: { [UI_EXTENSION_ID]: { mimeTypes: [UI_MIME_TYPE] } } };

const SITUATION = {
  valid: { from: '2026-11-17T10:00:00+01:00', hours: 1 },
  run: '2026-11-17T06:00:00+01:00',
  points: 3,
  regions: [],
  legend: { sunny: 'Sunny' },
  grid: {
    crs: 'EPSG:2056',
    cell_m: 5000,
    west: 2480000,
    north: 1300000,
    cols: 3,
    row_count: 2,
    rows: ['SS.', 'SW.'],
    key: { S: 'sunny', W: 'snow', '.': 'no forecast point' },
  },
  source: 'Source: MeteoSwiss',
};

async function connect(mapApp: boolean, capabilities: Record<string, unknown>) {
  const server = createServer({ mapApp });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'map-app-test', version: '0.0.0' }, { capabilities });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const toolNames = async (client: Client): Promise<string[]> =>
  (await client.listTools()).tools.map((t) => t.name);

beforeEach(() => {
  getWeatherSituation.mockReset();
  getWeatherSituation.mockResolvedValue(SITUATION);
});

describe('weather map app: the switch and the client check', () => {
  it('is off unless METEOSWISS_MAP_APP is "true"', () => {
    expect(isMapAppEnabled({})).toBe(false);
    expect(isMapAppEnabled({ METEOSWISS_MAP_APP: 'false' })).toBe(false);
    expect(isMapAppEnabled({ METEOSWISS_MAP_APP: '1' })).toBe(false);
    expect(isMapAppEnabled({ METEOSWISS_MAP_APP: ' TRUE ' })).toBe(true);
  });

  it('accepts only a client that lists the view MIME type under the UI extension', () => {
    expect(clientRendersViews(VIEW_CAPABILITY)).toBe(true);
    expect(clientRendersViews(undefined)).toBe(false);
    expect(clientRendersViews({})).toBe(false);
    expect(clientRendersViews({ extensions: { [UI_EXTENSION_ID]: {} } })).toBe(false);
    expect(clientRendersViews({ extensions: { [UI_EXTENSION_ID]: { mimeTypes: ['text/html'] } } })).toBe(false);
  });

  it('with the flag off: no map tool, no view, no extension, even for a client that renders views', async () => {
    const client = await connect(false, VIEW_CAPABILITY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await toolNames(client)).not.toContain('meteoswissWeatherMapExperimental');
    expect(client.getServerCapabilities()?.extensions).toBeUndefined();
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    await client.close();
  });

  it('with the flag on: a client without the UI extension does not see the tool or the view', async () => {
    const client = await connect(true, {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await toolNames(client)).not.toContain('meteoswissWeatherMapExperimental');
    expect((await client.listResources()).resources).toEqual([]);
    await client.close();
  });
});

describe('weather map app: a client that renders views', () => {
  it('declares the extension and lists the tool pointing at the view', async () => {
    const client = await connect(true, VIEW_CAPABILITY);
    await vi.waitFor(async () => expect(await toolNames(client)).toContain('meteoswissWeatherMapExperimental'));
    expect(client.getServerCapabilities()?.extensions).toHaveProperty([UI_EXTENSION_ID]);

    const tool = (await client.listTools()).tools.find((t) => t.name === 'meteoswissWeatherMapExperimental');
    expect(tool?._meta).toEqual({
      ui: { resourceUri: SITUATION_MAP_URI, visibility: ['model', 'app'] },
    });
    expect(tool?.title).toBe('Weather map (experimental)');
    expect(tool?.description).toMatch(/^Experimental: .*may change or go away/);
    // Two real clients drew their own map from the situation tool instead of calling this one.
    expect(tool?.description).toMatch(/whenever the user asks to see or show a map.*instead of drawing a map yourself/);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tool?.inputSchema.properties).not.toHaveProperty('map');
    expect(tool?.inputSchema.properties).toHaveProperty('time');
    await client.close();
  });

  it('serves the view as a ui:// resource with the MCP App MIME type', async () => {
    const client = await connect(true, VIEW_CAPABILITY);
    await vi.waitFor(async () => expect((await client.listResources()).resources).toHaveLength(1));
    const [listed] = (await client.listResources()).resources;
    expect(listed).toMatchObject({ uri: SITUATION_MAP_URI, mimeType: UI_MIME_TYPE });

    const { contents } = await client.readResource({ uri: SITUATION_MAP_URI });
    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({ uri: SITUATION_MAP_URI, mimeType: UI_MIME_TYPE });
    expect((contents[0] as { text: string }).text).toBe(SITUATION_MAP_HTML);
    // The default CSP is enough: the view asks for no extra domain.
    expect(JSON.stringify(contents[0]?._meta)).not.toMatch(/csp|Domains/);
    await client.close();
  });

  it('answers like the situation tool, with the grid forced on', async () => {
    const client = await connect(true, VIEW_CAPABILITY);
    await vi.waitFor(async () => expect(await toolNames(client)).toContain('meteoswissWeatherMapExperimental'));

    const result = await client.callTool({
      name: 'meteoswissWeatherMapExperimental',
      arguments: { time: '2026-11-17T10:00', near: { lat: 47.37, lon: 8.54, radius_km: 60 } },
    });
    expect(result.isError).toBeFalsy();
    expect(getWeatherSituation).toHaveBeenCalledWith(
      expect.objectContaining({ time: '2026-11-17T10:00', map: 'grid', near: expect.any(Object) })
    );
    expect(result.structuredContent).toEqual(SITUATION);
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    expect(JSON.parse(text)).toEqual(SITUATION);
    await client.close();
  });

  it('rejects an argument it does not know, such as map', async () => {
    const client = await connect(true, VIEW_CAPABILITY);
    await vi.waitFor(async () => expect(await toolNames(client)).toContain('meteoswissWeatherMapExperimental'));
    const result = await client.callTool({
      name: 'meteoswissWeatherMapExperimental',
      arguments: { time: '2026-11-17T10:00', map: 'none' },
    });
    expect(result.isError).toBe(true);
    expect(getWeatherSituation).not.toHaveBeenCalled();
    await client.close();
  });

  it('turns a data error into a tool error, not a crash', async () => {
    getWeatherSituation.mockRejectedValue(new RangeError('time is not in the run'));
    const client = await connect(true, VIEW_CAPABILITY);
    await vi.waitFor(async () => expect(await toolNames(client)).toContain('meteoswissWeatherMapExperimental'));
    const result = await client.callTool({
      name: 'meteoswissWeatherMapExperimental',
      arguments: { time: '2026-11-17T10:00' },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toContain('time is not in the run');
    await client.close();
  });
});

describe('weather map view: what the page may do', () => {
  it('is one self-contained page: no external URL, file or network call', () => {
    expect(SITUATION_MAP_HTML).not.toMatch(/https?:\/\//i);
    expect(SITUATION_MAP_HTML).not.toMatch(/<(link|img|iframe|object|embed|video|audio|base)\b/i);
    expect(SITUATION_MAP_HTML).not.toMatch(/<script[^>]*\bsrc=/i);
    expect(SITUATION_MAP_HTML).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|eval)\s*\(/);
    expect(SITUATION_MAP_HTML).not.toMatch(/\bimport\s*[({]|\bnew Function\b|@import/);
  });

  it('puts nothing from the tool result into the page as HTML', () => {
    expect(SITUATION_MAP_HTML).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});

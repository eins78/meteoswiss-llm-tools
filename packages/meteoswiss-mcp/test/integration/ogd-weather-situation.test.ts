import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { MCPClient } from './mcp-client.js';

/**
 * End to end through the built server: the tool is listed, and its answer passes the
 * SDK's output-schema check (an answer that does not match `outputSchema` fails here,
 * not in the unit tests). Fixture scenario: test/__fixtures__/ogd/forecasts/README.md.
 */
describe('meteoswissWeatherSituation Tool', () => {
  let client: MCPClient;

  beforeAll(async () => {
    process.env.USE_TEST_FIXTURES = 'true';
    client = new MCPClient();
    await client.start();
  });

  afterAll(async () => {
    await client.stop();
  });

  it('is listed with its inputs, the regions and the nearest-region note', async () => {
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === 'meteoswissWeatherSituation');
    expect(tool).toBeDefined();
    expect(Object.keys(tool?.inputSchema?.properties ?? {})).toEqual(['time', 'region', 'bands']);
    expect(tool?.inputSchema?.required).toEqual(['time']);
    expect(tool?.outputSchema).toBeDefined();
    expect(tool?.description).toContain(
      "Points outside MeteoSwiss's seven regions are counted in the nearest one."
    );
    expect(tool?.description).toContain('Source: MeteoSwiss');
  });

  it('returns region and band counts as structured content', async () => {
    const result = await client.callTool('meteoswissWeatherSituation', {
      time: '2026-03-28T09:00',
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(result.structuredContent).toEqual(data);
    expect(data.valid).toEqual({ from: '2026-03-28T09:00:00+01:00', hours: 1 });
    expect(data.points).toBe(33);
    expect(data.regions).toHaveLength(7);
    const mittelland = data.regions.find((r: { id: string }) => r.id === 'mittelland');
    expect(mittelland.bands[0]).toEqual({
      band: '<500',
      points: 5,
      pct: { fog_or_stratus: 100 },
      dominant: 'fog_or_stratus',
    });
    expect(data.legend.fog_or_stratus).toMatch(/low cloud >= 80 %/);
  });

  it('returns a readable error for an hour the run does not cover', async () => {
    const result = await client.callTool('meteoswissWeatherSituation', {
      time: '2026-04-05T10:00',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the forecast run/);
  });

  it('rejects an unknown region id', async () => {
    const result = await client.callTool('meteoswissWeatherSituation', {
      time: '2026-03-28T09:00',
      region: 'tessin',
    });
    expect(result.isError).toBe(true);
  });
});

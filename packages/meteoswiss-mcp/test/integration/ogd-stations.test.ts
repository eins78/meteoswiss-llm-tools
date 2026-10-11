import { describe, expect, it , vi, beforeAll, afterAll } from 'vitest';
import { MCPClient } from './mcp-client.js';

describe('meteoswissStations Tool', () => {
  let client: MCPClient;

  beforeAll(async () => {
    process.env.USE_TEST_FIXTURES = 'true';
    client = new MCPClient();
    await client.start();
  });

  afterAll(async () => {
    await client.stop();
    vi.restoreAllMocks();
  });

  it('should be registered as meteoswissStations', async () => {
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === 'meteoswissStations');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('station');
  });

  it('should list stations without filters', async () => {
    const result = await client.callTool('meteoswissStations', { limit: 5 });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBeGreaterThan(0);
    expect(data.stations).toBeDefined();
    expect(Array.isArray(data.stations)).toBe(true);
    expect(data.stations.length).toBeLessThanOrEqual(5);
    expect(data.source).toBe('MeteoSwiss Open Data');

    // Check station structure
    const station = data.stations[0];
    expect(station).toHaveProperty('abbreviation');
    expect(station).toHaveProperty('name');
    expect(station).toHaveProperty('canton');
    expect(station).toHaveProperty('elevation');
    expect(station).toHaveProperty('coordinates');
    expect(station.coordinates).toHaveProperty('lat');
    expect(station.coordinates).toHaveProperty('lon');
  });

  it('should filter stations by canton', async () => {
    const result = await client.callTool('meteoswissStations', {
      canton: 'BE',
      limit: 10,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    // All returned stations should be in BE
    for (const station of data.stations) {
      expect(station.canton).toBe('BE');
    }
  });

  it('should filter stations by search term', async () => {
    const result = await client.callTool('meteoswissStations', {
      search: 'Adelboden',
      limit: 5,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBeGreaterThan(0);
  });
});

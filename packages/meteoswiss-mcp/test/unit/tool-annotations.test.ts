import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../../src/server.js';

describe('tool annotations and titles', () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'annotations-test', version: '0.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('lists all 8 tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'fetch',
      'meteoswissClimateData',
      'meteoswissCurrentWeather',
      'meteoswissLocalForecast',
      'meteoswissPollenData',
      'meteoswissStations',
      'meteoswissWeatherSituation',
      'search',
    ]);
  });

  it('marks every tool read-only, non-destructive and open-world', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
  });

  it('gives every tool a human title that differs from its name', async () => {
    const { tools } = await client.listTools();
    const titles = new Set<string>();
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.title, tool.name).not.toBe(tool.name);
      titles.add(tool.title as string);
    }
    expect(titles.size).toBe(tools.length);
  });
});

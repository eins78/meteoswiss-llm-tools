import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../../src/server.js';
import {
  SERVER_INSTRUCTIONS,
  sunFinderText,
} from '../../src/support/server-instructions.js';

describe('server instructions and the sunFinder prompt', () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'instructions-test', version: '0.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('sends the recipes in the initialize result', () => {
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it('keeps the recipes short: they cost context in every session', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(2200);
    expect(SERVER_INSTRUCTIONS.match(/^\d\. /gm)).toHaveLength(4);
  });

  it('names only tools the server has', async () => {
    const tools = new Set((await client.listTools()).tools.map((t) => t.name));
    const named = SERVER_INSTRUCTIONS.match(/meteoswiss[A-Z][A-Za-z]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const name of new Set(named)) expect(tools.has(name), name).toBe(true);
    for (const name of new Set(sunFinderText({}).match(/meteoswiss[A-Z][A-Za-z]+/g) ?? [])) {
      expect(tools.has(name), name).toBe(true);
    }
  });

  it('lists sunFinder with its three optional arguments', async () => {
    const { prompts } = await client.listPrompts();
    const prompt = prompts.find((p) => p.name === 'sunFinder');
    expect(prompt?.arguments?.map((a) => [a.name, a.required ?? false])).toEqual([
      ['day', false],
      ['start', false],
      ['radius_km', false],
    ]);
    // The four regional prompts stay.
    expect(prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining(['wetterNordschweiz', 'wetterSchweiz', 'meteoSuisseRomande', 'meteoTicino'])
    );
  });

  it('fills the arguments into the prompt text', async () => {
    const result = await client.getPrompt({
      name: 'sunFinder',
      arguments: { day: 'Saturday', start: 'Bern', radius_km: '80' },
    });
    const text = result.messages[0]?.content.type === 'text' ? result.messages[0].content.text : '';
    expect(text).toContain('Saturday');
    expect(text).toContain('start from Bern');
    expect(text).toContain('up to 80 km');
    expect(text).toContain('radius_km: 80');
  });

  it('falls back to tomorrow, Zurich and 60 km, and caps the radius at 150', () => {
    expect(sunFinderText({})).toContain('sun tomorrow');
    expect(sunFinderText({})).toContain('start from Zurich');
    expect(sunFinderText({})).toContain('up to 60 km');
    expect(sunFinderText({ radius_km: '900' })).toContain('up to 150 km');
    expect(sunFinderText({ radius_km: 'far' })).toContain('up to 60 km');
  });
});

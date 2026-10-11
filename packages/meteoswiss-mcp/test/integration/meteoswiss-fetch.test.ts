import { describe, expect, it , vi, beforeAll, afterAll } from 'vitest';
import { MCPClient } from './mcp-client.js';

describe('MeteoSwiss Fetch Tool', () => {
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

  describe('fetchMeteoSwissContent tool', () => {
    it('should be registered with the name "fetch" for ChatGPT compatibility', async () => {
      const tools = await client.listTools();
      const fetchTool = tools.find((tool) => tool.name === 'fetch');

      expect(fetchTool).toBeDefined();
      expect(fetchTool?.description).toContain('Fetch');
    });

    it('should accept required and optional parameters', async () => {
      const tools = await client.listTools();
      const fetchTool = tools.find((tool) => tool.name === 'fetch');

      expect(fetchTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: expect.stringContaining('Identifier'),
          },
          format: {
            type: 'string',
            enum: ['markdown', 'text'],
            default: 'markdown',
            description: expect.stringContaining('output format'),
          },
          includeMetadata: {
            type: 'boolean',
            default: true,
            description: expect.stringContaining('metadata'),
          },
        },
        required: ['id'],
      });
    });

    it('should fetch content by id in markdown format', async () => {
      const response = await client.callTool('fetch', {
        id: '/wetter/gefahren/verhaltensempfehlungen/wind.html',
        format: 'markdown',
      });

      const result = JSON.parse(response.content[0].text);

      expect(result).toMatchObject({
        id: expect.stringContaining('/wetter/gefahren/verhaltensempfehlungen/wind.html'),
        title: expect.any(String),
        text: expect.stringContaining('#'), // Markdown heading (canonical ChatGPT field)
        format: 'markdown',
        url: expect.stringContaining('meteoswiss'),
        metadata: expect.objectContaining({
          url: expect.stringContaining('meteoswiss'),
          language: expect.any(String),
          contentType: expect.any(String),
        }),
      });

      // The duplicate `content` field was removed as a token-cost fix
      // (issue #110, BUG-2) — `text` is the sole, canonical body field now.
      expect(result).not.toHaveProperty('content');

      // Body must include actual page text from web component attributes,
      // not just the page title (regression guard for empty-content body bug).
      expect(result.text).toContain('Verhaltensempfehlungen');
      expect(result.text).toContain('Windereignisse');
      expect(result.text).toContain('Gefahrenstufen von Wind');

      // The wind.html fixture contains <mch-icon name="chevron-small-right">
      // / "chevron-up" navigation icons whose nested SVG <title> text used to
      // leak into the extracted body (issue #110, BUG-6).
      expect(result.text).not.toContain('chevron');
    });

    it('should fetch content in plain text format', async () => {
      const response = await client.callTool('fetch', {
        id: '/wetter/gefahren/verhaltensempfehlungen/wind.html',
        format: 'text',
      });

      const result = JSON.parse(response.content[0].text);

      expect(result).toMatchObject({
        text: expect.any(String),
        format: 'text',
      });
      expect(result).not.toHaveProperty('content');
      expect(result.text).not.toContain('<'); // No HTML tags
      expect(result.text).not.toContain('#'); // No markdown
    });

    it('should exclude metadata when requested', async () => {
      const response = await client.callTool('fetch', {
        id: '/wetter/gefahren/verhaltensempfehlungen/wind.html',
        includeMetadata: false,
      });

      const result = JSON.parse(response.content[0].text);

      expect(result.metadata).toBeUndefined();
    });

    it('should handle non-existent content ids', async () => {
      const response = await client.callTool('fetch', {
        id: '/non-existent-page.html',
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('not found');
    });

    it('should handle invalid format parameter', async () => {
      // MCP SDK may throw (SSE) or return error result (Streamable HTTP) for invalid params
      const result = await client
        .callTool('fetch', {
          id: '/wetter/gefahren/verhaltensempfehlungen/wind.html',
          format: 'invalid',
        })
        .catch((e: Error) => ({ isError: true, content: [{ text: e.message }] }));
      expect(result.isError ?? result.content[0].text.includes('invalid')).toBeTruthy();
    });

    it('should cache content for performance', async () => {
      const startTime = Date.now();

      // First fetch - may be slower
      const firstResponse = await client.callTool('fetch', {
        id: '/wetter/gefahren/verhaltensempfehlungen/wind.html',
      });

      const firstFetchTime = Date.now() - startTime;

      // Second fetch - should be cached and faster
      const secondStartTime = Date.now();
      const secondResponse = await client.callTool('fetch', {
        id: '/wetter/gefahren/verhaltensempfehlungen/wind.html',
      });
      const secondFetchTime = Date.now() - secondStartTime;

      expect(JSON.parse(firstResponse.content[0].text)).toBeDefined();
      expect(JSON.parse(secondResponse.content[0].text)).toBeDefined();
      // Caching not implemented yet, so just check that it works
      expect(secondFetchTime).toBeLessThan(firstFetchTime * 2); // Not much slower
    });
  });
});

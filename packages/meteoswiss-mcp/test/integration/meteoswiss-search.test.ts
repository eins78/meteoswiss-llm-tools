import { describe, expect, it , vi, beforeAll, afterAll } from 'vitest';
import { MCPClient } from './mcp-client.js';

describe('MeteoSwiss Search Tool', () => {
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

  describe('searchMeteoSwissContent tool', () => {
    it('should be registered with the name "search" for ChatGPT compatibility', async () => {
      const tools = await client.listTools();
      const searchTool = tools.find((tool) => tool.name === 'search');
      
      expect(searchTool).toBeDefined();
      expect(searchTool?.description).toContain('Search MeteoSwiss');
    });

    it('should accept required and optional parameters', async () => {
      const tools = await client.listTools();
      const searchTool = tools.find((tool) => tool.name === 'search');
      
      expect(searchTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: expect.stringContaining('search query')
          },
          language: {
            type: 'string',
            enum: ['de', 'fr', 'it', 'en'],
            description: expect.stringContaining('language')
          },
          contentType: {
            type: 'string',
            description: expect.stringContaining('content type')
          },
          page: {
            type: 'integer',
            description: expect.stringContaining('Page number')
          },
          sort: {
            type: 'string',
            enum: ['relevance', 'date-desc', 'date-asc'],
            description: expect.stringContaining('Sort order')
          }
        },
        required: ['query']
      });
      // pageSize was removed: the upstream API ignores it and always returns
      // a fixed 10 results per page (issue #110, DECISION-1).
      expect(searchTool?.inputSchema.properties).not.toHaveProperty('pageSize');
    });

    it('should search for content in German', async () => {
      const response = await client.callTool('search', {
        query: 'wetter',
        language: 'de'
      });

      expect(response.content).toBeDefined();
      expect(response.content[0].type).toBe('text');
      
      const result = JSON.parse(response.content[0].text);
      
      expect(result).toMatchObject({
        totalResults: expect.any(Number),
        page: 1,
        pageSize: expect.any(Number),
        results: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            title: expect.any(String),
            url: expect.any(String),
            description: expect.any(String),
            contentType: expect.any(String),
            lastModified: expect.any(String)
          })
        ])
      });
    });

    it('should search for content in French', async () => {
      const response = await client.callTool('search', {
        query: 'météo',
        language: 'fr'
      });

      const result = JSON.parse(response.content[0].text);
      
      expect(result).toMatchObject({
        totalResults: expect.any(Number),
        results: expect.arrayContaining([
          expect.objectContaining({
            title: expect.any(String),
            url: expect.any(String)
          })
        ])
      });
    });

    it('should support pagination with a fixed upstream page size of 10', async () => {
      // The "wetter" fixture has 12 docs, so page 1 is a full page of 10 and
      // page 2 holds the remaining 2 — this exercises the real start-offset
      // math (UPSTREAM_PAGE_SIZE) rather than a caller-requested pageSize,
      // which is no longer accepted (issue #110, DECISION-1).
      const firstPageResponse = await client.callTool('search', {
        query: 'wetter',
        language: 'de',
        page: 1
      });

      const secondPageResponse = await client.callTool('search', {
        query: 'wetter',
        language: 'de',
        page: 2
      });

      const firstPage = JSON.parse(firstPageResponse.content[0].text);
      const secondPage = JSON.parse(secondPageResponse.content[0].text);

      expect(firstPage.results.length).toBe(10);
      expect(firstPage.pageSize).toBe(10);
      expect(secondPage.results.length).toBe(2);
      expect(secondPage.pageSize).toBe(2);
      expect(firstPage.results[0].id).not.toBe(secondPage.results[0].id);
    });

    it('should support sorting by date', async () => {
      const response = await client.callTool('search', {
        query: 'wetter',
        language: 'de',
        sort: 'date-desc'
      });

      const result = JSON.parse(response.content[0].text);
      
      expect(result.results.length).toBeGreaterThan(0);
      
      // Check that results are sorted by date if we have multiple results
      if (result.results.length > 1) {
        for (let i = 1; i < result.results.length; i++) {
          const prevDate = new Date(result.results[i - 1].lastModified);
          const currDate = new Date(result.results[i].lastModified);
          expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
        }
      }
    });

    it('should handle empty search results', async () => {
      const response = await client.callTool('search', {
        query: 'xyznonexistentquery123',
        language: 'de'
      });

      const result = JSON.parse(response.content[0].text);

      expect(result).toMatchObject({
        totalResults: 0,
        results: []
      });
    });

    it('should echo the requested page when no fixtures exist for the language (PR #116 Copilot review)', async () => {
      // 'it' (Italian) has no fixture directory at all, so this hits the
      // final no-fixtures-found fallback in searchFromTestFixtures, which
      // used to hardcode `page: 1` regardless of what was requested.
      const response = await client.callTool('search', {
        query: 'wetter',
        language: 'it',
        page: 2
      });

      const result = JSON.parse(response.content[0].text);

      expect(result).toMatchObject({
        totalResults: 0,
        page: 2,
        pageSize: 0,
        results: []
      });
    });

    it('should handle invalid language gracefully', async () => {
      // MCP SDK may throw (SSE) or return error result (Streamable HTTP) for invalid params
      const result = await client
        .callTool('search', { query: 'weather', language: 'invalid' })
        .catch((e: Error) => ({ isError: true, content: [{ text: e.message }] }));
      expect(result.isError ?? result.content[0].text.includes('invalid')).toBeTruthy();
    });
  });
});
import { describe, it, expect , vi, beforeAll, afterAll } from 'vitest';
import { MCPClient } from './mcp-client.js';

describe('Search tool - Multi-word queries', () => {
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

  describe('Multi-word query handling', () => {
    it('should handle two-word queries without errors', async () => {
      const result = await client.callTool('search', {
        query: 'forecast accuracy',
        language: 'en',
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      
      // Parse the actual search results from the MCP response
      const content = result.content[0];
      expect(content.type).toBe('text');
      
      const searchResults = JSON.parse(content.text);
      // Fixture-backed query: assert real content, not just an array shape — an
      // empty array would otherwise pass and hide a regression (TEST-3).
      expect(searchResults.results.length).toBeGreaterThan(0);
      expect(searchResults.results[0].title.length).toBeGreaterThan(0);
      expect(searchResults.results[0].url.length).toBeGreaterThan(0);
    });

    it('should handle three-word queries without errors', async () => {
      const result = await client.callTool('search', {
        query: 'weather forecast snow',
        language: 'en',
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      
      const content = result.content[0];
      expect(content.type).toBe('text');
      
      const searchResults = JSON.parse(content.text);
      // Fixture-backed query: assert real content, not just an array shape — an
      // empty array would otherwise pass and hide a regression (TEST-3).
      expect(searchResults.results.length).toBeGreaterThan(0);
      expect(searchResults.results[0].title.length).toBeGreaterThan(0);
      expect(searchResults.results[0].url.length).toBeGreaterThan(0);
    });

    it('should handle four-word queries without errors', async () => {
      const result = await client.callTool('search', {
        query: 'snow forecast models prediction',
        language: 'en',
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      
      const content = result.content[0];
      expect(content.type).toBe('text');
      
      const searchResults = JSON.parse(content.text);
      // Fixture-backed query: assert real content, not just an array shape — an
      // empty array would otherwise pass and hide a regression (TEST-3).
      expect(searchResults.results.length).toBeGreaterThan(0);
      expect(searchResults.results[0].title.length).toBeGreaterThan(0);
      expect(searchResults.results[0].url.length).toBeGreaterThan(0);
    });

    it('should handle queries with special characters', async () => {
      const result = await client.callTool('search', {
        query: 'weather & climate',
        language: 'en',
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      
      const content = result.content[0];
      expect(content.type).toBe('text');
      
      const searchResults = JSON.parse(content.text);
      // Fixture-backed query: assert real content, not just an array shape — an
      // empty array would otherwise pass and hide a regression (TEST-3).
      expect(searchResults.results.length).toBeGreaterThan(0);
      expect(searchResults.results[0].title.length).toBeGreaterThan(0);
      expect(searchResults.results[0].url.length).toBeGreaterThan(0);
    });
  });
});
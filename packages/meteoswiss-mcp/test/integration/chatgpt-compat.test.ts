/**
 * ChatGPT Deep Research / Custom Connector compatibility regression suite.
 *
 * These tests pin the meteoswiss-mcp `search` and `fetch` tools to the
 * canonical contract that ChatGPT (Deep Research, Connectors, and Responses
 * API direct integration) requires. See:
 *
 *   docs/plans/2026-04-19-chatgpt-fetch-compat.md
 *
 * The contract (verbatim from the OpenAI cookbook + Vercel reference):
 *
 *   search(query: string)
 *     → { results: Array<{ id: string; title: string; text?: string; url: string }> }
 *
 *   fetch(id: string)
 *     → { id: string; title: string; text: string; url: string; metadata?: object | null }
 *
 *   MCP envelope: { content: [{ type: "text", text: "<JSON.stringify(payload)>" }] }
 *
 * Sources:
 *   - https://github.com/openai/openai-cookbook/blob/main/examples/deep_research_api/how_to_build_a_deep_research_mcp_server/main.py
 *   - https://github.com/vercel-labs/deep-research-server/blob/main/app/mcp/route.ts
 *   - https://developers.openai.com/api/docs/mcp
 *
 * The companion snapshot at test/__snapshots__/chatgpt-compat.test.ts.snap
 * captures the serialized tool manifest for `search` and `fetch`. Any future
 * rename, type change, or required-field shift will diff the snapshot and
 * force the reviewer to either approve the change (and confirm it's still
 * ChatGPT-compatible) or revert it.
 */
import { describe, expect, it , vi, beforeAll, afterAll } from 'vitest';
import { MCPClient } from './mcp-client.js';

const FIXTURE_FETCH_PATH = '/wetter/gefahren/verhaltensempfehlungen/wind.html';
const FIXTURE_SEARCH_QUERY = 'wetter';

/**
 * Deterministic serializer for a tool manifest entry, used by the snapshot
 * assertion. Strips zod-generated noise (e.g. `additionalProperties: false`
 * may shift between SDK patches) and sorts arrays/keys so the snapshot is
 * stable across non-meaningful churn.
 */
function normaliseToolManifest(tool: {
  name: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
}): Record<string, unknown> {
  const properties = tool.inputSchema?.properties ?? {};
  const sortedProps = Object.fromEntries(
    Object.keys(properties)
      .sort()
      .map((key) => {
        const prop = properties[key] as Record<string, unknown> | undefined;
        if (!prop) return [key, prop];
        // Keep only the fields ChatGPT actually reads + the description (so a
        // wording change forces a snapshot diff).
        const kept: Record<string, unknown> = {};
        for (const field of ['type', 'description', 'enum', 'default'] as const) {
          if (field in prop) kept[field] = prop[field];
        }
        return [key, kept];
      })
  );
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: tool.inputSchema?.type ?? 'object',
      properties: sortedProps,
      required: [...(tool.inputSchema?.required ?? [])].sort(),
    },
  };
}

type ToolManifest = {
  name: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
};

describe('ChatGPT Deep Research compatibility', () => {
  let client: MCPClient;
  let manifest: ToolManifest[];

  beforeAll(async () => {
    process.env.USE_TEST_FIXTURES = 'true';
    client = new MCPClient();
    await client.start();
    manifest = (await client.listTools()) as ToolManifest[];
  });

  afterAll(async () => {
    await client.stop();
    vi.restoreAllMocks();
  });

  describe('tool discovery (tools/list)', () => {
    it('exposes a tool named "search"', () => {
      const tool = manifest.find((t) => t.name === 'search');
      expect(tool).toBeDefined();
    });

    it('exposes a tool named "fetch"', () => {
      const tool = manifest.find((t) => t.name === 'fetch');
      expect(tool).toBeDefined();
    });

    it('declares search.inputSchema with required `query: string`', () => {
      const tool = manifest.find((t) => t.name === 'search');
      const props = tool?.inputSchema?.properties as
        | Record<string, { type?: string }>
        | undefined;
      expect(props?.query?.type).toBe('string');
      expect(tool?.inputSchema?.required).toContain('query');
    });

    it('declares fetch.inputSchema with required `id: string` (canonical ChatGPT shape)', () => {
      const tool = manifest.find((t) => t.name === 'fetch');
      const props = tool?.inputSchema?.properties as
        | Record<string, { type?: string }>
        | undefined;

      // The whole point of this test: ChatGPT calls fetch with {id: "..."}.
      // If this assertion fails, ChatGPT cannot call our fetch tool.
      expect(props?.id).toBeDefined();
      expect(props?.id?.type).toBe('string');
      expect(tool?.inputSchema?.required).toContain('id');

      // `url` was the v2.3.1 regression name — must NOT be the required field.
      expect(tool?.inputSchema?.required ?? []).not.toContain('url');
    });
  });

  describe('search tool runtime', () => {
    it('returns a ChatGPT-shaped payload when called with {query}', async () => {
      const response = await client.callTool('search', { query: FIXTURE_SEARCH_QUERY });

      // MCP envelope: content[] with type: "text".
      expect(response.content).toBeDefined();
      expect(response.content[0]?.type).toBe('text');
      expect(typeof response.content[0]?.text).toBe('string');

      // Body must be JSON-parseable.
      const body = JSON.parse(response.content[0].text);

      // ChatGPT looks for a `results` array.
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.length).toBeGreaterThan(0);

      // Each result must have id, title, url (per cookbook + Vercel reference).
      const first = body.results[0];
      expect(typeof first.id).toBe('string');
      expect(first.id.length).toBeGreaterThan(0);
      expect(typeof first.title).toBe('string');
      expect(first.title.length).toBeGreaterThan(0);
      expect(typeof first.url).toBe('string');
      expect(first.url).toMatch(/^https?:\/\//);
    });
  });

  describe('fetch tool runtime', () => {
    it('returns a ChatGPT-shaped payload when called with {id}', async () => {
      const response = await client.callTool('fetch', { id: FIXTURE_FETCH_PATH });

      // MCP envelope.
      expect(response.content).toBeDefined();
      expect(response.content[0]?.type).toBe('text');
      expect(typeof response.content[0]?.text).toBe('string');

      // Body must be JSON-parseable.
      const body = JSON.parse(response.content[0].text);

      // ChatGPT canonical shape: {id, title, text, url, metadata?}.
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(typeof body.title).toBe('string');
      expect(body.title.length).toBeGreaterThan(0);

      // `text` is the canonical body field. ChatGPT renders citations from it.
      expect(typeof body.text).toBe('string');
      expect(body.text.length).toBeGreaterThan(0);

      // `url` at the top level (not just in metadata) is the canonical citation field.
      expect(typeof body.url).toBe('string');
      expect(body.url).toMatch(/^https?:\/\//);
    });

    it('no longer includes the deprecated `content` alias', async () => {
      // `content` duplicated `text` byte-for-byte since v2.3.x and was kept
      // for one minor version as a back-compat alias (see
      // docs/plans/2026-04-19-chatgpt-fetch-compat.md §6.3). Removed as a
      // token-cost fix — `text` is the sole, canonical body field now
      // (issue #110, BUG-2).
      const response = await client.callTool('fetch', { id: FIXTURE_FETCH_PATH });
      const body = JSON.parse(response.content[0].text);
      expect(body).not.toHaveProperty('content');
    });

    it('rejects calls that omit the `id` argument', async () => {
      // MCP SDK either throws (Streamable HTTP path) or returns isError: true.
      // Either is acceptable per MCP 2025-11-25 §Error Handling.
      const result = await client
        .callTool('fetch', {})
        .catch((e: Error) => ({ isError: true, content: [{ text: e.message }] }));
      const failed =
        result.isError === true ||
        (typeof result.content?.[0]?.text === 'string' &&
          result.content[0].text.toLowerCase().includes('id'));
      expect(failed).toBe(true);
    });
  });

  describe('manifest snapshot', () => {
    it('matches the canonical ChatGPT tool-manifest shape', () => {
      const search = manifest.find((t) => t.name === 'search');
      const fetchTool = manifest.find((t) => t.name === 'fetch');
      expect(search).toBeDefined();
      expect(fetchTool).toBeDefined();
      expect({
        search: normaliseToolManifest(search!),
        fetch: normaliseToolManifest(fetchTool!),
      }).toMatchSnapshot();
    });
  });
});

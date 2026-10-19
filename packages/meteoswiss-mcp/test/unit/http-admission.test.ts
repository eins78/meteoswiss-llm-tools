/**
 * Admission controls of the Streamable HTTP transport: client identity for the
 * rate limiter, middleware order, batch handling and per-client session quota.
 * Each test starts a real listener on an ephemeral loopback port.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '../../src/server.js';
import {
  createHttpServer,
  type HttpServerInterface,
} from '../../src/transports/streamable-http.js';
import { validateEnv } from '../../src/support/environment-validation.js';

let running: HttpServerInterface | undefined;

afterEach(() => {
  running?.stop();
  running = undefined;
  vi.unstubAllEnvs();
});

/** Start a server with the given env overrides; returns its base URL. */
async function start(
  env: Record<string, string> = {},
  factory: () => McpServer = createServer
): Promise<string> {
  vi.stubEnv('BIND_ADDRESS', '127.0.0.1');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const config = validateEnv();
  running = await createHttpServer(factory, { port: 0, config });
  await running.start();
  const server = (running.app as unknown as { __server: { address(): AddressInfo } }).__server;
  return `http://127.0.0.1:${server.address().port}`;
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

const initialize = (id = 1) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'admission-test', version: '0.0.0' },
  },
});

/** POST an initialize; returns the response and its session id (if any). */
async function openSession(base: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify(initialize()),
  });
  await res.arrayBuffer();
  return { status: res.status, sessionId: res.headers.get('mcp-session-id') };
}

describe('TRUST_PROXY', () => {
  it('defaults to 0, so a rotating X-Forwarded-For does not reset the rate limit', async () => {
    const base = await start({ RATE_LIMIT_MAX_REQUESTS: '3' });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${base}/health`, {
        headers: { 'x-forwarded-for': `203.0.113.${i}` },
      });
      await res.arrayBuffer();
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
  });

  it('honours one proxy hop when TRUST_PROXY=1 is set explicitly', async () => {
    const base = await start({ RATE_LIMIT_MAX_REQUESTS: '1', TRUST_PROXY: '1' });
    for (const ip of ['203.0.113.1', '203.0.113.2']) {
      const res = await fetch(`${base}/health`, { headers: { 'x-forwarded-for': ip } });
      await res.arrayBuffer();
      expect(res.status).toBe(200);
    }
  });
});

describe('middleware order and request bodies', () => {
  it('refuses an over-quota client before parsing its body', async () => {
    const base = await start({ RATE_LIMIT_MAX_REQUESTS: '1' });
    await (await fetch(`${base}/health`)).arrayBuffer();
    // Malformed JSON would be a 400 from the parser; the limiter must answer first.
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: MCP_HEADERS, body: '{' });
    await res.arrayBuffer();
    expect(res.status).toBe(429);
  });

  it('answers malformed JSON with 400 Parse error, not 500', async () => {
    const base = await start();
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: MCP_HEADERS, body: '{' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: -32700 } });
  });

  it('refuses a compressed body with 415 instead of inflating it', async () => {
    const { gzipSync } = await import('node:zlib');
    const base = await start();
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'content-encoding': 'gzip' },
      body: gzipSync(JSON.stringify(initialize())),
    });
    await res.arrayBuffer();
    expect(res.status).toBe(415);
  });

  it('answers an oversize body with 413', async () => {
    const base = await start({ REQUEST_SIZE_LIMIT: '1kb' });
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({ ...initialize(), pad: 'x'.repeat(4096) }),
    });
    await res.arrayBuffer();
    expect(res.status).toBe(413);
  });
});

describe('JSON-RPC batches', () => {
  /** A batch of `n` stations calls (protocol 2025-11-25, inside an open session). */
  const batch = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      jsonrpc: '2.0',
      id: 100 + i,
      method: 'tools/call',
      params: { name: 'meteoswissStations', arguments: { search: 'Zürich' } },
    }));

  it('charges every message of a batch to the client rate-limit bucket', async () => {
    const base = await start({ RATE_LIMIT_MAX_REQUESTS: '10' });
    const { sessionId } = await openSession(base); // 1 hit
    const headers = {
      ...MCP_HEADERS,
      'mcp-session-id': sessionId!,
      'mcp-protocol-version': '2025-11-25',
    };
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch(20)),
    });
    await res.arrayBuffer();
    expect(res.status).toBe(429);
  });

  it('still serves a batch that fits in the remaining quota', async () => {
    const base = await start({ RATE_LIMIT_MAX_REQUESTS: '10' });
    const { sessionId } = await openSession(base);
    const headers = {
      ...MCP_HEADERS,
      'mcp-session-id': sessionId!,
      'mcp-protocol-version': '2025-11-25',
    };
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch(3)),
    });
    await res.arrayBuffer();
    expect(res.status).toBe(200);
    const after = await fetch(`${base}/health`);
    await after.arrayBuffer();
    // 1 initialize + 3 batch messages + this request = 5 of 10
    expect(after.headers.get('ratelimit-remaining')).toBe('5');
  });
});

describe('per-client session quota', () => {
  it('stops one client from taking every session slot', async () => {
    const base = await start({ MAX_SESSIONS: '3', MAX_SESSIONS_PER_CLIENT: '2', TRUST_PROXY: '1' });
    const attacker = { 'x-forwarded-for': '198.51.100.7' };
    expect((await openSession(base, attacker)).status).toBe(200);
    expect((await openSession(base, attacker)).status).toBe(200);
    expect((await openSession(base, attacker)).status).toBe(429);
    // The last global slot is still free for someone else.
    const other = await openSession(base, { 'x-forwarded-for': '198.51.100.8' });
    expect(other.status).toBe(200);
    expect(other.sessionId).toBeTruthy();
  });

  it('holds under concurrent initialize requests from one client', async () => {
    // Delay connect() by a timer so concurrent requests interleave between the
    // quota check and the session registration, as slow I/O would.
    const slowServer = (): McpServer => {
      const server = createServer();
      const connect = server.connect.bind(server);
      server.connect = async (transport) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return connect(transport);
      };
      return server;
    };
    const base = await start({ MAX_SESSIONS_PER_CLIENT: '2' }, slowServer);
    const results = await Promise.all(Array.from({ length: 40 }, () => openSession(base)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 429)).toHaveLength(38);
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.sessions).toBe(2);
  });

  it('frees the quota when the client closes a session', async () => {
    const base = await start({ MAX_SESSIONS_PER_CLIENT: '1' });
    const { sessionId } = await openSession(base);
    expect((await openSession(base)).status).toBe(429);
    const del = await fetch(`${base}/mcp`, {
      method: 'DELETE',
      headers: {
        ...MCP_HEADERS,
        'mcp-session-id': sessionId!,
        'mcp-protocol-version': '2025-11-25',
      },
    });
    await del.arrayBuffer();
    expect((await openSession(base)).status).toBe(200);
  });
});

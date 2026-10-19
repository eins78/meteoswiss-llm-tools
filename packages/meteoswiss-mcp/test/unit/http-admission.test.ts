/**
 * Admission controls of the Streamable HTTP transport: client identity for the
 * rate limiter, middleware order, batch handling and per-client session quota.
 * Each test starts a real listener on an ephemeral loopback port.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../src/server.js';
import { createHttpServer, type HttpServerInterface } from '../../src/transports/streamable-http.js';
import { validateEnv } from '../../src/support/environment-validation.js';

let running: HttpServerInterface | undefined;

afterEach(() => {
  running?.stop();
  running = undefined;
  vi.unstubAllEnvs();
});

/** Start a server with the given env overrides; returns its base URL. */
async function start(env: Record<string, string> = {}): Promise<string> {
  vi.stubEnv('BIND_ADDRESS', '127.0.0.1');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const config = validateEnv();
  running = await createHttpServer(createServer, { port: 0, config });
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
      const res = await fetch(`${base}/health`, { headers: { 'x-forwarded-for': `203.0.113.${i}` } });
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

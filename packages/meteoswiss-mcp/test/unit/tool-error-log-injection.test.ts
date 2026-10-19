/**
 * SEC-10 on the error path: a newline in a tool argument must not forge an
 * extra stderr line when the tool fails. Resolver errors embed the raw argument
 * in their message, so the catch blocks must log a sanitized single line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';

const FORGED = '[MCP Server Error] FORGED-LINE';

describe('tool error logging', () => {
  let client: Client;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'log-injection-test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    errorSpy.mockRestore();
  });

  /** Every stderr line written so far, split the way a log collector would. */
  const stderrLines = (): string[] =>
    errorSpy.mock.calls.flatMap((args) =>
      args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' ').split('\n')
    );

  it.each([
    ['meteoswissPollenData', { station: `QQQ\n${FORGED}` }],
    ['fetch', { id: `https://evil.example/\n${FORGED}` }],
  ])('%s: a newline in the argument stays inside one log line', async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    const lines = stderrLines();
    expect(lines.some((l) => l.includes('FORGED-LINE'))).toBe(true);
    expect(lines.filter((l) => l.startsWith(FORGED))).toEqual([]);
  });
});

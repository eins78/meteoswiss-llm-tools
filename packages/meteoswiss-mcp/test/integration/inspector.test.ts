import { afterEach, beforeEach, describe, expect, test } from 'vitest';
/**
 * Integration tests using MCP SDK client with Streamable HTTP transport
 */

import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as path from 'node:path';

const execAsync = promisify(exec);

describe('MCP Server Integration Tests', () => {
  let serverProcess: ChildProcess | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    // Clean up
    if (client) {
      await client.close();
      client = null;
    }
    if (serverProcess) {
      // Remove all listeners before killing
      serverProcess.removeAllListeners();
      if (serverProcess.stderr) {
        serverProcess.stderr.removeAllListeners();
      }
      if (serverProcess.stdout) {
        serverProcess.stdout.removeAllListeners();
      }
      serverProcess.kill();
      // Wait a bit for process to die
      await new Promise(resolve => setTimeout(resolve, 100));
      serverProcess = null;
    }
  });

  describe('HTTP Transport', () => {
    let serverUrl: string;

    beforeEach(async () => {
      // Start HTTP server using built JS
      const serverPath = path.join(process.cwd(), 'dist', 'index.js');
      serverProcess = spawn('node', [serverPath, '13456'], {
        env: { ...process.env, USE_TEST_FIXTURES: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: false,
      });

      // Wait for server to start by checking logs
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Server failed to start in time'));
        }, 10000);

        let buffer = '';
        const dataHandler = (data: Buffer) => {
          const output = data.toString();
          buffer += output;
          console.log('Server output:', output);
          if (buffer.includes('MCP server running at')) {
            clearTimeout(timeout);
            // Clean up listeners
            serverProcess!.stdout!.removeListener('data', dataHandler);
            serverProcess!.stderr!.removeListener('data', stderrHandler);
            serverProcess!.removeListener('error', errorHandler);
            // Give the server a moment to fully initialize
            setTimeout(resolve, 2000);
          }
        };

        // Monitor stderr for errors
        const stderrHandler = (data: Buffer) => {
          console.log('Server stderr:', data.toString());
        };

        const errorHandler = (err: Error) => {
          clearTimeout(timeout);
          serverProcess!.stdout!.removeListener('data', dataHandler);
          serverProcess!.stderr!.removeListener('data', stderrHandler);
          reject(err);
        };

        serverProcess!.stdout!.on('data', dataHandler);
        serverProcess!.stderr!.on('data', stderrHandler);
        serverProcess!.on('error', errorHandler);
      });

      serverUrl = 'http://localhost:13456';
    });

    test('should connect via HTTP and list tools', async () => {
      console.log('Testing server health endpoint...');

      // Check if server process is still running
      if (serverProcess?.killed || serverProcess?.exitCode !== null) {
        throw new Error(`Server process exited with code ${serverProcess?.exitCode}`);
      }

      // Add retry logic for health check
      let healthResponse;
      let retries = 5;
      while (retries > 0) {
        try {
          healthResponse = await fetch(`${serverUrl}/health`);
          break;
        } catch (err) {
          console.log(`Health check failed, retries left: ${retries - 1}`, err);
          if (retries === 1) throw err;
          await new Promise(resolve => setTimeout(resolve, 1000));
          retries--;
        }
      }

      const health = await healthResponse!.json();
      console.log('Health check passed:', health);

      expect(health).toMatchObject({
        status: 'ok',
        version: expect.any(String),
        sessions: expect.any(Number),
        endpoint: expect.stringMatching(/^https?:\/\/[^\/]+\/mcp$/),
      });

      // Now test actual MCP connection using Streamable HTTP transport
      console.log('Creating Streamable HTTP transport...');
      const transport = new StreamableHTTPClientTransport(new URL(`${serverUrl}/mcp`));

      console.log('Creating MCP client...');
      client = new Client(
        {
          name: 'test-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      console.log('Connecting client to transport...');
      await client.connect(transport);
      console.log('Client connected successfully');

      // List tools
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(7);

      // Check that we have all tools
      const toolNames = tools.tools.map(t => t.name);
      expect(toolNames).toContain('search');
      expect(toolNames).toContain('fetch');
      expect(toolNames).toContain('meteoswissLocalForecast');
      expect(toolNames).toContain('meteoswissCurrentWeather');
      expect(toolNames).toContain('meteoswissStations');
      expect(toolNames).toContain('meteoswissPollenData');
      expect(toolNames).toContain('meteoswissClimateData');
    });

  });
});

describe('MCP Inspector CLI Tests', () => {
  let serverProcess: ChildProcess | null = null;

  afterEach(async () => {
    if (serverProcess) {
      // Remove all listeners before killing
      serverProcess.removeAllListeners();
      if (serverProcess.stderr) {
        serverProcess.stderr.removeAllListeners();
      }
      if (serverProcess.stdout) {
        serverProcess.stdout.removeAllListeners();
      }
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 100));
      serverProcess = null;
    }
  });

  test.skip('should call tool via inspector CLI against HTTP server', async () => {
    // Start HTTP server using built JS
    const serverPath = path.join(process.cwd(), 'dist', 'index.js');
    serverProcess = spawn('node', [serverPath, '13457'], {
      env: { ...process.env, USE_TEST_FIXTURES: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: false,
    });

    // Wait for server to start
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 5000);
      let buffer = '';
      serverProcess!.stderr!.on('data', (data: Buffer) => {
        buffer += data.toString();
        if (buffer.includes('MCP server listening')) {
          clearTimeout(timeout);
          // Give the server a moment to fully initialize
          setTimeout(resolve, 500);
        }
      });
    });

    // Run inspector CLI command
    const { stdout, stderr } = await execAsync(
      `npx @modelcontextprotocol/inspector --cli http://localhost:13457/mcp --method tools/call --tool-name meteoswissLocalForecast --tool-arg location=Zurich --tool-arg days=2`,
      {
        env: { ...process.env },
        timeout: 10000,
      }
    ).catch(err => ({
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
    }));

    // Check for successful response
    const output = stdout || stderr;
    expect(output).toContain('Zurich'); // Should contain the location
    expect(output).toContain('forecast'); // Should contain forecast data
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createServer } from '../../src/server.js';
import { createHttpServer } from '../../src/transports/streamable-http.js';
import { validateEnv } from '../../src/support/environment-validation.js';

describe('Hostname Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let server: { start: () => Promise<void>; stop: () => void } | null = null;
  let httpServer: http.Server | null = null;
  
  beforeEach(() => {
    originalEnv = { ...process.env };
  });
  
  afterEach(async () => {
    process.env = originalEnv;
    if (server) {
      server.stop();
      server = null;
    }
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer!.close(() => resolve());
      });
      httpServer = null;
    }
  });
  
  const setupServer = async (envOverrides: Partial<NodeJS.ProcessEnv> = {}) => {
    // Apply environment overrides
    Object.assign(process.env, envOverrides);
    
    // Validate environment and create server
    const config = validateEnv();
    const mcpServer = createServer();
    const result = await createHttpServer(mcpServer, {
      port: 0, // Use random port for testing
      host: config.BIND_ADDRESS,
      config
    });
    
    server = result;
    
    // Start the server and get the actual port
    await server.start();
    httpServer = (result.app as any).__server as http.Server;
    const address = httpServer.address() as { port: number };
    const actualPort = address.port;
    
    return { port: actualPort, config };
  };

  const makeRequest = (port: number, path: string, headers: Record<string, string> = {}) => {
    return new Promise<{ status: number; body: any; text: string }>((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port,
        path,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...headers
        }
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let body: any;
          try {
            body = JSON.parse(data);
          } catch {
            body = null;
          }
          resolve({
            status: res.statusCode || 0,
            body,
            text: data
          });
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  };

  describe('Default URL configuration', () => {
    it('should default to localhost when PUBLIC_URL is not set', async () => {
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const response = await makeRequest(port, '/');

      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('http://localhost:3000/mcp');
    });
    
    it('should use correct protocol and port in default URLs', async () => {
      process.env.PORT = '8080';
      
      const { port } = await setupServer();
      const response = await makeRequest(port, '/');

      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('http://localhost:8080/mcp');
      expect(response.body.usage).toContain('http://localhost:8080/mcp');
    });
  });

  describe('PUBLIC_URL configuration', () => {
    it('should use PUBLIC_URL when set', async () => {
      process.env.PUBLIC_URL = 'https://api.example.com:8443';
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const response = await makeRequest(port, '/');

      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('https://api.example.com:8443/mcp');
      expect(response.body.usage).toContain('https://api.example.com:8443/mcp');
    });

    it('should handle PUBLIC_URL without port', async () => {
      process.env.PUBLIC_URL = 'https://api.example.com';
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const response = await makeRequest(port, '/');

      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('https://api.example.com/mcp');
    });
  });

  describe('Health endpoint', () => {
    it('should return correct endpoint URL in health check', async () => {
      process.env.PORT = '9000';
      
      const { port } = await setupServer();
      const response = await makeRequest(port, '/health');

      expect(response.status).toBe(200);
      expect(response.body.endpoint).toBe('http://localhost:9000/mcp');
    });

    it('should use PUBLIC_URL in health check when set', async () => {
      process.env.PUBLIC_URL = 'https://public.example.com';
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const response = await makeRequest(port, '/health');

      expect(response.status).toBe(200);
      expect(response.body.endpoint).toBe('https://public.example.com/mcp');
    });
  });

  describe('HTML homepage', () => {
    it('should display correct MCP endpoint in HTML', async () => {
      process.env.PORT = '8080';
      
      const { port } = await setupServer();
      const response = await makeRequest(port, '/', { 'Accept': 'text/html' });

      expect(response.status).toBe(200);
      expect(response.text).toContain('http://localhost:8080/mcp');
    });
    
    it('should display PUBLIC_URL in HTML when set', async () => {
      process.env.PUBLIC_URL = 'https://demo.example.com';
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const response = await makeRequest(port, '/', { 'Accept': 'text/html' });

      expect(response.status).toBe(200);
      expect(response.text).toContain('https://demo.example.com/mcp');
    });
  });
});
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createServer } from '../../src/server.js';
import { createHttpServer } from '../../src/transports/streamable-http.js';
import { validateEnv } from '../../src/support/environment-validation.js';

describe('Port Mapping Configuration', () => {
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
  
  const setupServer = async (internalPort: number = 0) => {
    // Validate environment and create server
    const config = validateEnv();
    const mcpServer = createServer();
    const result = await createHttpServer(mcpServer, {
      port: internalPort, // Use specified port or 0 for random
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

  const makeRequest = (port: number, path: string) => {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port,
        path,
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: JSON.parse(data)
          });
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  };

  describe('Docker port mapping scenarios', () => {
    it('should handle internal port 3000 mapped to external port 8000', async () => {
      // Simulate Docker environment where internal port 3000 is mapped to external 8000
      process.env.PORT = '3000';
      process.env.PUBLIC_URL = 'http://example.com:8000';
      
      // Server listens on port 3000 internally
      const { port } = await setupServer(3000);
      expect(port).toBe(3000);
      
      // But URLs should show the external port 8000
      const response = await makeRequest(port, '/');
      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('http://example.com:8000/mcp');
      
      const healthResponse = await makeRequest(port, '/health');
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body.endpoint).toBe('http://example.com:8000/mcp');
    });

    it('should default to localhost when only PORT is set', async () => {
      process.env.PORT = '3000';
      
      const { port } = await setupServer(0); // Use random port to avoid conflicts
      
      const response = await makeRequest(port, '/');
      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('http://localhost:3000/mcp');
    });

    it('should handle HTTPS URLs with port mapping', async () => {
      process.env.PORT = '3000';
      process.env.PUBLIC_URL = 'https://secure.example.com:8443';
      
      const { port } = await setupServer();
      
      const response = await makeRequest(port, '/');
      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('https://secure.example.com:8443/mcp');
    });

    it('should work correctly without port mapping', async () => {
      process.env.PORT = '3000';
      
      const { port } = await setupServer(3000);
      
      const response = await makeRequest(port, '/');
      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('http://localhost:3000/mcp');
    });

    it('should handle PUBLIC_URL without explicit port', async () => {
      process.env.PORT = '3000';
      process.env.PUBLIC_URL = 'https://api.example.com';
      
      const { port } = await setupServer();
      
      const response = await makeRequest(port, '/');
      expect(response.status).toBe(200);
      expect(response.body.mcp_endpoint).toBe('https://api.example.com/mcp');
    });
  });

  describe('Server binding behavior', () => {
    it('should bind to configured PORT regardless of PUBLIC_URL', async () => {
      process.env.PORT = '5678';
      process.env.PUBLIC_URL = 'http://external.com:9999';
      
      // Server should bind to 5678, not 9999
      const { port } = await setupServer(5678);
      expect(port).toBe(5678);
      
      // But URLs should use the PUBLIC_URL
      const response = await makeRequest(port, '/');
      expect(response.body.mcp_endpoint).toBe('http://external.com:9999/mcp');
    });

    it('should bind to 0.0.0.0 by default for Docker compatibility', async () => {
      // Default BIND_ADDRESS should be 0.0.0.0
      const { config } = await setupServer();
      expect(config.BIND_ADDRESS).toBe('0.0.0.0');
    });
  });
});
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createServer } from '../../src/server.js';
import { createHttpServer } from '../../src/transports/streamable-http.js';
import { validateEnv } from '../../src/support/environment-validation.js';

describe('Template Replacement in Homepage', () => {
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
  
  const setupServer = async () => {
    const config = validateEnv();
    const mcpServer = createServer();
    const result = await createHttpServer(mcpServer, {
      port: 0, // Use random port for testing
      host: config.BIND_ADDRESS,
      config
    });
    
    server = result;
    await server.start();
    httpServer = (result.app as any).__server as http.Server;
    const address = httpServer.address() as { port: number };
    
    return { port: address.port, config };
  };

  const fetchHomepage = (port: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port,
        path: '/',
        method: 'GET',
        headers: {
          'Accept': 'text/html'
        }
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(data);
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  };

  describe('Default URLs', () => {
    it('should replace template variables with default localhost URLs', async () => {
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const html = await fetchHomepage(port);
      
      // Check that templates are replaced
      expect(html).not.toContain('$$$___TEMPLATE_BASE_URL___$$$');
      expect(html).not.toContain('$$$___TEMPLATE_MCP_URL___$$$');
      
      // Check correct replacements
      expect(html).toContain('http://localhost:3000/mcp');
      // JSON in HTML is entity-encoded
      expect(html).toContain('&quot;args&quot;: [&quot;mcp-remote&quot;, &quot;http://localhost:3000/mcp&quot;]');
    });
    
    it('should use correct port in template replacement', async () => {
      process.env.PORT = '8080';
      
      const { port } = await setupServer();
      const html = await fetchHomepage(port);
      
      expect(html).toContain('http://localhost:8080/mcp');
      expect(html).toContain('<code>http://localhost:8080</code>');
      expect(html).toContain('<code>http://localhost:8080/mcp</code>');
    });
  });

  describe('PUBLIC_URL configuration', () => {
    it('should use PUBLIC_URL in template replacement', async () => {
      process.env.PUBLIC_URL = 'https://meteoswiss.example.com';
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const html = await fetchHomepage(port);
      
      // Check replacements use PUBLIC_URL
      expect(html).toContain('https://meteoswiss.example.com/mcp');
      expect(html).toContain('<code>https://meteoswiss.example.com</code>');
      expect(html).toContain('<code>https://meteoswiss.example.com/mcp</code>');
      expect(html).toContain('&quot;args&quot;: [&quot;mcp-remote&quot;, &quot;https://meteoswiss.example.com/mcp&quot;]');
      
      // Should not contain localhost
      expect(html).not.toContain('localhost:3000');
    });
    
    it('should handle PUBLIC_URL with custom port', async () => {
      process.env.PUBLIC_URL = 'https://api.example.com:8443';
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const html = await fetchHomepage(port);
      
      expect(html).toContain('https://api.example.com:8443/mcp');
      expect(html).toContain('<code>https://api.example.com:8443</code>');
    });
  });

  describe('Template security', () => {
    it('should not allow injection through PUBLIC_URL', async () => {
      // Try to inject HTML/script through PUBLIC_URL
      process.env.PUBLIC_URL = 'http://example.com"></script><script>alert("xss")</script>';
      process.env.PORT = '3000';
      
      const { port } = await setupServer();
      const html = await fetchHomepage(port);
      
      // The URL should be rendered safely
      // Check that the dangerous script tag is escaped in the rendered HTML
      expect(html).toContain('http://example.com&quot;&gt;&lt;/script&gt;&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });
  });
});
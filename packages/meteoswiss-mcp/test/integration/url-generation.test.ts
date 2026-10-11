import { beforeEach, describe, expect, it } from 'vitest';
import { getServiceBaseUrl, getMcpEndpointUrl, getHealthEndpointUrl } from '../../src/support/url-generation.js';
import type { EnvConfig } from '../../src/support/environment-validation.js';

describe('URL Generation', () => {
  let baseConfig: EnvConfig;
  
  beforeEach(() => {
    // Base configuration with all required fields
    baseConfig = {
      PORT: 3000,
      USE_TEST_FIXTURES: false,
      DEBUG_MCHMCP: false,
      BIND_ADDRESS: '0.0.0.0',
      NODE_ENV: 'test',
      MAX_SESSIONS: 100,
      SESSION_TIMEOUT_MS: 300000,
      RATE_LIMIT_WINDOW_MS: 60000,
      RATE_LIMIT_MAX_REQUESTS: 100,
      CORS_ORIGIN: '*',
      REQUEST_SIZE_LIMIT: '10mb',
      PUBLIC_URL: undefined,
    };
  });
  
  describe('getServiceBaseUrl', () => {
    it('should use PUBLIC_URL when set', () => {
      const config = { ...baseConfig, PUBLIC_URL: 'https://example.com' };
      expect(getServiceBaseUrl(config)).toBe('https://example.com');
    });
    
    it('should remove trailing slash from PUBLIC_URL', () => {
      const config = { ...baseConfig, PUBLIC_URL: 'https://example.com/' };
      expect(getServiceBaseUrl(config)).toBe('https://example.com');
    });
    
    it('should default to localhost when PUBLIC_URL is not set', () => {
      const config = { ...baseConfig, PORT: 3000 };
      expect(getServiceBaseUrl(config)).toBe('http://localhost:3000');
    });
    
    it('should omit port 80 from http URLs', () => {
      const config = { ...baseConfig, PORT: 80 };
      expect(getServiceBaseUrl(config)).toBe('http://localhost');
    });
    
    it('should use https and omit port 443', () => {
      const config = { ...baseConfig, PORT: 443 };
      expect(getServiceBaseUrl(config)).toBe('https://localhost');
    });
    
    it('should use non-standard ports in URL', () => {
      const config = { ...baseConfig, PORT: 8080 };
      expect(getServiceBaseUrl(config)).toBe('http://localhost:8080');
    });
  });
  
  describe('getMcpEndpointUrl', () => {
    it('should append /mcp to base URL', () => {
      const config = { ...baseConfig, PORT: 3000 };
      expect(getMcpEndpointUrl(config)).toBe('http://localhost:3000/mcp');
    });
    
    it('should work with PUBLIC_URL', () => {
      const config = { ...baseConfig, PUBLIC_URL: 'https://api.example.com' };
      expect(getMcpEndpointUrl(config)).toBe('https://api.example.com/mcp');
    });
  });
  
  describe('getHealthEndpointUrl', () => {
    it('should append /health to base URL', () => {
      const config = { ...baseConfig, PORT: 3000 };
      expect(getHealthEndpointUrl(config)).toBe('http://localhost:3000/health');
    });
    
    it('should work with PUBLIC_URL', () => {
      const config = { ...baseConfig, PUBLIC_URL: 'https://api.example.com' };
      expect(getHealthEndpointUrl(config)).toBe('https://api.example.com/health');
    });
  });
});
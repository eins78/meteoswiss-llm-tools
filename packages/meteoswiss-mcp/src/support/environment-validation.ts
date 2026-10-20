import { z } from 'zod';
import { debugEnv } from './logging.js';

/**
 * Environment variable schema and validation
 */
const envSchema = z.object({
  PORT: z
    .string()
    .optional()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val <= 65535, {
      message: 'PORT must be a valid port number between 1 and 65535',
    }),
  USE_TEST_FIXTURES: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),
  DEBUG_MCHMCP: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),
  BIND_ADDRESS: z
    .string()
    .optional()
    .default('0.0.0.0')
    .refine(
      (val) => {
        // Basic IP address validation
        const parts = val.split('.');
        if (val === 'localhost' || val === '::1' || val === '::' || val === '0.0.0.0') {
          return true;
        }
        if (parts.length !== 4) return false;
        return parts.every((part) => {
          const num = parseInt(part, 10);
          return !isNaN(num) && num >= 0 && num <= 255;
        });
      },
      {
        message: 'BIND_ADDRESS must be a valid IP address or hostname',
      }
    ),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('production'),
  MAX_SESSIONS: z
    .string()
    .optional()
    .default('100')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'MAX_SESSIONS must be a positive number',
    }),
  MAX_SESSIONS_PER_CLIENT: z
    .string()
    .optional()
    .default('10')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'MAX_SESSIONS_PER_CLIENT must be a positive number',
    }),
  SESSION_TIMEOUT_MS: z
    .string()
    .optional()
    .default('300000') // 5 minutes
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'SESSION_TIMEOUT_MS must be a positive number',
    }),
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .optional()
    .default('60000') // 1 minute
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'RATE_LIMIT_WINDOW_MS must be a positive number',
    }),
  RATE_LIMIT_MAX_REQUESTS: z
    .string()
    .optional()
    .default('100')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'RATE_LIMIT_MAX_REQUESTS must be a positive number',
    }),
  CORS_ORIGIN: z.string().optional().default('*'),
  REQUEST_SIZE_LIMIT: z.string().optional().default('10mb'),
  TRUST_PROXY: z
    .string()
    .optional()
    .default('0') // trusted proxy hops in front of the app; set 1 behind one reverse proxy (Caddy)
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 0, {
      message: 'TRUST_PROXY must be a non-negative integer (number of proxy hops)',
    }),
  MAX_RESPONSE_BYTES: z
    .string()
    .optional()
    .default('52428800') // 50 MiB — hard ceiling on any single upstream response body
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'MAX_RESPONSE_BYTES must be a positive number',
    }),
  PUBLIC_URL: z
    .string()
    .optional()
    .describe('Full public URL including protocol and port for URL generation'),
  METRICS_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates and parses environment variables
 * @throws {Error} If validation fails
 */
export function validateEnv(): EnvConfig {
  debugEnv('Starting environment validation');
  debugEnv('Raw environment variables: %O', {
    PORT: process.env.PORT,
    USE_TEST_FIXTURES: process.env.USE_TEST_FIXTURES,
    DEBUG_MCHMCP: process.env.DEBUG_MCHMCP,
    DEBUG: process.env.DEBUG,
    NODE_ENV: process.env.NODE_ENV,
    BIND_ADDRESS: process.env.BIND_ADDRESS,
    MAX_SESSIONS: process.env.MAX_SESSIONS,
    MAX_SESSIONS_PER_CLIENT: process.env.MAX_SESSIONS_PER_CLIENT,
    SESSION_TIMEOUT_MS: process.env.SESSION_TIMEOUT_MS,
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    REQUEST_SIZE_LIMIT: process.env.REQUEST_SIZE_LIMIT,
    TRUST_PROXY: process.env.TRUST_PROXY,
    MAX_RESPONSE_BYTES: process.env.MAX_RESPONSE_BYTES,
    PUBLIC_URL: process.env.PUBLIC_URL,
    METRICS_ENABLED: process.env.METRICS_ENABLED,
  });

  try {
    const config = envSchema.parse(process.env);
    debugEnv('Environment validation successful: %O', config);
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((e) => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(
        `Environment variable validation failed:\n${issues}\n\nExample configuration:\n` +
          `  PORT=3000\n` +
          `  USE_TEST_FIXTURES=false\n` +
          `  DEBUG_MCHMCP=false\n` +
          `  BIND_ADDRESS=0.0.0.0\n` +
          `  NODE_ENV=production\n` +
          `  MAX_SESSIONS=100\n` +
          `  MAX_SESSIONS_PER_CLIENT=10\n` +
          `  SESSION_TIMEOUT_MS=300000\n` +
          `  RATE_LIMIT_WINDOW_MS=60000\n` +
          `  RATE_LIMIT_MAX_REQUESTS=100\n` +
          `  CORS_ORIGIN=https://example.com\n` +
          `  REQUEST_SIZE_LIMIT=10mb`,
        { cause: error }
      );
    }
    throw error;
  }
}

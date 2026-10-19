/**
 * Streamable HTTP transport for MCP server
 *
 * Implements the MCP Streamable HTTP transport specification using
 * {@link StreamableHTTPServerTransport} from the MCP SDK.
 *
 * Endpoint structure:
 * - `POST /mcp` - Client sends JSON-RPC requests, server responds (possibly as SSE stream)
 * - `GET /mcp` - Client opens SSE stream for server-to-client notifications
 * - `DELETE /mcp` - Client terminates session
 *
 * Each session gets its own transport instance and its own McpServer instance,
 * because the MCP SDK's Protocol class only allows one transport per server.
 * The {@link SessionManager} tracks transports for cleanup.
 */

import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import { SessionManager } from '../support/session-management.js';
import type { EnvConfig } from '../support/environment-validation.js';
import { renderHomepage } from '../support/markdown-rendering.js';
import { debugTransport } from '../support/logging.js';
import { metricsEnabled, register, recordRequest } from '../support/metrics.js';
import { getMcpEndpointUrl } from '../support/url-generation.js';
import { getVersion } from '../support/version.js';

interface StreamableHttpOptions {
  port?: number;
  host?: string;
  config: EnvConfig;
}

/**
 * Tool names advertised on the informational `/` endpoint. Kept as a single
 * source so the two JSON responses (HTML-fallback and API) cannot drift, and so
 * a newly registered tool (e.g. meteoswissClimateData, previously omitted here)
 * is easy to add in one place. Mirrors the tools registered in server.ts.
 */
const ADVERTISED_TOOLS = [
  'meteoswissLocalForecast',
  'meteoswissCurrentWeather',
  'meteoswissStations',
  'meteoswissPollenData',
  'meteoswissClimateData',
  'search',
  'fetch',
] as const;

/** Error shape raised by Express's body parser (`type` such as `entity.too.large`). */
interface BodyParserError {
  status: number;
  type: string;
}

/** Type guard for {@link BodyParserError}: a 4xx error carrying a body-parser `type`. */
function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    'type' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500 &&
    typeof err.type === 'string'
  );
}

/** HTTP server interface returned by {@link createHttpServer} */
export interface HttpServerInterface {
  app: express.Application;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Create a new {@link StreamableHTTPServerTransport}, pair it with a fresh
 * MCP server (from the factory), and register the session in the manager.
 *
 * The MCP SDK's Protocol class supports only one transport at a time, so each
 * concurrent session needs its own McpServer + transport pair.
 *
 * @returns The newly created transport (already connected to its own McpServer)
 */
async function createAndRegisterTransport(
  createMcpServer: () => McpServer,
  sessionManager: SessionManager,
  clientKey: string
): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      debugTransport('Session initialized: %s', sessionId);
      sessionManager.add(sessionId, transport, clientKey);
      console.error(`New session initialized: ${sessionId}`);
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      debugTransport('Transport closed, removing session: %s', sid);
      sessionManager.remove(sid);
    }
  };

  transport.onerror = (error: Error) => {
    debugTransport('Transport error: %O', error);
  };

  // Each transport gets its own MCP server instance
  const mcpServer = createMcpServer();
  try {
    await mcpServer.connect(transport);
  } catch (error) {
    // Clean up if connect fails after onsessioninitialized was called
    await transport.close();
    throw error;
  }
  debugTransport('Transport connected to MCP server');
  return transport;
}

/**
 * Create HTTP server with Streamable HTTP transport.
 *
 * @param createMcpServer - Factory function that creates a configured McpServer instance.
 *   Called once per session because the SDK only allows one transport per server.
 * @param options - Server configuration
 */
export async function createHttpServer(
  createMcpServer: () => McpServer,
  options: StreamableHttpOptions
): Promise<HttpServerInterface> {
  const { port = 3000, host = 'localhost', config } = options;
  debugTransport('Creating HTTP server on port %d, host %s', port, host);
  debugTransport('Configuration: %O', config);

  /** The Node HTTP listener, retained so stop() can close it. */
  let httpServer: ReturnType<express.Application['listen']> | undefined;

  const app = express();

  // Behind a reverse proxy (Caddy), TRUST_PROXY=1 makes `req.ip` the real client
  // from X-Forwarded-For instead of the proxy address. The default is 0: a client
  // that reaches the listener directly could otherwise rotate X-Forwarded-For to
  // get a fresh rate-limit and session bucket per request. A fixed hop count is
  // used deliberately — `trust proxy: true` would trust any forged chain.
  app.set('trust proxy', config.TRUST_PROXY);

  // Configure CORS for production.
  // credentials is deliberately false: this is a public, read-only service with
  // no cookies/auth, and reflecting an arbitrary Origin *with* credentials is the
  // exact combination the CORS spec forbids for wildcards — a latent footgun the
  // day any credentialed response is added (SEC-7).
  app.use(
    cors({
      origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN,
      credentials: false,
    })
  );

  // Configure rate limiting. The store and key are explicit so the batch check
  // below can charge extra messages to the same client bucket.
  const rateLimitStore = new MemoryStore();
  const rateLimitKey = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown');
  const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    store: rateLimitStore,
    keyGenerator: rateLimitKey,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      debugTransport('Rate limit exceeded for IP: %s', req.ip);
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
  });

  // Apply rate limiting to all routes. It runs before the body parser, so a
  // client over its quota is refused before the server reads or parses its body.
  app.use(limiter);

  // Parse JSON bodies only where they are read (POST /mcp), with the size limit
  // applied to the bytes on the wire. Compressed bodies are refused (415) rather
  // than inflated: MCP clients do not compress requests, and inflating would let
  // a small body cost up to REQUEST_SIZE_LIMIT of CPU and memory.
  app.use('/mcp', express.json({ limit: config.REQUEST_SIZE_LIMIT, inflate: false }));

  // Request counting (before route handlers)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    recordRequest(req.method);
    next();
  });

  // Global error handler for async routes
  const asyncHandler =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };

  // A JSON-RPC batch carries up to 100 messages in one HTTP request, and the SDK
  // runs each one. The limiter counted the request once; charge every further
  // message to the same bucket so a batch cannot multiply the per-client quota.
  app.use(
    '/mcp',
    asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      const body: unknown = req.body;
      if (req.method !== 'POST' || !Array.isArray(body) || body.length <= 1) {
        next();
        return;
      }
      const key = rateLimitKey(req);
      let totalHits = 0;
      for (let i = 1; i < body.length; i++) {
        totalHits = (await rateLimitStore.increment(key)).totalHits;
      }
      if (totalHits > config.RATE_LIMIT_MAX_REQUESTS) {
        debugTransport('Rate limit exceeded by a %d-message batch for IP: %s', body.length, req.ip);
        res.status(429).json({ error: 'Too many requests, please try again later.' });
        return;
      }
      next();
    })
  );

  // Initialize requests per client that passed the quota check but have not
  // registered their session yet (see the per-client quota in POST /mcp).
  const pendingInitByClient = new Map<string, number>();

  // Session manager for transport cleanup
  const sessionManager = new SessionManager(config.MAX_SESSIONS, config.SESSION_TIMEOUT_MS);
  debugTransport(
    'Session manager created with max sessions: %d, timeout: %dms',
    config.MAX_SESSIONS,
    config.SESSION_TIMEOUT_MS
  );

  // Root endpoint - serves HTML documentation
  app.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      debugTransport('Root endpoint accessed, Accept: %s', req.get('Accept'));
      // Check if client wants JSON (API clients)
      if (req.accepts('json') && !req.accepts('html')) {
        res.json({
          name: 'MeteoSwiss MCP Server',
          version: getVersion(),
          description: 'Model Context Protocol server for MeteoSwiss weather data',
          mcp_endpoint: getMcpEndpointUrl(config),
          usage: `npx mcp-remote ${getMcpEndpointUrl(config)}`,
          health: `/health`,
          capabilities: {
            tools: ADVERTISED_TOOLS,
            prompts: ['wetterNordschweiz', 'wetterSchweiz', 'meteoSuisseRomande', 'meteoTicino'],
          },
        });
        return;
      }

      // Serve HTML homepage
      try {
        const html = await renderHomepage();
        res.type('html').send(html);
      } catch (error) {
        console.error('Failed to render homepage:', error);
        // Fallback to JSON
        res.json({
          name: 'MeteoSwiss MCP Server',
          version: getVersion(),
          description: 'Model Context Protocol server for MeteoSwiss weather data',
          mcp_endpoint: getMcpEndpointUrl(config),
          usage: `npx mcp-remote ${getMcpEndpointUrl(config)}`,
          health: `/health`,
          capabilities: {
            tools: ADVERTISED_TOOLS,
            prompts: ['wetterNordschweiz', 'wetterSchweiz', 'meteoSuisseRomande', 'meteoTicino'],
          },
        });
      }
    })
  );

  // MCP Streamable HTTP endpoint — handles POST, GET, and DELETE
  // POST: client sends JSON-RPC request, server responds (possibly as SSE stream)
  // GET: client opens SSE stream for server-to-client notifications
  // DELETE: client terminates session
  app.all(
    '/mcp',
    asyncHandler(async (req: Request, res: Response) => {
      debugTransport(
        'MCP request: %s /mcp from %s, Session: %s',
        req.method,
        req.ip,
        req.headers['mcp-session-id'] ?? '(none)'
      );

      // Look up existing transport by session ID header
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId) {
        transport = sessionManager.get(sessionId) as StreamableHTTPServerTransport | undefined;
        if (!transport) {
          debugTransport('Session not found: %s', sessionId);
          // Session ID was provided but not found — return 404
          res.status(404).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Session not found' },
            id: null,
          });
          return;
        }
      }

      // For initialization requests (no session ID), create a new transport
      let isNewTransport = false;
      let reservedClientKey: string | undefined;
      try {
        if (!transport) {
          if (req.method === 'POST') {
            // Enforce the session cap here so it surfaces as a proper 503 up front.
            // The manager also throws inside onsessioninitialized, but that path
            // returns a generic 500 and can double-close the transport (FUN-13).
            if (sessionManager.size >= config.MAX_SESSIONS) {
              debugTransport('Session capacity reached (%d), rejecting', config.MAX_SESSIONS);
              res.status(503).json({ error: 'Server capacity reached' });
              return;
            }
            // Per-client quota, keyed like the rate limiter: without it one client
            // can open every slot and keep them alive with pings, locking out all
            // new clients while it keeps pinging.
            // The slot is reserved synchronously, before the first await: the
            // session only registers later, inside handleRequest, so concurrent
            // initializes would otherwise all pass this check.
            const clientKey = rateLimitKey(req);
            const pending = pendingInitByClient.get(clientKey) ?? 0;
            if (
              sessionManager.countForClient(clientKey) + pending >=
              config.MAX_SESSIONS_PER_CLIENT
            ) {
              debugTransport('Per-client session quota reached for IP: %s', req.ip);
              res.status(429).json({ error: 'Too many open sessions for this client' });
              return;
            }
            pendingInitByClient.set(clientKey, pending + 1);
            reservedClientKey = clientKey;
            // Could be an initialize request — create a new transport + server pair
            try {
              transport = await createAndRegisterTransport(
                createMcpServer,
                sessionManager,
                clientKey
              );
              isNewTransport = true;
              debugTransport('Created new transport for potential initialization');
            } catch (error) {
              console.error('Failed to create transport:', error);
              debugTransport('Failed to create transport: %O', error);
              res.status(503).json({ error: 'Server capacity reached' });
              return;
            }
          } else {
            // GET or DELETE without a valid session ID
            res.status(400).json({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: Mcp-Session-Id header is required' },
              id: null,
            });
            return;
          }
        }

        // Delegate to the transport — it handles all protocol details
        try {
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          console.error('Error handling MCP request:', error);
          debugTransport('Error handling MCP request: %O', error);
          // Clean up newly created transports that failed during first request
          if (isNewTransport) {
            await transport.close();
          }
          // Only send error if response hasn't started
          if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
          }
        }

        // Clean up new transports that didn't initialize (e.g., non-initialize POST)
        if (isNewTransport && !transport.sessionId) {
          debugTransport('New transport did not initialize, cleaning up');
          await transport.close();
        }
      } finally {
        // By now the session is registered (and counted) or was never created.
        if (reservedClientKey !== undefined) {
          const left = (pendingInitByClient.get(reservedClientKey) ?? 1) - 1;
          if (left > 0) pendingInitByClient.set(reservedClientKey, left);
          else pendingInitByClient.delete(reservedClientKey);
        }
      }
    })
  );

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    const health = {
      status: 'ok',
      version: getVersion(),
      sessions: sessionManager.size,
      endpoint: getMcpEndpointUrl(config),
    };
    debugTransport('Health check requested, response: %O', health);
    res.json(health);
  });

  // Prometheus metrics endpoint (only when METRICS_ENABLED=true)
  if (metricsEnabled()) {
    app.get('/metrics', async (_req: Request, res: Response) => {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    });
    debugTransport('Metrics endpoint enabled at /metrics');
  }

  const start = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      debugTransport('Starting HTTP server on %s:%d', config.BIND_ADDRESS, port);
      // Listen on configured interface
      const server = app.listen(port, config.BIND_ADDRESS, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        const actualHost = typeof address === 'object' && address ? address.address : 'unknown';
        // Log server startup info to debug namespace only
        debugTransport('MCP server listening on %s:%d', actualHost, actualPort);
        debugTransport(
          'Endpoints: POST /mcp (requests), GET /mcp (SSE notifications), DELETE /mcp (terminate), GET /health'
        );
        debugTransport('Server started successfully on %s:%d', actualHost, actualPort);
        resolve();
      });

      server.on('error', (err: unknown) => {
        console.error('Server error:', err);
        debugTransport('Server startup error: %O', err);
        reject(err);
      });

      // Retain the listener so stop() can actually close it (see below).
      httpServer = server;

      // Store server reference for tests to access
      // This is a workaround for test compatibility
      (app as express.Application & { __server?: unknown }).__server = server;
    });
  };

  // Global error handler
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // Body-parser rejections are client errors: answer with their own status
    // (400 malformed JSON, 413 too large, 415 compressed or wrong charset).
    if (isBodyParserError(err)) {
      debugTransport('Request body rejected on %s %s: %s', req.method, req.path, err.type);
      if (err.type === 'entity.parse.failed') {
        res
          .status(400)
          .json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      } else {
        res.status(err.status).json({ error: 'Request body rejected' });
      }
      return;
    }
    console.error('Unhandled error:', err);
    debugTransport('Unhandled error on %s %s: %O', req.method, req.path, err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const stop = (): void => {
    debugTransport('Stopping HTTP server, cleaning up %d sessions', sessionManager.size);
    sessionManager.stop();
    // Close the HTTP listener too — Express does NOT do this for us, so without
    // it the listener stayed open (harmless today only because callers
    // process.exit after stop(), but a silent trap for future graceful shutdown).
    if (httpServer) {
      httpServer.close();
      httpServer = undefined;
    }
    debugTransport('Server stopped');
  };

  return { app, start, stop };
}

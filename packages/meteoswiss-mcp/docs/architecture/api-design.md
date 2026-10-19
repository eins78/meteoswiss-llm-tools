# MeteoSwiss MCP Server API Design

This document outlines the API design for the MeteoSwiss MCP (Model Context Protocol) server, which provides structured access to weather data from MeteoSwiss.

## Overview

The MCP server provides weather data from MeteoSwiss through an HTTP server using the MCP Streamable HTTP transport. The server is designed to be accessed via `mcp-remote` for integration with Claude Desktop and other MCP-compatible clients.

## Transport Protocol

The server uses MCP Streamable HTTP transport (spec 2025-11-25):

- **GET `/`** - Server information endpoint
- **POST `/mcp`** - Client sends JSON-RPC requests, server responds (possibly as SSE stream)
- **GET `/mcp`** - Client opens SSE stream for server-to-client notifications
- **DELETE `/mcp`** - Client terminates session
- **GET `/health`** - Health check endpoint

## Available Tools

### meteoswissWeatherReport

Retrieves the latest weather report for a specified region of Switzerland.

**Parameters:**

```typescript
{
  region: "north" | "south" | "west"; // Required: Swiss region
  language?: "de" | "fr" | "it"; // Optional: Report language (default: "de"). English is NOT supported.
}
```

**Response:**

```typescript
{
  region: string;
  language: string;
  title: string;
  updatedAt: string;
  content: string;
  forecast: Array<{
    day: string;
    description: string;
    temperature: string;
  }>;
}
```

**Example Tool Call:**

```json
{
  "name": "meteoswissWeatherReport",
  "parameters": {
    "region": "north",
    "language": "de"
  }
}
```

## Error Handling

The server implements comprehensive error handling:

```typescript
{
  success: false;
  error: {
    code: string; // Error code (e.g., "INVALID_REGION", "API_ERROR")
    message: string; // Human-readable error message
    details?: any; // Additional error details
  };
}
```

## Environment Configuration

The server supports extensive configuration through environment variables:

### Core Settings
- `PORT` - Server port (default: 3000)
- `USE_TEST_FIXTURES` - Use local test data instead of live API (default: false)
- `DEBUG_MCHMCP` - Enable debug logging (default: false)

### Network Configuration
- `BIND_ADDRESS` - Interface to bind to (default: 0.0.0.0)
- `CORS_ORIGIN` - CORS origin configuration (default: *)

### Session Management
- `MAX_SESSIONS` - Maximum concurrent SSE sessions (default: 100)
- `MAX_SESSIONS_PER_CLIENT` - Maximum concurrent sessions per client IP (default: 10)
- `SESSION_TIMEOUT_MS` - Session timeout in milliseconds (default: 300000)

### Rate Limiting
- `RATE_LIMIT_WINDOW_MS` - Rate limit window (default: 60000)
- `RATE_LIMIT_MAX_REQUESTS` - Max requests per window (default: 100)

### Request Handling
- `REQUEST_SIZE_LIMIT` - Maximum request body size (default: 10mb)

## Rate Limiting

The server implements built-in rate limiting:

- Configurable requests per time window
- Per-IP rate limiting
- Graceful handling of rate limit exceeded

Rate limit information is provided in response headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1619766913
```

## Language Support

Weather report responses can be localized by specifying the `language` parameter:

- `de`: German (Deutsch) — **default**
- `fr`: French (Français)
- `it`: Italian (Italiano)

Note: English is **not supported** for weather reports. The search and fetch tools support English (`en`).

## Data Sources

The server fetches data from MeteoSwiss HTTP endpoints:
- Weather reports are fetched from regional endpoints
- Data is available in multiple languages
- Supports both live API calls and test fixtures for development

## Implementation Details

### Session Management
- Automatic cleanup of inactive sessions
- Configurable maximum session limit
- Memory-efficient session storage

### Error Recovery
- Graceful handling of upstream API failures
- Automatic retry logic for transient errors
- Fallback to cached data when available

### Security
- No authentication required (public weather data)
- Rate limiting to prevent abuse
- Input validation using Zod schemas
- CORS configuration for production deployments

## MCP Protocol Compliance

The server fully implements the Model Context Protocol specification:
- Proper tool registration and discovery
- Schema validation for tool parameters
- Standard error response format
- Streamable HTTP transport for real-time communication

## Additional Tools

Beyond `meteoswissWeatherReport`, the server provides these OGD-based tools:

- **meteoswissLocalForecast** — Multi-day weather forecast for ~6000 Swiss locations (postal codes, stations, mountain POIs)
- **meteoswissCurrentWeather** — Real-time measurements from ~300 measurement stations (~160 full weather + ~140 precipitation-only)
- **meteoswissStations** — List and search MeteoSwiss automatic weather stations
- **meteoswissClimateData** — Homogeneous NBCN climate series (daily/monthly/yearly, decades back)
- **meteoswissPollenData** — Current pollen concentration data from ~15 monitoring stations
- **search** — Search MeteoSwiss website content (DE, FR, IT, EN)
- **fetch** — Fetch full content from MeteoSwiss webpages
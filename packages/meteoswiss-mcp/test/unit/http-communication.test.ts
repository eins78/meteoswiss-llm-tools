import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  fetchWithRetry,
  fetchBinary,
  HttpRequestError,
  MAX_RESPONSE_BYTES,
} from '../../src/support/http-communication.js';

/**
 * Unit tests for the low-level HTTP client: retry loop, response-body size cap,
 * and BOM handling. `global.fetch` is mocked so no network is touched.
 * Covers TEST-6 (retry loop) and SEC-3 (body cap) from the 2026-07-11 review.
 */

type FetchMock = Mock<(input: unknown, init?: unknown) => Promise<Response>>;

const realFetch = global.fetch;
let fetchMock: FetchMock;

/** Build a ReadableStream that emits `chunks` (each a byte length) of 'a'. */
function streamOf(chunkSizes: number[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunkSizes.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSizes[i]!).fill(97));
      i += 1;
    },
  });
}

beforeEach(() => {
  fetchMock = vi.fn() as FetchMock;
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  vi.clearAllMocks();
});

describe('fetchWithRetry — success', () => {
  it('returns the decoded body and strips a leading UTF-8 BOM', async () => {
    const withBom = '﻿{"ok":true}';
    fetchMock.mockResolvedValue(
      new Response(withBom, { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const text = await fetchWithRetry('https://data.geo.admin.ch/x', { useCache: false });

    // BOM stripped → JSON.parse works, matching native response.text() semantics.
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithRetry — body size cap (SEC-3)', () => {
  it('rejects via Content-Length before streaming, without retrying', async () => {
    fetchMock.mockResolvedValue(
      new Response('small', {
        status: 200,
        headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
      })
    );

    await expect(
      fetchWithRetry('https://data.geo.admin.ch/big', { useCache: false })
    ).rejects.toThrow(/too large/i);
    // Non-retryable: a single attempt, not the default 3 retries.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enforces the cap while streaming when Content-Length is absent', async () => {
    fetchMock.mockResolvedValue(new Response(streamOf([8, 8, 8]), { status: 200 }));

    await expect(
      fetchWithRetry('https://data.geo.admin.ch/chunked', { useCache: false, maxBytes: 16 })
    ).rejects.toThrow(/too large/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithRetry — retry behaviour', () => {
  it('retries a transient 500 then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('nope', { status: 500, statusText: 'Server Error' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const text = await fetchWithRetry('https://data.geo.admin.ch/flaky', {
      useCache: false,
      retryDelay: 1,
    });

    expect(text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 (non-retryable 4xx)', async () => {
    fetchMock.mockResolvedValue(new Response('missing', { status: 404, statusText: 'Not Found' }));

    await expect(
      fetchWithRetry('https://data.geo.admin.ch/gone', { useCache: false, retryDelay: 1 })
    ).rejects.toBeInstanceOf(HttpRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still retries a 429 (transient 4xx)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('slow down', { status: 429, statusText: 'Too Many' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const text = await fetchWithRetry('https://data.geo.admin.ch/throttled', {
      useCache: false,
      retryDelay: 1,
    });

    expect(text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchBinary — body size cap (SEC-3)', () => {
  it('rejects an oversized binary body via Content-Length without retrying', async () => {
    fetchMock.mockResolvedValue(
      new Response('x', {
        status: 200,
        headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
      })
    );

    await expect(fetchBinary('https://data.geo.admin.ch/big.csv')).rejects.toBeInstanceOf(
      HttpRequestError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the raw buffer for a normal body', async () => {
    fetchMock.mockResolvedValue(new Response(streamOf([4]), { status: 200 }));

    const buffer = await fetchBinary('https://data.geo.admin.ch/ok.csv');
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(4);
  });
});

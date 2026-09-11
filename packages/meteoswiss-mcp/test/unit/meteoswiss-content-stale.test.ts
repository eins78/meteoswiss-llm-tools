import { describe, expect, it, beforeAll, jest } from '@jest/globals';

/**
 * Stale-if-error: when MeteoSwiss is unreachable, an expired page beats nothing.
 *
 * The mechanism is `staleWhileRevalidate`, NOT `cachified`'s `fallbackToCache`.
 * `fallbackToCache` is gated on `forceFresh` in cachified's source
 * (`if (forceFresh && fallbackToCache > 0)`), and this path never forces a
 * refresh, so it would never fire here. What does fire: inside the revalidate
 * window an expired entry is handed to the caller *before* the refresh is
 * attempted, so a failing refresh cannot turn into a failed request.
 *
 * This needs a genuinely EXPIRED entry rather than merely a cached one, so it
 * lives in its own file with a short TTL — the cache config is read once at
 * module load, and the sibling cache test needs a long TTL for its assertions.
 */

const PAGE_URL = 'https://www.meteoswiss.admin.ch/weather/weather-and-climate-from-a-to-z/foehn.html';
const html = `<!doctype html><html><head><title>T</title></head><body><main><h1>Föhn</h1><p>Last known good.</p></main></body></html>`;

const fetchHtml = jest.fn<() => Promise<string>>();

let fetchMeteoSwissContent: typeof import('../../src/data/meteoswiss-content-data.js').fetchMeteoSwissContent;

beforeAll(async () => {
  process.env.USE_TEST_FIXTURES = 'false';
  // Long enough that the entry is actually WRITTEN — cachified skips the write
  // when the value is already expired at write time — but short enough to lapse
  // before the second call below.
  process.env.CONTENT_CACHE_TTL_MS = '120';
  // Generous revalidate window: this is the property under test.
  process.env.CONTENT_CACHE_SWR_MS = '600000';

  jest.unstable_mockModule('../../src/support/http-communication.js', () => ({
    fetchHtml,
    HttpRequestError: class HttpRequestError extends Error {
      statusCode?: number;
    },
  }));

  ({ fetchMeteoSwissContent } = await import('../../src/data/meteoswiss-content-data.js'));
});

describe('stale-if-error', () => {
  it('serves the expired page when the background refresh fails', async () => {
    fetchHtml.mockResolvedValueOnce(html);
    const good = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    expect(good.text).toContain('Last known good.');
    expect(fetchHtml).toHaveBeenCalledTimes(1);

    // Let the TTL lapse, then take upstream away entirely.
    await new Promise((resolve) => setTimeout(resolve, 250));
    fetchHtml.mockRejectedValue(new Error('upstream unreachable'));

    const stale = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    expect(stale.text).toContain('Last known good.');

    // Discriminator: a second fetch really was attempted, which is only true if
    // the entry had EXPIRED. Without it this test would also pass on a merely
    // still-fresh entry and would prove nothing about staleness. The refresh is
    // dispatched behind the response, so give it a turn to run and reject.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchHtml).toHaveBeenCalledTimes(2);
  });

  it('propagates the error when there is nothing cached to fall back to', async () => {
    // The honest boundary of the property above: it degrades a *repeat* request,
    // it does not invent content for a page nobody has fetched yet.
    fetchHtml.mockRejectedValue(new Error('upstream unreachable'));

    await expect(
      fetchMeteoSwissContent({
        id: 'https://www.meteoswiss.admin.ch/weather/weather-and-climate-from-a-to-z/bise.html',
        format: 'markdown',
      })
    ).rejects.toThrow(/upstream unreachable|Failed to fetch/);
  });
});

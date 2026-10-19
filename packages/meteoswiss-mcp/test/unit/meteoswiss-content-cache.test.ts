import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';

/**
 * The converted-page cache (`cachified`) that sits above the conversion memo.
 *
 * It supplies the three properties the plain memo cannot:
 *  - single-flight: concurrent requests for one page do ONE fetch + ONE convert;
 *  - TTL: a converted page is reused without revalidating;
 *  - stale-while-revalidate: an expired page is served while it refreshes behind
 *    the response (covered in meteoswiss-content-stale.test.ts).
 *
 * `fetchHtml` is mocked, so there is no network I/O and every fetch is counted.
 */

const PAGE_URL = 'https://www.meteoswiss.admin.ch/weather/weather-and-climate-from-a-to-z/foehn.html';

const htmlFor = (body: string): string =>
  `<!doctype html><html><head><title>T</title></head><body><main><h1>Föhn</h1>${body}</main></body></html>`;

// vi.mock factories are hoisted above the declarations that use them, so the
// mock fns must be created via vi.hoisted (vitest's unstable_mockModule
// equivalent — the mock applies before the dynamic import in beforeAll).
const fetchHtml = vi.hoisted(() => vi.fn<() => Promise<string>>());
const expandWebComponents = vi.hoisted(() => vi.fn<(document: unknown) => void>());

vi.mock('../../src/support/http-communication.js', () => ({
  fetchHtml,
  HttpRequestError: class HttpRequestError extends Error {
    statusCode?: number;
  },
}));
vi.mock('../../src/data/meteoswiss-web-components.js', () => ({
  expandWebComponents,
}));

let fetchMeteoSwissContent: typeof import('../../src/data/meteoswiss-content-data.js').fetchMeteoSwissContent;
let clearContentConversionMemo: typeof import('../../src/data/meteoswiss-content-data.js').clearContentConversionMemo;

beforeAll(async () => {
  process.env.USE_TEST_FIXTURES = 'false';
  // Long TTL so these tests exercise the caching path deterministically rather
  // than racing a clock.
  process.env.CONTENT_CACHE_TTL_MS = '600000';
  process.env.CONTENT_CACHE_SWR_MS = '0';

  ({ fetchMeteoSwissContent, clearContentConversionMemo } = await import(
    '../../src/data/meteoswiss-content-data.js'
  ));
});

beforeEach(() => {
  clearContentConversionMemo();
  fetchHtml.mockReset();
  expandWebComponents.mockReset();
});

describe('converted-page cache', () => {
  it('serves a repeat request from cache without re-fetching', async () => {
    fetchHtml.mockResolvedValue(htmlFor('<p>Cached prose.</p>'));

    const first = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    const second = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });

    expect(first.text).toContain('Cached prose.');
    expect(second.text).toBe(first.text);
    // Within the TTL the page is not fetched or converted again at all.
    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(expandWebComponents).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent requests for the same page into one fetch', async () => {
    let release: (html: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    fetchHtml.mockReturnValue(pending);

    // Six simultaneous callers, as six MCP sessions asking at once.
    const all = Promise.all(
      Array.from({ length: 6 }, () =>
        fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' })
      )
    );
    release(htmlFor('<p>Single flight.</p>'));
    const results = await all;

    for (const r of results) {
      expect(r.text).toContain('Single flight.');
    }
    // The whole point: one upstream fetch and one conversion, not six.
    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(expandWebComponents).toHaveBeenCalledTimes(1);
  });

  it('hands out copies, so a caller cannot mutate what the next one receives', async () => {
    fetchHtml.mockResolvedValue(htmlFor('<p>Do not clobber.</p>'));

    const first = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    first.text = 'CLOBBERED';

    const second = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    expect(second.text).toContain('Do not clobber.');
  });
});

describe('cache key canonicalisation', () => {
  it('serves query and fragment variants of one page from one cache entry', async () => {
    fetchHtml.mockResolvedValue(htmlFor('<p>One page.</p>'));

    const variants = [
      PAGE_URL,
      `${PAGE_URL}?a=1`,
      `${PAGE_URL}?a=2&b=3`,
      `${PAGE_URL}#x1`,
      `${PAGE_URL}?a=4#x2`,
      PAGE_URL.replace('https://', 'https://user:pw@'),
    ];
    for (const id of variants) {
      const page = await fetchMeteoSwissContent({ id, format: 'text' });
      expect(page.text).toContain('One page.');
    }

    // Before: one upstream fetch per variant. Now: one for the page.
    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(fetchHtml.mock.calls[0]?.[0]).toBe(PAGE_URL);
  });
});

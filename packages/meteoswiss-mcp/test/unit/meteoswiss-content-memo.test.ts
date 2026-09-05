import { describe, expect, it, beforeAll, beforeEach, jest } from '@jest/globals';

/**
 * The conversion memo — the compute saving the cache was originally built for.
 *
 * `httpCache` already stored the fetched HTML, so a repeat request skipped the
 * network. It did not skip `JSDOM` → `expandWebComponents` → `turndown`, which
 * re-ran on every call and produced a byte-identical result (~60 ms measured).
 *
 * `fetchHtml` is mocked so these tests do no network I/O and can count exactly
 * how many times the HTML was consumed. The URL is a real meteoswiss.admin.ch
 * one because the module validates it against a domain allowlist before
 * fetching.
 */

const PAGE_URL = 'https://www.meteoswiss.admin.ch/weather/weather-and-climate-from-a-to-z/foehn.html';

const htmlFor = (body: string): string =>
  `<!doctype html><html><head><title>T</title></head><body><main><h1>Föhn</h1>${body}</main></body></html>`;

const fetchHtml = jest.fn<() => Promise<string>>();

/**
 * Counts conversions. `expandWebComponents` runs exactly once per
 * `processHtmlContent` call, so it is a precise probe for "did the conversion
 * actually re-run?" — the property the memo exists to change. Without it these
 * tests would all pass on the unmemoised code, because the conversion is
 * deterministic and therefore invisible from its output alone.
 */
const expandWebComponents = jest.fn<(document: unknown) => void>();

let fetchMeteoSwissContent: typeof import('../../src/data/meteoswiss-content-data.js').fetchMeteoSwissContent;
let clearContentConversionMemo: typeof import('../../src/data/meteoswiss-content-data.js').clearContentConversionMemo;

beforeAll(async () => {
  // The module short-circuits to fixtures when this is 'true'; the memo lives on
  // the live path, so it must be off here.
  process.env.USE_TEST_FIXTURES = 'false';

  jest.unstable_mockModule('../../src/support/http-communication.js', () => ({
    fetchHtml,
    HttpRequestError: class HttpRequestError extends Error {
      statusCode?: number;
    },
  }));

  jest.unstable_mockModule('../../src/data/meteoswiss-web-components.js', () => ({
    expandWebComponents,
  }));

  ({ fetchMeteoSwissContent, clearContentConversionMemo } = await import(
    '../../src/data/meteoswiss-content-data.js'
  ));
});

beforeEach(() => {
  clearContentConversionMemo();
  fetchHtml.mockReset();
  expandWebComponents.mockReset();
});

describe('conversion memo', () => {
  it('converts once for identical HTML and returns an equal result', async () => {
    const html = htmlFor('<p>Warm dry downslope wind.</p>');
    fetchHtml.mockResolvedValue(html);

    const first = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    const second = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });

    // Same bytes out — the memo must not change the answer.
    expect(second.text).toBe(first.text);
    expect(first.text).toContain('Warm dry downslope wind.');
    expect(first.title).toBe('Föhn');

    // The decisive assertion: the HTML was consumed twice, but the expensive
    // conversion ran only ONCE. Without the memo this is 2.
    expect(fetchHtml).toHaveBeenCalledTimes(2);
    expect(expandWebComponents).toHaveBeenCalledTimes(1);
  });

  it('re-converts when the page HTML changes, never serving a stale conversion', async () => {
    fetchHtml.mockResolvedValueOnce(htmlFor('<p>Original text.</p>'));
    const first = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    expect(first.text).toContain('Original text.');

    fetchHtml.mockResolvedValueOnce(htmlFor('<p>Updated text.</p>'));
    const second = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });

    // Keyed on a hash of the HTML, so changed input cannot hit the memo.
    expect(second.text).toContain('Updated text.');
    expect(second.text).not.toContain('Original text.');
    expect(expandWebComponents).toHaveBeenCalledTimes(2);
  });

  it('keys on format, so markdown and text do not collide', async () => {
    fetchHtml.mockResolvedValue(htmlFor('<p>Some <strong>bold</strong> prose.</p>'));

    const md = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    const txt = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'text' });

    expect(md.format).toBe('markdown');
    expect(txt.format).toBe('text');
    expect(md.text).toContain('**bold**');
    expect(txt.text).not.toContain('**bold**');
    expect(txt.text).toContain('bold');
    // Different formats are different keys, so both really converted.
    expect(expandWebComponents).toHaveBeenCalledTimes(2);
  });

  it('hands out copies, so a caller mutating the result cannot poison the memo', async () => {
    fetchHtml.mockResolvedValue(htmlFor('<p>Immutable please.</p>'));

    const first = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    first.text = 'CLOBBERED';
    first.title = 'CLOBBERED';

    const second = await fetchMeteoSwissContent({ id: PAGE_URL, format: 'markdown' });
    expect(second.text).toContain('Immutable please.');
    expect(second.text).not.toBe('CLOBBERED');
    expect(second.title).toBe('Föhn');
    // Served from the memo, not re-derived — otherwise this proves nothing.
    expect(expandWebComponents).toHaveBeenCalledTimes(1);
  });
});

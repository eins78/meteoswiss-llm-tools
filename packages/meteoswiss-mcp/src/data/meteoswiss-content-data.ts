import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { fetchHtml, HttpRequestError } from '../support/http-communication.js';
import { debugData } from '../support/logging.js';
import { expandWebComponents } from './meteoswiss-web-components.js';
import type { ContentResponse, FetchMeteoSwissContentInput } from '../schemas/meteoswiss-fetch.js';

export type { ContentResponse } from '../schemas/meteoswiss-fetch.js';

// Test fixtures location
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_FIXTURES_DEV_PATH = path.resolve(__dirname, '../../test/__fixtures__/content');
const TEST_FIXTURES_PROD_PATH = path.resolve(__dirname, '../test/__fixtures__/content');
const TEST_FIXTURES_ROOT = existsSync(TEST_FIXTURES_DEV_PATH)
  ? TEST_FIXTURES_DEV_PATH
  : TEST_FIXTURES_PROD_PATH;

const USE_TEST_FIXTURES = process.env.USE_TEST_FIXTURES === 'true';

/**
 * Memo for converted page content — the compute the cache was built for.
 *
 * `httpCache` stores the fetched HTML, so a repeat request already skips the
 * network. It did **not** skip the conversion: `new JSDOM(html)` →
 * `expandWebComponents` → `turndown` ran again on every call and reproduced a
 * byte-identical result. Measured on a real page: 271 ms cold, then ~60 ms on
 * every subsequent call, all of it recomputation.
 *
 * The key includes a hash of the **HTML itself**, not just the URL. That makes
 * this a pure-function memo rather than a second content cache: it can never
 * serve markdown staler than the HTML it was derived from, so it needs no TTL
 * of its own and cannot disagree with `httpCache` about freshness. When the page
 * changes, the hash changes and the conversion re-runs.
 *
 * Verified deterministic before adopting: 6 runs over 2 pages in both output
 * formats produced one distinct result each. Memoising a nondeterministic
 * function would be a correctness bug, not an optimisation.
 *
 * Bounded by entry count rather than bytes — entries are ~9 KB of markdown, so
 * the default cap is a few MB. Insertion order is recency order: reads
 * re-insert, and eviction takes the first (least recently used) key.
 */
const CONTENT_MEMO_MAX_ENTRIES = (() => {
  const raw = Number(process.env.CONTENT_MEMO_MAX_ENTRIES);
  return Number.isFinite(raw) && raw > 0 ? raw : 200;
})();

const conversionMemo = new Map<string, ContentResponse>();

/** Build the memo key from the conversion's full input set. */
function conversionMemoKey(
  url: string,
  format: 'markdown' | 'text',
  includeMetadata: boolean,
  html: string
): string {
  return createHash('sha256')
    .update(url)
    .update('\0')
    .update(format)
    .update('\0')
    .update(String(includeMetadata))
    .update('\0')
    .update(html)
    .digest('hex');
}

/**
 * Read a memoised conversion, promoting it to most-recently-used.
 *
 * Returns a structured clone so a caller mutating the response cannot corrupt
 * the entry every later caller receives.
 */
function readConversionMemo(key: string): ContentResponse | undefined {
  const hit = conversionMemo.get(key);
  if (hit === undefined) {
    return undefined;
  }
  conversionMemo.delete(key);
  conversionMemo.set(key, hit);
  return structuredClone(hit);
}

/** Store a conversion result, evicting the least recently used entries. */
function writeConversionMemo(key: string, value: ContentResponse): void {
  conversionMemo.delete(key);
  conversionMemo.set(key, value);
  while (conversionMemo.size > CONTENT_MEMO_MAX_ENTRIES) {
    const oldest = conversionMemo.keys().next().value;
    if (oldest === undefined) break;
    conversionMemo.delete(oldest);
  }
}

/**
 * Drop every memoised conversion. Intended for tests.
 */
export function clearContentConversionMemo(): void {
  conversionMemo.clear();
}

/**
 * Hard cap on HTML size before parsing. `new JSDOM(html)` is synchronous and
 * blocks the single-threaded event loop for the full parse; an unbounded input
 * from a large upstream page therefore stalls every other session. The largest
 * real MeteoSwiss page is well under 500 KB, so 5 MB leaves generous headroom
 * while preventing a pathological multi-MB block. Must stay ≤ MAX_RESPONSE_BYTES.
 */
const MAX_HTML_BYTES = 5_000_000;

// Get Document/Element types from JSDOM (no DOM globals in the Node lint env)
type Document = InstanceType<typeof JSDOM>['window']['document'];
type Element = NonNullable<ReturnType<Document['querySelector']>>;

// Allowed MeteoSwiss domains
const ALLOWED_DOMAINS = [
  'www.meteoschweiz.admin.ch',
  'www.meteosuisse.admin.ch',
  'www.meteosvizzera.admin.ch',
  'www.meteoswiss.admin.ch',
  'meteoschweiz.admin.ch',
  'meteosuisse.admin.ch',
  'meteosvizzera.admin.ch',
  'meteoswiss.admin.ch',
];

/**
 * Assert that a URL targets an allowed MeteoSwiss domain over https on the
 * default port. Run on the initial fetch URL and re-run on every redirect hop
 * (so an upstream open redirect cannot escape the allowlist — SEC-4), and pins
 * the scheme to https and the port to default (SEC-8).
 *
 * `URL.hostname` is used for the host check, which is robust against userinfo
 * (`@`), case, punycode/IDN, and bare-path (`//evil.com`) escapes.
 *
 * @param rawUrl - The URL to validate
 * @throws {Error} If the URL is malformed, non-https, non-default-port, or off-allowlist
 */
export function assertAllowedContentUrl(rawUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (error) {
    throw new Error(`Invalid URL: ${rawUrl}`, { cause: error });
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`Invalid scheme: ${parsedUrl.protocol} for ${rawUrl}. Only https is allowed.`);
  }
  if (parsedUrl.port !== '') {
    throw new Error(
      `Invalid port: ${parsedUrl.port} for ${rawUrl}. Only the default https port is allowed.`
    );
  }
  if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
    throw new Error(`Invalid domain: ${parsedUrl.hostname}. Only MeteoSwiss domains are allowed.`);
  }
}

// Initialize Turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// Add GFM plugin for better markdown support (tables, strikethrough, task lists)
turndownService.use(gfm);

// ContentResponse now lives in ../schemas/meteoswiss-fetch.ts as a Zod schema
// (ContentResponseSchema) so the fetch tool can declare it as its MCP outputSchema.
// Field naming follows the ChatGPT Deep Research MCP contract: `id`, `title`,
// `text`, `url`, `metadata`. Prior to v2.4.0 this response also included a
// `content` field duplicating `text` byte-for-byte; it was removed as a
// token-cost fix (issue #110, BUG-2) — `text` is canonical.

/**
 * Fetch MeteoSwiss content by ID.
 *
 * The `id` parameter is a full MeteoSwiss page URL returned by the search tool.
 *
 * @param params Fetch parameters
 * @returns Content response
 */
export async function fetchMeteoSwissContent(
  params: FetchMeteoSwissContentInput
): Promise<ContentResponse> {
  const { id, format = 'markdown', includeMetadata = true } = params;

  debugData('fetchMeteoSwissContent called with params: %o', {
    id,
    format,
    includeMetadata,
  });

  if (USE_TEST_FIXTURES) {
    debugData('Using test fixtures for content fetch');
    return fetchFromTestFixtures(id, format, includeMetadata);
  }

  debugData('Using live API for content fetch');
  return fetchFromWeb(id, format, includeMetadata);
}

/**
 * Fetch content from the web.
 *
 * @param id The page id — a full URL or a path returned by the search tool.
 */
async function fetchFromWeb(
  id: string,
  format: 'markdown' | 'text',
  includeMetadata: boolean
): Promise<ContentResponse> {
  // Normalise to full URL (accept full URLs; prepend base for bare paths for backward compat)
  const fullUrl = id.startsWith('http')
    ? id
    : `https://www.meteoswiss.admin.ch${id.startsWith('/') ? id : '/' + id}`;

  debugData('Fetching content from URL: %s', fullUrl);

  // Validate scheme, port, and domain up front (thrown directly to the caller).
  assertAllowedContentUrl(fullUrl);

  try {
    debugData('Making HTTP request to fetch content');
    // Re-validate every redirect hop so an upstream open redirect cannot escape
    // the allowlist.
    const html = await fetchHtml(fullUrl, { validateUrl: assertAllowedContentUrl });
    debugData('Content fetched successfully, size: %d bytes', html.length);

    // Skip the conversion entirely when this exact HTML has already been
    // converted with these options — the compute saving this cache exists for.
    const memoKey = conversionMemoKey(fullUrl, format, includeMetadata, html);
    const memoised = readConversionMemo(memoKey);
    if (memoised !== undefined) {
      debugData('Conversion memo hit for %s (format=%s)', fullUrl, format);
      return memoised;
    }

    // processHtmlContent is synchronous; a Promise.race timeout around it was
    // dead code (the parse completes before the race is evaluated). The parse is
    // bounded instead by MAX_HTML_BYTES inside processHtmlContent.
    const converted = processHtmlContent(html, fullUrl, format, includeMetadata);
    writeConversionMemo(memoKey, converted);
    debugData('Conversion memo store for %s (format=%s)', fullUrl, format);
    return structuredClone(converted);
  } catch (error) {
    debugData('Content fetch error: %o', error);
    if (error instanceof HttpRequestError && error.statusCode === 404) {
      throw new Error(
        `Content not found: ${id}. Use the search tool to discover valid page URLs.`,
        { cause: error }
      );
    }
    throw new Error(
      `Failed to fetch content: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/**
 * Fetch content from test fixtures.
 *
 * @param id The page id — a full URL or a path returned by the search tool.
 */
async function fetchFromTestFixtures(
  id: string,
  format: 'markdown' | 'text',
  includeMetadata: boolean
): Promise<ContentResponse> {
  debugData('Looking for test fixture for id: %s', id);

  // Extract language from URL if it's a full URL
  let detectedLang = 'de';
  let urlPath = id;

  if (id.startsWith('http')) {
    const parsed = new URL(id);
    urlPath = parsed.pathname;

    // Detect language from domain
    if (parsed.hostname.includes('meteoschweiz')) {
      detectedLang = 'de';
    } else if (parsed.hostname.includes('meteosuisse')) {
      detectedLang = 'fr';
    } else if (parsed.hostname.includes('meteosvizzera')) {
      detectedLang = 'it';
    } else if (parsed.hostname.includes('meteoswiss')) {
      detectedLang = 'en';
    }
  }

  // Extract filename from path
  const fileName = urlPath.split('/').pop() || 'index.html';
  const baseName = fileName.replace(/\.[^.]+$/, '');

  // Try to find the fixture file
  const languages = [detectedLang, 'de', 'fr', 'it', 'en'];
  for (const lang of languages) {
    const fixtureFile = path.join(TEST_FIXTURES_ROOT, lang, `${baseName}.html`);
    debugData('Checking for fixture file: %s', fixtureFile);
    if (existsSync(fixtureFile)) {
      debugData('Loading test fixture from: %s', fixtureFile);
      const html = await fs.readFile(fixtureFile, 'utf-8');
      const fullUrl = id.startsWith('http') ? id : `https://www.meteoswiss.admin.ch${id}`;

      return processHtmlContent(html, fullUrl, format, includeMetadata);
    }
  }

  debugData('No test fixture found for id: %s', id);
  throw new Error(`Content not found: ${id}`);
}

/**
 * Process HTML content and convert to requested format
 */
function processHtmlContent(
  html: string,
  url: string,
  format: 'markdown' | 'text',
  includeMetadata: boolean
): ContentResponse {
  debugData(
    'Processing HTML content, format: %s, includeMetadata: %s, size: %d bytes',
    format,
    includeMetadata,
    html.length
  );

  // Reject oversized input before the synchronous (event-loop-blocking) parse.
  if (html.length > MAX_HTML_BYTES) {
    throw new Error(
      `HTML document too large to process: ${html.length} characters exceeds ${MAX_HTML_BYTES} cap`
    );
  }

  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Expand MeteoSwiss web components into standard HTML before extraction
  expandWebComponents(document);

  // Extract main content element (parsed once; the text path reuses this DOM
  // node's textContent rather than instantiating a second JSDOM).
  const mainElement = extractMainContent(document);
  const mainHtml = mainElement?.innerHTML ?? '';

  // Extract title - try multiple selectors
  const title =
    document.querySelector('h1')?.textContent?.trim() ||
    document.querySelector('mch-title[level="1"]')?.textContent?.trim() ||
    document.querySelector('[heading]')?.getAttribute('heading') ||
    document.querySelector('title')?.textContent?.trim() ||
    'Untitled';

  // Extract metadata
  const metadata = includeMetadata
    ? {
        url,
        language: detectLanguage(document),
        lastModified: extractLastModified(document),
        contentType: extractContentType(document),
        keywords: extractKeywords(document),
        description: extractDescription(document),
      }
    : undefined;

  // Convert content to requested format
  let content: string;
  switch (format) {
    case 'markdown':
      content = turndownService.turndown(mainHtml);
      // Prepend title as H1 if we have one and it's not already in the content
      if (title && title !== 'Untitled' && !content.includes(`# ${title}`)) {
        content = `# ${title}\n\n${content}`;
      }
      break;
    case 'text':
      content = cleanTextContent(mainElement?.textContent ?? '');
      // Prepend title for text format too
      if (title && title !== 'Untitled') {
        content = `${title}\n\n${content}`;
      }
      break;
    default:
      throw new Error(`Invalid format: ${format}`);
  }

  debugData('Content processed successfully, content length: %d characters', content.length);

  return {
    id: url,
    title,
    text: content,
    format,
    url,
    metadata,
  };
}

/**
 * Extract the main content element from the page.
 *
 * Returns the DOM element (not serialized HTML) so callers can derive both
 * `innerHTML` (markdown path) and `textContent` (text path) from a single parse.
 *
 * @returns The main-content element, or `null` if the document has no body
 */
function extractMainContent(document: Document): Element | null {
  // Remove screenreader titles in all languages
  const screenreaderTitles = [
    'Inhaltsbereich', // German
    'Contenu principal', // French
    'Contenuto principale', // Italian
    'Main content', // English
  ];

  // Remove elements with screenreader-only titles
  document.querySelectorAll('h1, h2, h3').forEach((heading) => {
    const text = heading.textContent?.trim() || '';
    if (
      screenreaderTitles.includes(text) ||
      heading.classList.contains('a11y-description--hidden') ||
      heading.classList.contains('sr-only') ||
      heading.classList.contains('visually-hidden')
    ) {
      heading.remove();
    }
  });

  // Remove share widgets and dialogs
  const shareSelectors = [
    'dialog.share-dialog', // Share dialog container
    '.share-dialog', // Share dialog elements
    '.share-dialog-button__share--dark', // Share button
    '[data-share]',
    '.share-widget',
    '.social-share',
    'mch-share-dialog',
    '.mch-page-intro__controls', // Container that includes share button
  ];

  shareSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.remove();
    });
  });

  // Also remove elements that contain share-related text but use generic classes
  document.querySelectorAll('[class*="share"], [id*="share"]').forEach((el) => {
    const text = el.textContent?.toLowerCase() || '';
    if (
      text.includes('seite teilen') ||
      text.includes('partager') ||
      text.includes('condividi') ||
      text.includes('share') ||
      text.includes('copy link') ||
      text.includes('link kopieren')
    ) {
      el.remove();
    }
  });

  // Try different selectors for main content
  const selectors = [
    'main',
    '[role="main"]',
    '.main-content',
    '.content',
    'article',
    '.mch-article',
    '#content',
    '.page-main__wrapper', // MeteoSwiss specific
    'mch-detail-page', // MeteoSwiss component
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  // Fallback to body content
  const body = document.querySelector('body');
  if (body) {
    // Remove navigation, header, footer, scripts, styles
    const toRemove = body.querySelectorAll('nav, header, footer, script, style, noscript');
    toRemove.forEach((el) => el.remove());
    return body;
  }

  return null;
}

/**
 * Normalize extracted plain text: trim each line and drop blank lines.
 * Operates on already-extracted `textContent` — no HTML parsing (a second
 * JSDOM instantiation here previously doubled the parse cost for text format).
 */
function cleanTextContent(text: string): string {
  return text
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0)
    .join('\n');
}

/**
 * Detect language from the document
 */
function detectLanguage(document: Document): string {
  const lang =
    document.documentElement.getAttribute('lang') ||
    document.querySelector('meta[property="og:locale"]')?.getAttribute('content') ||
    'de';

  return lang.substring(0, 2).toLowerCase();
}

/**
 * Extract last modified date
 */
function extractLastModified(document: Document): string | undefined {
  const lastModified =
    document.querySelector('meta[property="article:modified_time"]')?.getAttribute('content') ||
    document.querySelector('meta[name="DC.date.modified"]')?.getAttribute('content');

  return lastModified || undefined;
}

/**
 * Extract content type
 */
function extractContentType(document: Document): string {
  const type =
    document.querySelector('meta[property="og:type"]')?.getAttribute('content') ||
    document.querySelector('meta[name="DC.type"]')?.getAttribute('content') ||
    'article';

  return type;
}

/**
 * Extract keywords
 */
function extractKeywords(document: Document): string[] {
  const keywordsStr =
    document.querySelector('meta[name="keywords"]')?.getAttribute('content') ||
    document.querySelector('meta[property="article:tag"]')?.getAttribute('content') ||
    '';

  return keywordsStr
    .split(',')
    .map((k: string) => k.trim())
    .filter((k: string) => k.length > 0);
}

/**
 * Extract description
 */
function extractDescription(document: Document): string | undefined {
  const description =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ||
    document.querySelector('meta[property="og:description"]')?.getAttribute('content');

  return description || undefined;
}

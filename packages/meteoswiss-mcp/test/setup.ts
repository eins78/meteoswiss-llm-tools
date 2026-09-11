/**
 * Jest test setup
 */

// Set test environment variables
process.env.USE_TEST_FIXTURES = 'true';
process.env.NODE_ENV = 'test';

/**
 * Clear the content-cache tuning vars before every test file.
 *
 * These are read once at module load, so a file that wants a particular cache
 * behaviour sets them in `beforeAll` *before* its dynamic import. Jest reuses a
 * worker process across files, so without this reset a file that does not set
 * them inherits whatever the previous file left behind — the memo test sets TTL
 * to 0, the cache test to 600000, the stale test to 120. Nothing depends on that
 * today, but the failure it would produce (a content test on the live path
 * quietly running with someone else's cache config) is the kind that looks like
 * flakiness rather than a leak.
 */
for (const name of [
  'CONTENT_CACHE_TTL_MS',
  'CONTENT_CACHE_SWR_MS',
  'CONTENT_CACHE_MAX_ENTRIES',
  'CONTENT_MEMO_MAX_ENTRIES',
]) {
  delete process.env[name];
}

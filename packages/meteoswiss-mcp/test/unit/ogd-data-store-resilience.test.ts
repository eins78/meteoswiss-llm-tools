import { describe, expect, it, beforeAll, afterAll, jest } from '@jest/globals';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * A cache fault must never become a tool failure.
 *
 * The 2026-09-05 outage was exactly this: the upstream download SUCCEEDED, the
 * data was already in memory, and then a concurrent cache prune deleted the temp
 * file so `fs.rename` threw `ENOENT`. That error propagated all the way out as
 * `Failed to get local forecast: ENOENT …` and discarded a perfectly good
 * forecast. The cache is an optimisation; its worst case must be "slow", never
 * "broken".
 *
 * This reproduces the shape of that failure without needing a race: point
 * `OGD_CACHE_DIR` at a regular FILE, so every cache write fails with ENOTDIR.
 * Any cache-layer fault would do — the assertion is about the caller's outcome.
 */

type GetCsvData = typeof import('../../src/data/ogd-data-store.js').getCsvData;

let getCsvData: GetCsvData;
let server: http.Server;
let baseUrl: string;
let cacheRoot: string;
let tmpDir: string;

const CSV = [
  'reference_timestamp;point_id;point_type_id;tre200h0',
  '05.09.2026 10:00;100;2;12.3',
  '05.09.2026 11:00;100;2;13.4',
  '',
].join('\n');

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ogd-cache-fault-'));
  // A regular file standing where the cache directory should be. `fs.mkdir`
  // inside writeToDiskCache then fails with ENOTDIR on every attempt.
  cacheRoot = path.join(tmpDir, 'not-a-directory');
  await fs.writeFile(cacheRoot, 'deliberately a file, not a directory');

  // Must be set before the module is imported: both flags are read at load time.
  process.env.USE_TEST_FIXTURES = 'false';
  process.env.OGD_CACHE_DIR = cacheRoot;

  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    res.end(CSV);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ({ getCsvData } = await import('../../src/data/ogd-data-store.js'));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getCsvData — a failing cache write must not fail the request', () => {
  it('returns the fetched rows even though every cache write fails', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rows = await getCsvData(
        `${baseUrl}/tre200h0.csv`,
        'forecasts/fault-ch/vnut12.lssw.202609051000.tre200h0.csv',
        'forecast'
      );

      // Real content, not just "an array": before the fix this call rejected.
      expect(rows).toHaveLength(2);
      expect(rows[0].point_id).toBe('100');
      expect(rows[0].tre200h0).toBe('12.3');
      expect(rows[1].tre200h0).toBe('13.4');

      // ...and the failure is reported rather than silently swallowed. A cache
      // error nothing logs is how this stayed invisible for a week.
      const logged = errors.mock.calls.map((args) => String(args[0])).join('\n');
      expect(logged).toContain('Cache write failed');
      expect(logged).toContain('forecasts/fault-ch/vnut12.lssw.202609051000.tre200h0.csv');
    } finally {
      errors.mockRestore();
    }
  });

  it('still serves data on a repeat call, since nothing was ever cached', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rows = await getCsvData(
        `${baseUrl}/tre200h0.csv`,
        'forecasts/fault-ch/vnut12.lssw.202609051000.tre200h0.csv',
        'forecast'
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].tre200h0).toBe('12.3');
    } finally {
      errors.mockRestore();
    }

    // The cache root is still the file we created — nothing was written under it.
    const stat = await fs.stat(cacheRoot);
    expect(stat.isFile()).toBe(true);
  });
});

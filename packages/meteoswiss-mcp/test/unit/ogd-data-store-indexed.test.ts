import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * getIndexedCsvData: parse once per cached file version, one download for
 * concurrent cold callers, and a cache fault must never fail the request.
 */

type Store = typeof import('../../src/data/ogd-data-store.js');
type Index = typeof import('../../src/data/ogd-forecast-index.js');

let store: Store;
let index: Index;
let server: http.Server;
let baseUrl: string;
let tmpDir: string;
let requests = 0;

const CSV = [
  'point_id;point_type_id;Date;tre200h0',
  '100;2;202609051000;12.3',
  '100;2;202609051100;13.4',
  '',
].join('\n');

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ogd-indexed-'));
  // Read at module load: must precede the dynamic imports.
  process.env.USE_TEST_FIXTURES = 'false';
  process.env.OGD_CACHE_DIR = path.join(tmpDir, 'cache');
  process.env.OGD_CACHE_TTL_FORECAST = '3600000';

  server = http.createServer((_req, res) => {
    requests++;
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
      res.end(CSV);
    }, 30);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  store = await import('../../src/data/ogd-data-store.js');
  index = await import('../../src/data/ogd-forecast-index.js');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function counted(): {
  build: (t: string) => ReturnType<typeof index.buildForecastIndex>;
  n: () => number;
} {
  let n = 0;
  return {
    build: (text) => {
      n++;
      return index.buildForecastIndex(text, 'tre200h0');
    },
    n: () => n,
  };
}

describe('getIndexedCsvData', () => {
  it('shares one download and one build between 8 concurrent cold callers, then serves warm', async () => {
    const key = 'forecasts/run-a/x.tre200h0.csv';
    const url = `${baseUrl}/a.csv`;
    const c = counted();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.getIndexedCsvData(url, key, 'forecast', c.build))
    );
    expect(requests).toBe(1);
    expect(c.n()).toBe(1);
    for (const r of results) {
      expect([...index.lookupForecastSeries(r, '100', '2').entries()]).toEqual([
        ['202609051000', 12.3],
        ['202609051100', 13.4],
      ]);
    }

    await store.getIndexedCsvData(url, key, 'forecast', c.build);
    expect(requests).toBe(1);
    expect(c.n()).toBe(1);
  });

  it('re-downloads and rebuilds once the cache file is past its TTL', async () => {
    const key = 'forecasts/run-b/x.tre200h0.csv';
    const url = `${baseUrl}/b.csv`;
    const c = counted();
    await store.getIndexedCsvData(url, key, 'forecast', c.build);
    const before = requests;

    const file = store.resolveCachePath(key);
    const old = new Date(Date.now() - 2 * 3_600_000);
    await fs.utimes(file, old, old);

    await store.getIndexedCsvData(url, key, 'forecast', c.build);
    expect(requests).toBe(before + 1);
    expect(c.n()).toBe(2);
  });

  it('rebuilds when the cache file is replaced by a fresh version', async () => {
    const key = 'forecasts/run-c/x.tre200h0.csv';
    const url = `${baseUrl}/c.csv`;
    const c = counted();
    await store.getIndexedCsvData(url, key, 'forecast', c.build);
    const file = store.resolveCachePath(key);
    await fs.writeFile(file, CSV.replace('12.3', '99.9'));

    const r = await store.getIndexedCsvData(url, key, 'forecast', c.build);
    expect(c.n()).toBe(2);
    expect(index.lookupForecastSeries(r, '100', '2').get('202609051000')).toBe(99.9);
  });

  it('does not cache a failed build', async () => {
    const key = 'forecasts/run-d/x.tre200h0.csv';
    const url = `${baseUrl}/d.csv`;
    await expect(
      store.getIndexedCsvData(url, key, 'forecast', () => {
        throw new Error('bad csv');
      })
    ).rejects.toThrow('bad csv');
    const c = counted();
    await store.getIndexedCsvData(url, key, 'forecast', c.build);
    expect(c.n()).toBe(1);
  });
});

describe('getIndexedCsvData — cache fault', () => {
  it('still returns data when the cache directory cannot be written', async () => {
    const blocker = path.join(tmpDir, 'blocker');
    await fs.writeFile(blocker, 'a file where a directory should be');
    const bad = path.join(blocker, 'sub');
    // The cache dir is fixed at module load; use a fresh module instance for this case.
    const { vi } = await import('vitest');
    vi.resetModules();
    process.env.OGD_CACHE_DIR = bad;
    const faulty = await import('../../src/data/ogd-data-store.js');
    const idx = await import('../../src/data/ogd-forecast-index.js');
    const r = await faulty.getIndexedCsvData(
      `${baseUrl}/e.csv`,
      'forecasts/e.csv',
      'forecast',
      (t) => idx.buildForecastIndex(t, 'tre200h0')
    );
    expect(idx.lookupForecastSeries(r, '100', '2').size).toBe(2);
  });
});

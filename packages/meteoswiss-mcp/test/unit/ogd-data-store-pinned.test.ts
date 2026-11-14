import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The cache prune never evicts the pinned area (`pinned/`), however old its files.
 *
 * Eviction goes by write age; the forecast regions are written once and kept for
 * 30 days, so without the pin the forecast churn would evict them first and the
 * server would download them again every few hours. Driven like the other prune
 * test: a successful `getCsvData` writes, then fires the prune.
 */

type GetCsvData = typeof import('../../src/data/ogd-data-store.js').getCsvData;

let getCsvData: GetCsvData;
let server: http.Server;
let baseUrl: string;
let cacheRoot: string;
const saved: Record<string, string | undefined> = {};

const CSV = 'reference_timestamp;point_id;point_type_id;tre200h0\n05.09.2026 10:00;100;2;12.3\n';

beforeAll(async () => {
  cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ogd-pinned-'));
  for (const name of ['USE_TEST_FIXTURES', 'OGD_CACHE_DIR', 'OGD_CACHE_MAX_BYTES']) {
    saved[name] = process.env[name];
  }
  process.env.USE_TEST_FIXTURES = 'false';
  process.env.OGD_CACHE_DIR = cacheRoot;
  process.env.OGD_CACHE_MAX_BYTES = '1000'; // far below what the files below hold

  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    res.end(CSV);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ({ getCsvData } = await import('../../src/data/ogd-data-store.js'));
});

afterAll(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(cacheRoot, { recursive: true, force: true });
});

describe('pruneDiskCache — pinned area', () => {
  it('evicts old forecast files but keeps old pinned files', async () => {
    const longAgo = new Date(Date.now() - 20 * 24 * 3_600_000);
    const pinned = path.join(cacheRoot, 'pinned', 'forecast-regions', 'jura.geojson');
    const old = path.join(cacheRoot, 'forecasts', '20260801-ch', 'old.tre200h0.csv');
    for (const file of [pinned, old]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'x'.repeat(5000));
      await fs.utimes(file, longAgo, longAgo);
    }

    await getCsvData(
      `${baseUrl}/tre200h0.csv`,
      'forecasts/20260905-ch/vnut12.lssw.202609051000.tre200h0.csv',
      'forecast'
    );
    // pruneDiskCache is fired unawaited after the write; give it a turn.
    await new Promise((resolve) => setTimeout(resolve, 250));

    await expect(fs.stat(old)).rejects.toThrow(/ENOENT/);
    expect((await fs.stat(pinned)).size).toBe(5000);
  });
});

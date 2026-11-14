import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The live path of the forecast-region loader, against a local server that
 * serves the synthetic fixtures: download once, cache on disk in the pinned
 * area, serve the last good set when a refresh fails, never half-replace a set.
 */

type Module = typeof import('../../src/data/forecast-regions.js');

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../__fixtures__/forecast-regions'
);
const IDS = [
  'jura',
  'mittelland',
  'alpennordhang',
  'wallis',
  'engadin',
  'nordundmittelbuenden',
  'alpensuedseite',
];

let mod: Module;
let server: http.Server;
let cacheRoot: string;
let requests: string[] = [];
/** What the server answers: the fixtures, 500 for everything, or one broken file. */
let mode: 'ok' | 'fail' | 'bad-wallis' | 'lv95-jura' = 'ok';
const saved: Record<string, string | undefined> = {};

const regionDir = (): string => path.join(cacheRoot, 'pinned', 'forecast-regions');

async function backdateCache(days: number): Promise<void> {
  const then = new Date(Date.now() - days * 24 * 3_600_000);
  for (const id of IDS) {
    await fs.utimes(path.join(regionDir(), `${id}.geojson`), then, then);
  }
}

beforeAll(async () => {
  cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'forecast-regions-'));
  server = http.createServer((req, res) => {
    const name = path.basename(req.url ?? '');
    requests.push(name);
    if (mode === 'fail') {
      res.writeHead(500);
      res.end();
      return;
    }
    if (mode === 'bad-wallis' && name === 'wallis.geojson') {
      res.writeHead(200, { 'content-type': 'application/geo+json' });
      res.end('<html>maintenance</html>');
      return;
    }
    if (mode === 'lv95-jura' && name === 'jura.geojson') {
      res.writeHead(200, { 'content-type': 'application/geo+json' });
      res.end(
        JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [2560000, 1200000],
              [2570000, 1200000],
              [2570000, 1210000],
              [2560000, 1200000],
            ],
          ],
        })
      );
      return;
    }
    fs.readFile(path.join(FIXTURES, name), 'utf-8').then(
      (text) => {
        res.writeHead(200, { 'content-type': 'application/geo+json' });
        res.end(text);
      },
      () => {
        res.writeHead(404);
        res.end();
      }
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  for (const name of ['USE_TEST_FIXTURES', 'OGD_CACHE_DIR', 'FORECAST_REGIONS_BASE_URL']) {
    saved[name] = process.env[name];
  }
  process.env.USE_TEST_FIXTURES = 'false';
  process.env.OGD_CACHE_DIR = cacheRoot;
  process.env.FORECAST_REGIONS_BASE_URL = `http://127.0.0.1:${port}/regions`;
  mod = await import('../../src/data/forecast-regions.js');
});

afterAll(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(cacheRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  mod.resetForecastRegions();
  requests = [];
  mode = 'ok';
  vi.restoreAllMocks();
});

describe('getForecastRegions — live path', () => {
  it('downloads the seven files once and caches them in the pinned area', async () => {
    await fs.rm(regionDir(), { recursive: true, force: true });

    const set = await mod.getForecastRegions();
    expect(set.regions.map((r) => r.id)).toEqual(IDS);
    expect(set.regions.every((r) => r.polygons.length > 0)).toBe(true);
    expect([...requests].sort()).toEqual(IDS.map((id) => `${id}.geojson`).sort());
    expect((await fs.readdir(regionDir())).sort()).toEqual(IDS.map((id) => `${id}.geojson`).sort());

    // Same process: served from memory, no request.
    expect(await mod.getForecastRegions()).toBe(set);
    expect(requests).toHaveLength(7);
  });

  it('reads a fresh disk copy without any request', async () => {
    await mod.getForecastRegions(); // make sure the cache exists
    mod.resetForecastRegions();
    requests = [];

    const set = await mod.getForecastRegions();
    expect(set.regions).toHaveLength(7);
    expect(requests).toHaveLength(0);
  });

  it('downloads again once the disk copy is older than the TTL', async () => {
    await mod.getForecastRegions();
    await backdateCache(31);
    mod.resetForecastRegions();
    requests = [];

    const set = await mod.getForecastRegions();
    expect(requests).toHaveLength(7);
    expect(Date.now() - set.fetchedAt).toBeLessThan(60_000);
  });

  it('serves the stale copy when a refresh fails, and waits before trying again', async () => {
    await mod.getForecastRegions();
    await backdateCache(31);
    mod.resetForecastRegions();
    requests = [];
    mode = 'fail';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const set = await mod.getForecastRegions();
    expect(set.regions).toHaveLength(7);
    expect(Date.now() - set.fetchedAt).toBeGreaterThan(30 * 24 * 3_600_000);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Refresh failed, serving the copy from'),
      expect.any(String)
    );

    const tried = requests.length;
    expect(tried).toBeGreaterThan(0);
    expect(await mod.getForecastRegions()).toBe(set);
    expect(requests).toHaveLength(tried); // back-off: no new request
  });

  it('does not replace a good set when one file is broken', async () => {
    await mod.getForecastRegions();
    await backdateCache(31);
    mod.resetForecastRegions();
    mode = 'bad-wallis';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const set = await mod.getForecastRegions();
    expect(Date.now() - set.fetchedAt).toBeGreaterThan(30 * 24 * 3_600_000);
    // the broken file was not written over the good one
    const wallis = await fs.readFile(path.join(regionDir(), 'wallis.geojson'), 'utf-8');
    expect(wallis).toContain('FeatureCollection');
  });

  it('rejects a file in projected coordinates', async () => {
    await fs.rm(regionDir(), { recursive: true, force: true });
    mode = 'lv95-jura';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(mod.getForecastRegions()).rejects.toThrow(/jura.*outside Switzerland/);
  });

  it('fails fast without a copy until the retry time', async () => {
    await fs.rm(regionDir(), { recursive: true, force: true });
    mode = 'fail';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(mod.getForecastRegions()).rejects.toThrow(/forecast regions are unavailable/);
    const tried = requests.length;
    mode = 'ok';
    await expect(mod.getForecastRegions()).rejects.toThrow(/forecast regions are unavailable/);
    expect(requests).toHaveLength(tried);
  });

  it('shares one load between concurrent callers', async () => {
    await fs.rm(regionDir(), { recursive: true, force: true });

    const [a, b, c] = await Promise.all([
      mod.getForecastRegions(),
      mod.getForecastRegions(),
      mod.getForecastRegions(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(requests).toHaveLength(7);
  });
});

import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The cache prune reclaims empty directories.
 *
 * Eviction only ever deleted files, so the dated `forecasts/<item-id>/` folders
 * accumulated one per day forever — 42 of 43 on the production container were
 * empty husks. `removeEmptyDirs` now runs at the end of every prune pass.
 *
 * `pruneDiskCache` is internal, so this drives it the way production does: via a
 * successful `getCsvData`, which fires a prune after writing.
 *
 * Reclamation is **age-gated**, which is load-bearing rather than tidiness: a
 * directory is created by `mkdir` and only populated a few awaits later, when
 * `write-file-atomic` opens its temp file inside it. Reaping one in that window
 * makes the write fail `ENOENT` — the exact error this change set removes.
 * So the husks below are backdated to simulate age, and a second test asserts a
 * *young* empty directory is deliberately left alone.
 */

type GetCsvData = typeof import('../../src/data/ogd-data-store.js').getCsvData;

let getCsvData: GetCsvData;
let server: http.Server;
let baseUrl: string;
let cacheRoot: string;

const CSV = 'reference_timestamp;point_id;point_type_id;tre200h0\n05.09.2026 10:00;100;2;12.3\n';

beforeAll(async () => {
  cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ogd-prune-'));
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
  await fs.rm(cacheRoot, { recursive: true, force: true });
});

describe('pruneDiskCache — empty directory reclamation', () => {
  it('removes stale empty dated directories but keeps the one holding data', async () => {
    // Three days' worth of husks, exactly as production accumulated them.
    const husks = ['20260724-ch', '20260725-ch', '20260726-ch'];
    const longAgo = new Date(Date.now() - 24 * 60 * 60_000);
    for (const husk of husks) {
      const dir = path.join(cacheRoot, 'forecasts', husk);
      await fs.mkdir(dir, { recursive: true });
      // Backdate: real husks are days old. A directory created microseconds ago
      // is indistinguishable from one a write is about to land in, and is spared
      // on purpose — see the second test.
      await fs.utimes(dir, longAgo, longAgo);
    }

    const rows = await getCsvData(
      `${baseUrl}/tre200h0.csv`,
      'forecasts/20260905-ch/vnut12.lssw.202609051000.tre200h0.csv',
      'forecast'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tre200h0).toBe('12.3');

    // pruneDiskCache is fired unawaited after the write; give it a turn.
    await new Promise((resolve) => setTimeout(resolve, 250));

    for (const husk of husks) {
      await expect(fs.stat(path.join(cacheRoot, 'forecasts', husk))).rejects.toThrow(/ENOENT/);
    }

    // The directory that actually holds the cached file must survive.
    const kept = await fs.readdir(path.join(cacheRoot, 'forecasts', '20260905-ch'));
    expect(kept).toContain('vnut12.lssw.202609051000.tre200h0.csv');
  });

  it('spares a freshly created empty directory, so a starting write is not reaped', async () => {
    // The F1 race: writeToDiskCache mkdirs, then write-file-atomic awaits three
    // times before opening its temp file. A prune that reaps the directory in
    // that window turns a completed 30 MB download into a failed cache write.
    // Reproduced at 35-56% before the age gate.
    const fresh = path.join(cacheRoot, 'forecasts', '20260908-ch');
    await fs.mkdir(fresh, { recursive: true });

    await getCsvData(
      `${baseUrl}/tre200h0.csv`,
      'forecasts/20260906-ch/vnut12.lssw.202609061000.tre200h0.csv',
      'forecast'
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Empty and reapable by the old rule; young, so deliberately still here.
    const stats = await fs.stat(fresh);
    expect(stats.isDirectory()).toBe(true);
    expect(await fs.readdir(fresh)).toHaveLength(0);
  });
});

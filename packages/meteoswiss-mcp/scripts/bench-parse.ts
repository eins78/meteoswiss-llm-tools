/**
 * Micro-benchmark for the forecast CSV parse alone (no network, no MCP).
 *
 * Reads the six hourly forecast CSVs of one run from disk and builds the per-point
 * index for each, which is the work a cold forecast request does. Prints one
 * number, `parse_ms` (median over the runs of the summed read+build time), and
 * the process peak RSS.
 *
 * Usage (from packages/meteoswiss-mcp/):
 *   npx tsx scripts/bench-parse.ts [--runs 5]
 *   npx tsx scripts/bench-parse.ts --dump fixture.json     # record the correctness fixture
 *   npx tsx scripts/bench-parse.ts --check fixture.json    # exit 1 unless output is identical
 *
 * Files come from PARSE_BENCH_DIR, or else the newest run directory under the
 * bench disk cache that `scripts/bench-forecast.ts --warm` populates. A file is
 * matched by its parameter name (`<param>.csv`, with any prefix).
 *
 * The fixture holds a SHA-256 over every point's complete series per parameter
 * (not a sample), plus a readable sample of a few points.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildForecastIndex, lookupForecastSeries } from '../src/data/ogd-forecast-index.js';

const PARAMS = ['tre200h0', 'rre150h0', 'jww003i0', 'sre000h0', 'fu3010h0', 'fu3010h1'] as const;

function findDir(): string {
  if (process.env.PARSE_BENCH_DIR) return process.env.PARSE_BENCH_DIR;
  const root = path.join(
    process.env.BENCH_CACHE_DIR ?? path.join(os.tmpdir(), 'meteoswiss-bench-cache'),
    'forecasts'
  );
  const runs = fs.readdirSync(root).sort();
  const latest = runs.at(-1);
  if (latest === undefined) throw new Error(`no forecast runs under ${root}`);
  return path.join(root, latest);
}

function fileFor(dir: string, param: string): string {
  const name = fs.readdirSync(dir).find((f) => f === `${param}.csv` || f.endsWith(`.${param}.csv`));
  if (name === undefined) throw new Error(`no ${param}.csv in ${dir}`);
  return path.join(dir, name);
}

async function buildAll(dir: string): Promise<Map<string, ReturnType<typeof buildForecastIndex>>> {
  const out = new Map<string, ReturnType<typeof buildForecastIndex>>();
  for (const param of PARAMS) {
    out.set(param, buildForecastIndex(await fsp.readFile(fileFor(dir, param)), param));
  }
  return out;
}

type Fixture = { hashes: Record<string, string>; points: Record<string, string>; bytes: number };

async function fingerprint(dir: string): Promise<Fixture> {
  const built = await buildAll(dir);
  const hashes: Record<string, string> = {};
  const points: Record<string, string> = {};
  let bytes = 0;
  for (const [param, { value: index, bytes: size }] of built) {
    bytes += size;
    const hash = createHash('sha256');
    const keys = [...index.points.keys()].sort();
    hash.update(`${keys.length}\n`);
    for (const key of keys) {
      const [id, type] = key.split(':') as [string, string];
      const series = lookupForecastSeries(index, id, type);
      hash.update(`${key}#${series.size}\n`);
      for (const [ts, value] of series) hash.update(`${ts}=${value}\n`);
    }
    hashes[param] = hash.digest('hex');
    for (const key of [keys[0]!, keys[Math.floor(keys.length / 2)]!, keys.at(-1)!]) {
      const [id, type] = key.split(':') as [string, string];
      points[`${param}/${key}`] = JSON.stringify(
        [...lookupForecastSeries(index, id, type)].slice(0, 12)
      );
    }
  }
  return { hashes, points, bytes };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = findDir();
  const dumpIdx = args.indexOf('--dump');
  const checkIdx = args.indexOf('--check');

  if (dumpIdx >= 0) {
    const fx = await fingerprint(dir);
    fs.writeFileSync(args[dumpIdx + 1]!, JSON.stringify(fx, null, 1));
    console.log(`fixture written: ${Object.keys(fx.hashes).length} params`);
    return;
  }
  if (checkIdx >= 0) {
    const expected = JSON.parse(fs.readFileSync(args[checkIdx + 1]!, 'utf-8')) as Fixture;
    const actual = await fingerprint(dir);
    const same =
      JSON.stringify(expected.hashes) === JSON.stringify(actual.hashes) &&
      JSON.stringify(expected.points) === JSON.stringify(actual.points);
    console.log(same ? 'guard: identical' : 'guard: MISMATCH');
    process.exit(same ? 0 : 1);
  }

  const runsIdx = args.indexOf('--runs');
  const runs = runsIdx >= 0 ? Number(args[runsIdx + 1]) : 5;
  const totals: number[] = [];
  let retained = 0;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const built = await buildAll(dir);
    totals.push(performance.now() - start);
    retained = [...built.values()].reduce((sum, b) => sum + b.bytes, 0);
  }
  totals.sort((a, b) => a - b);
  const median = Math.round(totals[Math.floor(runs / 2)]!);
  console.error(
    `runs ${totals.map((t) => Math.round(t)).join('/')} ms, peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MiB, retained ${Math.round(retained / 1048576)} MiB`
  );
  console.log(`parse_ms ${median}`);
}

void main();

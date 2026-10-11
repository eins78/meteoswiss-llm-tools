/**
 * Benchmark for the local-forecast data path with a WARM disk cache.
 *
 * Measures wall time and peak RSS of `getLocalForecast`, which downloads
 * (disk-cached) forecast CSVs and parses them per request. Live network on the
 * first `--warm` run only; every scenario afterwards is served from the disk cache.
 *
 * Usage (from packages/meteoswiss-mcp/):
 *   npx tsx scripts/bench-forecast.ts --warm            # populate disk cache, print forecast run id
 *   npx tsx scripts/bench-forecast.ts [--reps 3]        # run all scenarios, each in a fresh process
 *
 * Env: BENCH_CACHE_DIR (default <tmpdir>/meteoswiss-bench-cache) is used as OGD_CACHE_DIR.
 * The disk-cache TTL is raised so a long bench session never goes stale mid-run.
 *
 * Scenarios (each a fresh child process; peak RSS = process.resourceUsage().maxRSS):
 *   single-first       1 call            (warm disk, cold in-process state)
 *   single-repeat      2 calls in series (reports the 2nd)
 *   concurrent8        8 distinct locations at once (fresh process)
 *   concurrent8-warmed 1 call, then 8 distinct locations at once
 */

import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

const LOCATIONS = ['8001', '4051', '3011', '1204', '6900', '9000', 'SMA', 'BAS'];
const SCENARIOS = ['single-first', 'single-repeat', 'concurrent8', 'concurrent8-warmed'] as const;
type Scenario = (typeof SCENARIOS)[number];

const cacheDir = process.env.BENCH_CACHE_DIR ?? path.join(os.tmpdir(), 'meteoswiss-bench-cache');

function isScenario(value: string): value is Scenario {
  return (SCENARIOS as readonly string[]).includes(value);
}

async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const start = performance.now();
  await fn();
  return Math.round(performance.now() - start);
}

async function runChild(scenario: Scenario): Promise<void> {
  const { getLocalForecast } = await import('../src/data/ogd-local-forecast.js');
  const call = (location: string): Promise<unknown> => getLocalForecast({ location, days: 3 });
  const times: number[] = [];
  let wall = 0;

  if (scenario === 'single-first') {
    wall = await timed(() => call(LOCATIONS[0]!));
  } else if (scenario === 'single-repeat') {
    await call(LOCATIONS[0]!);
    wall = await timed(() => call(LOCATIONS[1]!));
  } else {
    if (scenario === 'concurrent8-warmed') await call(LOCATIONS[0]!);
    const start = performance.now();
    await Promise.all(
      LOCATIONS.map(async (location) => {
        const t0 = performance.now();
        await call(location);
        times.push(Math.round(performance.now() - t0));
      })
    );
    wall = Math.round(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      scenario,
      wallMs: wall,
      perCallMs: times.sort((a, b) => a - b),
      peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024), // KiB on darwin/linux → MiB
    })
  );
}

async function runWarm(): Promise<void> {
  const { getLatestItem } = await import('../src/data/ogd-stac-client.js');
  const { OGD_COLLECTIONS } = await import('../src/schemas/ogd-shared.js');
  const item = await getLatestItem(OGD_COLLECTIONS.LOCAL_FORECASTING);
  const { getLocalForecast } = await import('../src/data/ogd-local-forecast.js');
  // Station + postal code so both daily and hourly-only parameter sets are cached.
  await getLocalForecast({ location: 'SMA', days: 3 });
  await getLocalForecast({ location: '8001', days: 3 });
  console.log(`warmed forecast run: ${item.id} (cache dir ${cacheDir})`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function main(): void {
  const args = process.argv.slice(2);
  const childIdx = args.indexOf('--child');
  if (childIdx >= 0) {
    const scenario = args[childIdx + 1] ?? '';
    if (!isScenario(scenario)) throw new Error(`unknown scenario ${scenario}`);
    void runChild(scenario);
    return;
  }
  if (args.includes('--warm')) {
    void runWarm();
    return;
  }
  const repsIdx = args.indexOf('--reps');
  const reps = repsIdx >= 0 ? Number(args[repsIdx + 1]) : 3;
  console.log(`cache dir: ${cacheDir}, reps: ${reps}`);
  for (const scenario of SCENARIOS) {
    const walls: number[] = [];
    const rss: number[] = [];
    for (let i = 0; i < reps; i++) {
      const res = spawnSync(
        process.execPath,
        [...process.execArgv, process.argv[1]!, '--child', scenario],
        { encoding: 'utf-8', env: childEnv(), maxBuffer: 1 << 20 }
      );
      if (res.status !== 0) throw new Error(`child failed: ${res.stderr}`);
      const line = res.stdout.trim().split('\n').at(-1)!;
      const parsed = JSON.parse(line) as { wallMs: number; peakRssMb: number; perCallMs: number[] };
      walls.push(parsed.wallMs);
      rss.push(parsed.peakRssMb);
      console.log(`  ${scenario} rep${i + 1}: ${line}`);
    }
    console.log(
      `${scenario}: median wall ${median(walls)} ms, median peak RSS ${median(rss)} MiB (walls ${walls.join('/')})`
    );
  }
}

function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    USE_TEST_FIXTURES: 'false',
    OGD_CACHE_DIR: cacheDir,
    OGD_CACHE_TTL_FORECAST: '86400000',
    OGD_CACHE_TTL_METADATA: '86400000',
  };
}

// Env must be in place before the data modules are imported (read at load time).
if (process.argv.includes('--warm') || process.argv.includes('--child')) {
  Object.assign(process.env, childEnv());
}
main();

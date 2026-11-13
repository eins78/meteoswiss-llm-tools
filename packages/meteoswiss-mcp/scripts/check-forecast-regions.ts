/**
 * Live check of the forecast regions (network; run by hand, not in CI).
 *
 * Downloads MeteoSwiss's seven region files and the forecast point list into a
 * temporary cache, assigns every point and prints the points per region, how
 * many took the nearest region, and spot checks of well-known places. Exits 1
 * if a spot check fails. The counts of 2026-11-11 are printed alongside: a
 * difference means MeteoSwiss changed the files or the point list.
 *
 * Usage (from packages/meteoswiss-mcp/):
 *   npx tsx scripts/check-forecast-regions.ts
 *
 * Env: FORECAST_REGIONS_CHECK_CACHE_DIR keeps the cache (default: a fresh temp dir, removed after).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Points per region on 2026-11-11 (5,820 points, 51 outside all seven). */
const COUNTS_2026_11_11: Record<string, number> = {
  jura: 691,
  mittelland: 2521,
  alpennordhang: 1015,
  wallis: 530,
  engadin: 90,
  nordundmittelbuenden: 341,
  alpensuedseite: 581,
};

/** Place name (exact `point_name`), point type, expected region, expected method. */
const SPOT_CHECKS: [string, number, string, 'inside' | 'nearest'][] = [
  ['Zürich', 2, 'mittelland', 'inside'],
  ['Bern', 2, 'mittelland', 'inside'],
  ['Basel', 2, 'jura', 'inside'],
  ['La Chaux-de-Fonds', 2, 'jura', 'inside'],
  ['Luzern', 2, 'alpennordhang', 'inside'],
  ['Vaduz', 2, 'alpennordhang', 'inside'],
  ['Sion', 2, 'wallis', 'inside'],
  ['Chur', 2, 'nordundmittelbuenden', 'inside'],
  ['St. Moritz', 2, 'engadin', 'inside'],
  ['Lugano', 2, 'alpensuedseite', 'inside'],
  ['Andermatt', 2, 'alpennordhang', 'nearest'],
];

async function main(): Promise<void> {
  const keep = process.env.FORECAST_REGIONS_CHECK_CACHE_DIR;
  const cacheDir = keep ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'forecast-regions-check-')));
  process.env.OGD_CACHE_DIR = cacheDir;
  process.env.USE_TEST_FIXTURES = 'false';

  try {
    // Imported after the env is set: the modules read it at load time.
    const { getForecastRegions } = await import('../src/data/forecast-regions.js');
    const { getPointRegions, pointKey } = await import('../src/data/forecast-point-regions.js');
    const { getForecastPoints } = await import('../src/data/ogd-station-resolver.js');
    const { FORECAST_REGION_SOURCE } = await import('../src/data/forecast-regions-source.js');

    const started = Date.now();
    const set = await getForecastRegions();
    console.log(`regions from ${FORECAST_REGION_SOURCE.baseUrl} (${Date.now() - started} ms)`);
    const points = await getForecastPoints();
    const assignStarted = Date.now();
    const byPoint = await getPointRegions();
    console.log(`${points.length} points assigned in ${Date.now() - assignStarted} ms\n`);

    // Counted per row of the point list, like the 2026-11-11 numbers (it lists a few stations twice).
    const rows = points.map((p) => byPoint.get(pointKey(p.point_id, p.point_type_id)));
    console.log('| region | polygons | inside | 2026-11-11 | nearest |\n|---|---:|---:|---:|---:|');
    for (const region of set.regions) {
      const all = rows.filter((r) => r?.region === region.id);
      const inside = all.filter((r) => r?.method === 'inside').length;
      console.log(
        `| ${region.id} | ${region.polygons.length} | ${inside} | ${COUNTS_2026_11_11[region.id] ?? '-'} | ${all.length - inside} |`
      );
    }
    const nearest = points.filter(
      (p) => byPoint.get(pointKey(p.point_id, p.point_type_id))?.method === 'nearest'
    );
    console.log(`\nnearest region (${nearest.length}, 51 on 2026-11-11):`);
    for (const p of nearest) {
      const r = byPoint.get(pointKey(p.point_id, p.point_type_id));
      console.log(`  ${p.name} (${p.elevation} m) → ${r?.region}, ${r?.distanceKm.toFixed(1)} km`);
    }

    let failures = 0;
    console.log('\nspot checks:');
    for (const [name, type, region, method] of SPOT_CHECKS) {
      const p = points.find((x) => x.name === name && x.point_type_id === type);
      const r = p ? byPoint.get(pointKey(p.point_id, p.point_type_id)) : undefined;
      const ok = r?.region === region && r.method === method;
      if (!ok) failures++;
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${r ? `${r.region} (${r.method})` : 'no point'}, expected ${region} (${method})`
      );
    }
    process.exitCode = failures > 0 ? 1 : 0;
  } finally {
    if (!keep) await fs.rm(cacheDir, { recursive: true, force: true });
  }
}

void main();

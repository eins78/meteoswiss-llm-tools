/**
 * Counting for the weather-situation tool: categorised point-hours into
 * region × altitude band tables. Pure functions over in-memory samples, so
 * they can be tested with any number of synthetic points.
 */

import { WEATHER_CATEGORIES, type WeatherCategory } from '../support/weather-categories.js';
import { FORECAST_REGIONS, type ForecastRegionId } from './forecast-regions-source.js';

/** One categorised point-hour. */
export type SituationSample = {
  /** Point key `point_id:point_type_id`; a point counts once however many hours it has. */
  point: string;
  region: ForecastRegionId;
  /** Altitude in m above sea level. */
  altitude: number;
  category: WeatherCategory;
};

/** Shares per category in integer percent, largest first; categories at 0 are left out. */
export type CategoryPct = Partial<Record<WeatherCategory, number>>;

/** One altitude band of one region. */
export type BandCount = {
  /** e.g. `"<500"`, `"500-999"`, `">=2000"` */
  band: string;
  points: number;
  pct: CategoryPct;
  dominant: WeatherCategory;
};

/** One region with its altitude bands (bands without points are left out). */
export type RegionCount = {
  id: ForecastRegionId;
  points: number;
  dominant: WeatherCategory;
  bands: BandCount[];
};

/** Default band edges in m. */
export const DEFAULT_BAND_EDGES: readonly number[] = [500, 1000, 1500, 2000];

/** At most this many edges (so at most one more band). */
export const MAX_BAND_EDGES = 10;

/**
 * Check band edges: whole metres, strictly ascending, 1 to 4800, at most {@link MAX_BAND_EDGES}.
 *
 * @throws {RangeError} With a message for the caller
 */
export function checkBandEdges(edges: readonly number[]): void {
  if (edges.length > MAX_BAND_EDGES) {
    throw new RangeError(`bands: at most ${MAX_BAND_EDGES} edges, got ${edges.length}`);
  }
  edges.forEach((edge, i) => {
    if (!Number.isInteger(edge) || edge < 1 || edge > 4800) {
      throw new RangeError(`bands: each edge is a whole number of metres from 1 to 4800 (${edge})`);
    }
    const prev = edges[i - 1];
    if (prev !== undefined && edge <= prev) {
      throw new RangeError(`bands: edges must be strictly ascending (${prev}, ${edge})`);
    }
  });
}

/**
 * Band labels for edges: `[500, 1000]` → `["<500", "500-999", ">=1000"]`; no edges → `["all"]`.
 */
export function bandLabels(edges: readonly number[]): string[] {
  if (edges.length === 0) return ['all'];
  const labels = [`<${edges[0]}`];
  for (let i = 1; i < edges.length; i++) {
    labels.push(`${edges[i - 1]}-${(edges[i] ?? 0) - 1}`);
  }
  labels.push(`>=${edges[edges.length - 1]}`);
  return labels;
}

/** Index of the band an altitude falls in (the number of edges at or below it). */
export function bandIndex(edges: readonly number[], altitude: number): number {
  let i = 0;
  while (i < edges.length && altitude >= (edges[i] ?? Infinity)) i++;
  return i;
}

/**
 * Integer shares that add up to 100 (largest remainder), largest first, zeros left out.
 *
 * @param counts - Count per category, indexed like {@link WEATHER_CATEGORIES}
 * @returns The shares and the most frequent category (legend order breaks ties),
 *   or null if all counts are 0
 */
export function sharesPct(
  counts: readonly number[]
): { pct: CategoryPct; dominant: WeatherCategory } | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const parts = WEATHER_CATEGORIES.map((category, i) => {
    const exact = ((counts[i] ?? 0) * 100) / total;
    return { category, count: counts[i] ?? 0, whole: Math.floor(exact), rest: exact % 1, i };
  });
  let left = 100 - parts.reduce((a, p) => a + p.whole, 0);
  for (const p of [...parts].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (left === 0) break;
    p.whole++;
    left--;
  }
  const ordered = parts.filter((p) => p.count > 0).sort((a, b) => b.count - a.count || a.i - b.i);
  const pct: CategoryPct = {};
  for (const p of ordered) {
    if (p.whole > 0) pct[p.category] = p.whole;
  }
  const first = ordered[0];
  return first ? { pct, dominant: first.category } : null;
}

type Tally = { points: Set<string>; counts: number[] };

const newTally = (): Tally => ({
  points: new Set(),
  counts: new Array<number>(WEATHER_CATEGORIES.length).fill(0),
});

const CATEGORY_INDEX: ReadonlyMap<WeatherCategory, number> = new Map(
  WEATHER_CATEGORIES.map((c, i) => [c, i] as const)
);

/**
 * Count samples per region and altitude band.
 *
 * `points` counts distinct points; the shares count samples, so over a window
 * of several hours they are shares of point-hours.
 *
 * @param samples - Categorised point-hours
 * @param edges - Band edges (checked with {@link checkBandEdges})
 * @returns Regions in MeteoSwiss's order, only those with samples
 */
export function countSituation(
  samples: Iterable<SituationSample>,
  edges: readonly number[]
): RegionCount[] {
  const labels = bandLabels(edges);
  const byRegion = new Map<ForecastRegionId, { all: Tally; bands: Tally[] }>();
  for (const s of samples) {
    let region = byRegion.get(s.region);
    if (!region) {
      region = { all: newTally(), bands: labels.map(newTally) };
      byRegion.set(s.region, region);
    }
    const c = CATEGORY_INDEX.get(s.category) ?? 0;
    const band = region.bands[bandIndex(edges, s.altitude)] ?? newTally();
    for (const tally of [region.all, band]) {
      tally.points.add(s.point);
      tally.counts[c] = (tally.counts[c] ?? 0) + 1;
    }
  }

  const out: RegionCount[] = [];
  for (const { id } of FORECAST_REGIONS) {
    const region = byRegion.get(id);
    const all = region && sharesPct(region.all.counts);
    if (!region || !all) continue;
    const bands: BandCount[] = [];
    region.bands.forEach((tally, i) => {
      const shares = sharesPct(tally.counts);
      if (shares) {
        bands.push({ band: labels[i] ?? '', points: tally.points.size, ...shares });
      }
    });
    out.push({ id, points: region.all.points.size, dominant: all.dominant, bands });
  }
  return out;
}

/**
 * Fog top of a fog sea, from the categorised forecast points of one region.
 * Experimental: the thresholds are a first guess, to be checked against
 * observed fog mornings before the field is trusted.
 *
 * Method:
 * 1. Group the points into 100 m altitude bands; a band counts if it has at
 *    least 5 points (thinner bands are skipped).
 * 2. The lowest counting band must itself be at least 50 % `fog_or_stratus`,
 *    and start below `maxBaseM` (1000 m): a fog sea lies on the lowlands, cloud
 *    on the summits is not one.
 * 3. Walk up while the counting bands stay at least 50 % `fog_or_stratus`; the
 *    fog top is the upper edge of the last such band.
 * 4. At least 60 % of the points in the 300 m above the top (and at least 5 of
 *    them) must be sunny, partly sunny or a clear night. Otherwise there is no
 *    fog top: low cloud with more cloud above, or nothing to see above, is not
 *    a fog sea.
 *
 * Why step 2 demands that the lowest band itself is foggy: a looser walk, which
 * started the layer at the lowest foggy band, found a "fog sea" with its top at
 * 900 m on the run of 2026-11-11 11 UTC (valid 2026-11-14 10:00), where the
 * Swiss Plateau's 300-499 m bands were 17 % and 38 % fog, 500-899 m were
 * 57-81 %, and 77 % of the points above were clear. Below such a base the
 * lowlands are mostly clear (in that run 48-65 % of the points below the base,
 * half or more of the region): fog on the higher ground, not a sea. This rule
 * returns null there. The looser walk is a one-line change: skip a non-foggy
 * band below the layer instead of stopping. Every threshold is a constant here
 * so a replay against observed fog mornings can tune it.
 */

import type { WeatherCategory } from '../support/weather-categories.js';
import type { ForecastRegionId } from './forecast-regions-source.js';

/** Regions north of the Alps, where a fog sea forms over the lowlands. */
export const FOG_TOP_REGIONS: readonly ForecastRegionId[] = ['jura', 'mittelland', 'alpennordhang'];

/** Thresholds of the method. */
export const FOG_TOP_RULE = {
  bandM: 100,
  minBandPoints: 5,
  minFogShare: 0.5,
  maxBaseM: 1000,
  aboveM: 300,
  minAbovePoints: 5,
  minClearShare: 0.6,
} as const;

const CLEAR: ReadonlySet<WeatherCategory> = new Set(['sunny', 'partly_sunny', 'clear_night']);

/** A fog top found. */
export type FogTop = {
  /** Fog top in m above sea level, a multiple of 100 */
  topM: number;
  /** Share of sunny, partly sunny or clear points in the 300 m above, whole percent */
  clearAbovePct: number;
  /** Points the estimate rests on: the fog layer's bands and the 300 m above */
  points: number;
};

/**
 * Estimate the fog top of one region.
 *
 * @param samples - Categorised point-hours of the region
 * @returns The fog top, or null if the points show no fog sea with sun above
 */
export function fogTop(
  samples: readonly { altitude: number; category: WeatherCategory }[]
): FogTop | null {
  const { bandM, minBandPoints, minFogShare, maxBaseM, aboveM, minAbovePoints, minClearShare } =
    FOG_TOP_RULE;
  const bands = new Map<number, { total: number; fog: number }>();
  for (const s of samples) {
    const band = Math.floor(s.altitude / bandM);
    const tally = bands.get(band) ?? { total: 0, fog: 0 };
    tally.total++;
    if (s.category === 'fog_or_stratus') tally.fog++;
    bands.set(band, tally);
  }
  const counting = [...bands.entries()]
    .filter(([, t]) => t.total >= minBandPoints)
    .sort(([a], [b]) => a - b);

  let topBand: number | null = null;
  let layerPoints = 0;
  for (const [band, tally] of counting) {
    // The layer ended, or the lowest counting band is not foggy: no fog sea.
    if (tally.fog / tally.total < minFogShare) break;
    if (topBand === null && band * bandM >= maxBaseM) break; // a base this high is no fog sea
    topBand = band;
    layerPoints += tally.total;
  }
  if (topBand === null) return null;

  const topM = (topBand + 1) * bandM;
  const above = samples.filter((s) => s.altitude >= topM && s.altitude < topM + aboveM);
  const clear = above.filter((s) => CLEAR.has(s.category)).length;
  if (above.length < minAbovePoints || clear / above.length < minClearShare) return null;
  return {
    topM,
    clearAbovePct: Math.round((clear * 100) / above.length),
    points: layerPoints + above.length,
  };
}

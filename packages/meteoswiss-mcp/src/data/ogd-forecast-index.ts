/**
 * Compact per-point index of one forecast parameter CSV.
 *
 * A forecast CSV is ~33 MB / 1.3 M rows covering ~5.8 k points, but one request
 * reads a single point's series. Retaining parsed `CsvRow` objects would cost
 * hundreds of MB per file, so this keeps only what the forecast tool reads: for
 * each `(point_id, point_type_id)`, its timestamps (as indices into an interned
 * table) and values (NaN ⇔ missing).
 *
 * Built by driving the shared `parseCsv` with a recording filter, so quoting,
 * trimming and `-`/empty → null semantics are identical to the uncached path.
 */

import { parseCsv, parseNumeric, type CsvRow } from '../support/ogd-csv-parser.js';
import type { MemoBuild } from './ogd-parse-memo.js';

/** One point's series: parallel arrays, in file order. */
type PointSeries = { timestamps: Uint32Array; values: Float64Array };

/** Parsed index of one forecast CSV. */
export type ForecastIndex = {
  /** Interned `Date` strings, referenced by `PointSeries.timestamps`. */
  timestampTable: string[];
  points: Map<string, PointSeries>;
};

/** Approximate per-entry overhead of a Map key + object, beyond the typed arrays. */
const POINT_OVERHEAD_BYTES = 160;
/** Approximate retained size of one interned timestamp string. */
const TIMESTAMP_BYTES = 48;

function pointKey(pointId: string | null, pointTypeId: string | null): string {
  return `${pointId}:${pointTypeId}`;
}

/**
 * Build the index for one parameter file.
 *
 * @param csvText - Raw forecast CSV (`point_id;point_type_id;Date;<param>`)
 * @param param - Value column name, e.g. `tre200h0`
 * @returns The index and its approximate retained size in bytes
 */
export function buildForecastIndex(csvText: string, param: string): MemoBuild<ForecastIndex> {
  const timestampTable: string[] = [];
  const timestampIds = new Map<string, number>();
  const building = new Map<string, { ts: number[]; vals: number[] }>();

  parseCsv(csvText, (row: CsvRow): boolean => {
    const date = row.Date ?? '';
    let tsId = timestampIds.get(date);
    if (tsId === undefined) {
      tsId = timestampTable.length;
      timestampTable.push(date);
      timestampIds.set(date, tsId);
    }
    const key = pointKey(row.point_id ?? null, row.point_type_id ?? null);
    let series = building.get(key);
    if (series === undefined) {
      series = { ts: [], vals: [] };
      building.set(key, series);
    }
    series.ts.push(tsId);
    series.vals.push(parseNumeric(row[param] ?? null) ?? Number.NaN);
    return false; // record only; retain no row objects
  });

  const points = new Map<string, PointSeries>();
  let bytes = timestampTable.length * TIMESTAMP_BYTES;
  for (const [key, series] of building) {
    const timestamps = Uint32Array.from(series.ts);
    const values = Float64Array.from(series.vals);
    points.set(key, { timestamps, values });
    bytes += timestamps.byteLength + values.byteLength + POINT_OVERHEAD_BYTES;
  }
  return { value: { timestampTable, points }, bytes };
}

/**
 * Look up one point's series as `Date → value` (null = missing), in file order.
 * Duplicate dates resolve last-write-wins, matching the uncached path.
 *
 * @param index - Index from {@link buildForecastIndex}
 * @param pointId - `point_id` as it appears in the CSV
 * @param pointTypeId - `point_type_id` as it appears in the CSV
 * @returns Map of timestamp to value; empty if the point is not in the file
 */
export function lookupForecastSeries(
  index: ForecastIndex,
  pointId: string,
  pointTypeId: string
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const series = index.points.get(pointKey(pointId, pointTypeId));
  if (series === undefined) return out;
  for (let i = 0; i < series.timestamps.length; i++) {
    const value = series.values[i]!;
    out.set(index.timestampTable[series.timestamps[i]!]!, Number.isNaN(value) ? null : value);
  }
  return out;
}

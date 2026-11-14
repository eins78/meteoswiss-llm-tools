/**
 * Compact per-point index of one forecast parameter CSV.
 *
 * A forecast CSV is ~33 MB / 1.3 M rows covering ~5.8 k points, but one request
 * reads a single point's series. Retaining parsed `CsvRow` objects would cost
 * hundreds of MB per file, so this keeps only what the forecast tool reads: for
 * each `(point_id, point_type_id)`, its timestamps (as indices into an interned
 * table) and values (NaN ⇔ missing), stored as two flat typed arrays with one
 * `{ offset, length }` slice per point.
 *
 * {@link buildForecastIndex} uses a schema-specific byte scan
 * (`ogd-forecast-scan.ts`) when the file has the expected layout, and otherwise
 * the shared `parseCsv` with a recording filter, so quoting, trimming and
 * `-`/empty → null semantics stay identical to the uncached path.
 */

import { parseCsv, parseNumeric, type CsvRow } from '../support/ogd-csv-parser.js';
import type { MemoBuild } from './ogd-parse-memo.js';
import { assembleIndex, scanForecastCsv } from './ogd-forecast-scan.js';

/** One point's slice of the flat arrays, in file order. */
export type PointSeries = { offset: number; length: number };

/** Parsed index of one forecast CSV. */
export type ForecastIndex = {
  /** Interned `Date` strings, referenced by `timestamps`. */
  timestampTable: string[];
  /** Timestamp-table index per row, grouped by point. */
  timestamps: Uint32Array;
  /** Value per row (NaN = missing), grouped by point. */
  values: Float64Array;
  points: Map<string, PointSeries>;
};

function pointKey(pointId: string | null, pointTypeId: string | null): string {
  return `${pointId}:${pointTypeId}`;
}

/**
 * Build the index with the shared generic CSV parser (any quoting/padding the parser accepts).
 *
 * @param csvText - Raw forecast CSV (`point_id;point_type_id;Date;<param>`)
 * @param param - Value column name, e.g. `tre200h0`
 * @returns The index and its approximate retained size in bytes
 */
export function buildForecastIndexGeneric(
  csvText: string,
  param: string
): MemoBuild<ForecastIndex> {
  const timestampTable: string[] = [];
  const timestampIds = new Map<string, number>();
  const building = new Map<string, { ts: number[]; vals: number[] }>();
  let rows = 0;

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
    rows++;
    return false; // record only; retain no row objects
  });

  const timestamps = new Uint32Array(rows);
  const values = new Float64Array(rows);
  const points = new Map<string, PointSeries>();
  let offset = 0;
  for (const [key, series] of building) {
    timestamps.set(series.ts, offset);
    values.set(series.vals, offset);
    points.set(key, { offset, length: series.ts.length });
    offset += series.ts.length;
  }
  return assembleIndex({ timestampTable, timestamps, values, points });
}

/**
 * Build the index for one parameter file: the schema-specific byte scan when the file has the
 * expected layout, the generic CSV parser (identical semantics, slower) otherwise.
 *
 * @param csv - Raw forecast CSV (`point_id;point_type_id;Date;<param>`), as bytes or text
 * @param param - Value column name, e.g. `tre200h0`
 * @returns The index and its approximate retained size in bytes
 */
export function buildForecastIndex(
  csv: string | Uint8Array,
  param: string
): MemoBuild<ForecastIndex> {
  const bytes =
    typeof csv === 'string'
      ? Buffer.from(csv, 'utf-8')
      : Buffer.from(csv.buffer, csv.byteOffset, csv.byteLength);
  return scanForecastCsv(bytes, param) ?? buildForecastIndexGeneric(bytes.toString('utf-8'), param);
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
  const end = series.offset + series.length;
  for (let i = series.offset; i < end; i++) {
    const value = index.values[i]!;
    out.set(index.timestampTable[index.timestamps[i]!]!, Number.isNaN(value) ? null : value);
  }
  return out;
}

/**
 * Id of a timestamp in the index's interned table, for {@link forecastValueAt}.
 *
 * @param index - Index from {@link buildForecastIndex}
 * @param ts - `Date` as in the CSV (`YYYYMMDDhhmm`, UTC)
 * @returns The id, or -1 if no row of the file has this timestamp
 */
export function timestampId(index: ForecastIndex, ts: string): number {
  return index.timestampTable.indexOf(ts);
}

/** Wanted timestamps of one index, for {@link forecastValuesAt}. */
export type TimestampSlots = {
  /** Slot of each timestamp id (position in the wanted list), -1 if not wanted */
  slotOf: Int32Array;
  /** Number of wanted timestamps */
  count: number;
};

/**
 * Prepare a lookup of several timestamps in one index.
 *
 * @param index - Index from {@link buildForecastIndex}
 * @param timestamps - Wanted `Date` values (`YYYYMMDDhhmm`, UTC), in output order
 */
export function timestampSlots(
  index: ForecastIndex,
  timestamps: readonly string[]
): TimestampSlots {
  const slotOf = new Int32Array(index.timestampTable.length).fill(-1);
  timestamps.forEach((ts, slot) => {
    const id = timestampId(index, ts);
    if (id >= 0) slotOf[id] = slot;
  });
  return { slotOf, count: timestamps.length };
}

/**
 * One point's values at several timestamps, in one pass over its series rather
 * than building the whole `Date → value` map. Duplicate dates resolve
 * last-write-wins, like {@link lookupForecastSeries}.
 *
 * @param index - Index from {@link buildForecastIndex}
 * @param key - `point_id:point_type_id`, e.g. `"800100:2"`
 * @param slots - From {@link timestampSlots} for the same index
 * @returns One value per wanted timestamp; NaN if missing, or if the point or
 *   timestamp is not in the file
 */
export function forecastValuesAt(
  index: ForecastIndex,
  key: string,
  slots: TimestampSlots
): Float64Array {
  const out = new Float64Array(slots.count).fill(NaN);
  const series = index.points.get(key);
  if (series === undefined) return out;
  const end = series.offset + series.length;
  for (let i = series.offset; i < end; i++) {
    const slot = slots.slotOf[index.timestamps[i] ?? 0] ?? -1;
    if (slot >= 0) out[slot] = index.values[i] ?? NaN;
  }
  return out;
}

/**
 * Schema-specific byte scanner for the OGD forecast CSV layout.
 *
 * The forecast files have a fixed shape: header `point_id;point_type_id;Date;<param>`, `\n` line
 * ends, no quoting or padding, integer ids, an all-digit `Date`, and a plain decimal (or empty / `-`)
 * value. Knowing that, rows can be read straight from the bytes: no strings, no per-row objects, no
 * generic quoting state machine.
 *
 * It is strict by design: the first byte that deviates from that shape makes it return `null`, and the
 * caller falls back to the generic parser, so unusual input keeps the generic parser's exact semantics.
 */

import type { ForecastIndex, PointSeries } from './ogd-forecast-index.js';
import type { MemoBuild } from './ogd-parse-memo.js';

const NL = 10;
const SEMI = 59;
const MINUS = 45;
const DOT = 46;
/** Exact powers of ten: `m / POW10[k]` with `m < 2^53` is correctly rounded, so it equals `Number("m.ddd")`. */
const POW10 = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];

/** Ids below this index the direct lookup table (4 MiB); the real ids stay under ~1 M. */
const ID_TABLE_SIZE = 1 << 20;

/** Approximate per-entry overhead of a Map key + object, beyond the typed arrays. */
const POINT_OVERHEAD_BYTES = 160;
/** Approximate retained size of one interned timestamp string. */
const TIMESTAMP_BYTES = 48;

/**
 * Scan one forecast CSV into a {@link ForecastIndex}.
 *
 * @param buf - Raw file bytes
 * @param param - Value column name, e.g. `tre200h0`
 * @returns The index and its approximate size, or `null` if the file is not in the expected layout
 */
export function scanForecastCsv(buf: Buffer, param: string): MemoBuild<ForecastIndex> | null {
  const header = Buffer.from(`point_id;point_type_id;Date;${param}\n`);
  if (buf.length < header.length || !buf.subarray(0, header.length).equals(header)) return null;

  const len = buf.length;
  let capacity = 1;
  for (let p = buf.indexOf(NL, header.length); p !== -1; p = buf.indexOf(NL, p + 1)) capacity++;

  const rowPoint = new Uint32Array(capacity);
  const rowTs = new Uint32Array(capacity);
  const rowVal = new Float64Array(capacity);
  const pointIds = new Map<number, number>();
  const pointKeys: string[] = [];
  const pointTypes: number[] = [];
  const byId = new Int32Array(ID_TABLE_SIZE).fill(-1);
  const tsIds = new Map<number, number>();
  const timestampTable: string[] = [];
  let rows = 0;
  let lastTsNum = -1;
  let lastTsId = 0;

  let pos = header.length;
  while (pos < len) {
    let c = buf[pos]!;
    if (c === NL) {
      pos++;
      continue;
    }
    // point_id
    let start = pos;
    let id = 0;
    while (c >= 48 && c <= 57) {
      id = id * 10 + (c - 48);
      c = buf[++pos]!;
    }
    if (c !== SEMI || pos === start || pos - start > 9 || (buf[start] === 48 && pos - start > 1)) {
      return null;
    }
    // point_type_id
    start = ++pos;
    c = buf[pos]!;
    let type = 0;
    while (c >= 48 && c <= 57) {
      type = type * 10 + (c - 48);
      c = buf[++pos]!;
    }
    if (c !== SEMI || pos === start || pos - start > 2 || (buf[start] === 48 && pos - start > 1)) {
      return null;
    }
    // Date
    start = ++pos;
    c = buf[pos]!;
    let ts = 0;
    while (c >= 48 && c <= 57) {
      ts = ts * 10 + (c - 48);
      c = buf[++pos]!;
    }
    if (c !== SEMI || pos === start || pos - start > 15 || buf[start] === 48) return null;
    // value
    c = buf[++pos]!;
    let value: number;
    if (pos >= len || c === NL) {
      value = Number.NaN;
    } else {
      const neg = c === MINUS;
      if (neg) c = buf[++pos]!;
      if (pos >= len || c === NL) {
        value = Number.NaN; // a lone "-"
      } else {
        let m = 0;
        let digits = 0;
        let frac = 0;
        while (c >= 48 && c <= 57) {
          m = m * 10 + (c - 48);
          digits++;
          c = buf[++pos]!;
        }
        if (digits === 0) return null;
        if (c === DOT) {
          c = buf[++pos]!;
          while (c >= 48 && c <= 57) {
            m = m * 10 + (c - 48);
            digits++;
            frac++;
            c = buf[++pos]!;
          }
          if (frac === 0) return null;
        }
        if (digits > 15 || (pos < len && c !== NL)) return null;
        const v = m / POW10[frac]!;
        value = neg ? -v : v;
      }
    }
    pos++; // newline (or end of file)

    // Hot path: direct table by id, valid while the point's type matches.
    let pointIdx = id < ID_TABLE_SIZE ? byId[id]! : -1;
    if (pointIdx < 0 || pointTypes[pointIdx] !== type) {
      const idKey = id * 256 + type;
      const known = pointIds.get(idKey);
      if (known === undefined) {
        pointIdx = pointKeys.length;
        pointIds.set(idKey, pointIdx);
        pointKeys.push(`${id}:${type}`);
        pointTypes.push(type);
      } else {
        pointIdx = known;
      }
      if (id < ID_TABLE_SIZE && byId[id] === -1) byId[id] = pointIdx;
    }
    if (ts !== lastTsNum) {
      let tsId = tsIds.get(ts);
      if (tsId === undefined) {
        tsId = timestampTable.length;
        tsIds.set(ts, tsId);
        timestampTable.push(String(ts));
      }
      lastTsNum = ts;
      lastTsId = tsId;
    }
    rowPoint[rows] = pointIdx;
    rowTs[rows] = lastTsId;
    rowVal[rows] = value;
    rows++;
  }

  // Counting sort into per-point arrays, preserving file order within a point.
  const counts = new Uint32Array(pointKeys.length);
  for (let r = 0; r < rows; r++) counts[rowPoint[r]!]!++;
  const timestamps = pointKeys.map((_, i) => new Uint32Array(counts[i]!));
  const values = pointKeys.map((_, i) => new Float64Array(counts[i]!));
  const fill = new Uint32Array(pointKeys.length);
  for (let r = 0; r < rows; r++) {
    const p = rowPoint[r]!;
    const at = fill[p]!++;
    timestamps[p]![at] = rowTs[r]!;
    values[p]![at] = rowVal[r]!;
  }

  const points = new Map<string, PointSeries>();
  let bytes = timestampTable.length * TIMESTAMP_BYTES;
  pointKeys.forEach((key, i) => {
    points.set(key, { timestamps: timestamps[i]!, values: values[i]! });
    bytes += timestamps[i]!.byteLength + values[i]!.byteLength + POINT_OVERHEAD_BYTES;
  });
  return { value: { timestampTable, points }, bytes };
}

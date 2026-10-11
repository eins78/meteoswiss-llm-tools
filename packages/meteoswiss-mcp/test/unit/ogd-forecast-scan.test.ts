import { describe, expect, it } from 'vitest';
import { scanForecastCsv } from '../../src/data/ogd-forecast-scan.js';
import {
  buildForecastIndex,
  buildForecastIndexGeneric,
  lookupForecastSeries,
  type ForecastIndex,
} from '../../src/data/ogd-forecast-index.js';
import { buildForecastIndexOffThread } from '../../src/data/ogd-forecast-pool.js';

const HEADER = 'point_id;point_type_id;Date;x';

function entries(index: ForecastIndex): Array<[string, Array<[string, number | null]>]> {
  return [...index.points.keys()].sort().map((key) => {
    const [id, type] = key.split(':') as [string, string];
    return [key, [...lookupForecastSeries(index, id, type).entries()]];
  });
}

/** The scan (when it accepts the input) and the dispatcher must both equal the generic parser. */
function expectSameAsGeneric(csv: string): { scanned: boolean } {
  const generic = entries(buildForecastIndexGeneric(csv, 'x').value);
  expect(entries(buildForecastIndex(csv, 'x').value)).toEqual(generic);
  const scanned = scanForecastCsv(Buffer.from(csv), 'x');
  if (scanned !== null) expect(entries(scanned.value)).toEqual(generic);
  return { scanned: scanned !== null };
}

describe('forecast scan', () => {
  it('accepts the standard layout and matches the generic parser', () => {
    const csv = [
      HEADER,
      '1;1;202601010000;1.5',
      '2;1;202601010000;-3.25',
      '1;1;202601010100;-',
      '2;1;202601010100;',
      '1;1;202601010200;0',
      '2;3;202601010200;100',
      '1;1;202601010000;9.9',
      '',
    ].join('\n');
    expect(expectSameAsGeneric(csv).scanned).toBe(true);
  });

  it('keeps -0 and exact decimal values bit-identical to Number()', () => {
    const values = ['-0', '0.1', '0.2', '123456789.123456', '-0.000001', '7.0'];
    const csv = [
      HEADER,
      ...values.map((v, i) => `1;1;20260101${String(i).padStart(4, '0')};${v}`),
      '',
    ].join('\n');
    const scanned = scanForecastCsv(Buffer.from(csv), 'x')!;
    expect(scanned).not.toBeNull();
    const got = scanned.value.values;
    values.forEach((v, i) => expect(Object.is(got[i], Number(v))).toBe(true));
  });

  it('handles a missing trailing newline and blank lines', () => {
    expect(expectSameAsGeneric(`${HEADER}\n1;1;202601010000;1\n\n1;1;202601010100;2`).scanned).toBe(
      true
    );
  });

  it.each([
    ['CRLF line ends', `${HEADER}\r\n1;1;202601010000;1\r\n`],
    ['quoted field', `${HEADER}\n1;1;202601010000;"1.5"\n`],
    ['padded field', `${HEADER}\n1;1;202601010000; 1.5\n`],
    ['exponent value', `${HEADER}\n1;1;202601010000;1e3\n`],
    ['more than 15 digits', `${HEADER}\n1;1;202601010000;0.12345678901234567\n`],
    ['leading-zero id', `${HEADER}\n007;1;202601010000;1\n`],
    ['empty date', `${HEADER}\n1;1;;1\n`],
    ['extra column', `${HEADER}\n1;1;202601010000;1;9\n`],
    ['missing column', `${HEADER}\n1;1;202601010000\n`],
    ['trailing dot', `${HEADER}\n1;1;202601010000;5.\n`],
    ['leading dot', `${HEADER}\n1;1;202601010000;.5\n`],
    ['BOM', `﻿${HEADER}\n1;1;202601010000;1\n`],
    ['different header', `point_id;point_type_id;Date;y\n1;1;202601010000;1\n`],
  ])('falls back to the generic parser for %s', (_name, csv) => {
    expect(scanForecastCsv(Buffer.from(csv), 'x')).toBeNull();
    // The dispatcher must give exactly the generic parser's outcome: same index, or the same error.
    const outcome = (build: () => ForecastIndex): unknown => {
      try {
        return entries(build());
      } catch (error) {
        return { threw: error instanceof Error ? error.message : String(error) };
      }
    };
    expect(outcome(() => buildForecastIndex(csv, 'x').value)).toEqual(
      outcome(() => buildForecastIndexGeneric(csv, 'x').value)
    );
  });

  it('grows its row arrays when the leading rows overestimate the row length', () => {
    // Long rows in the first 64 KiB make the row-count estimate too low for the short rows after.
    const long = Array.from(
      { length: 3000 },
      (_, i) => `${100000 + i};1;202601010000;123456789.123456`
    );
    const short = Array.from(
      { length: 60000 },
      (_, i) => `${i % 7};1;20260101${String(i % 24).padStart(2, '0')}00;1`
    );
    expect(expectSameAsGeneric([HEADER, ...long, ...short, ''].join('\n')).scanned).toBe(true);
  });

  it('indexes several point types sharing one id', () => {
    const csv = [HEADER, '5;1;202601010000;1', '5;2;202601010000;2', '5;1;202601010100;3', ''].join(
      '\n'
    );
    expect(expectSameAsGeneric(csv).scanned).toBe(true);
  });
});

describe('forecast worker pool', () => {
  it('builds large inputs off-thread with the same result as the generic parser', async () => {
    const rows = [HEADER];
    for (let t = 0; t < 400; t++) {
      const ts = `2026010${1 + (t % 9)}${String(t % 24).padStart(2, '0')}00`;
      for (let p = 1; p <= 2400; p++)
        rows.push(`${p};${(p % 3) + 1};${ts};${(p * 7 + t) % 50}.${t % 10}`);
    }
    const csv = Buffer.from(`${rows.join('\n')}\n`);
    expect(csv.length).toBeGreaterThan(4 * 1024 * 1024);

    const viaPool = await buildForecastIndexOffThread(Buffer.from(csv), 'x', async () =>
      Buffer.from(csv)
    );
    const direct = buildForecastIndex(csv, 'x');
    expect(viaPool.bytes).toBe(direct.bytes);
    expect(entries(viaPool.value)).toEqual(entries(direct.value));
  }, 60_000);

  it('handles a large file that is one point repeated', async () => {
    const big = `${HEADER}\n${'1;1;202601010000;1\n'.repeat(300_000)}`;
    const csv = Buffer.from(big);
    const result = await buildForecastIndexOffThread(Buffer.from(csv), 'x', async () =>
      Buffer.from(csv)
    );
    expect(lookupForecastSeries(result.value, '1', '1').size).toBe(1);
  }, 60_000);
});

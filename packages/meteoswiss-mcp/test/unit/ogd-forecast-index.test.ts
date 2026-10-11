import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildForecastIndex, lookupForecastSeries } from '../../src/data/ogd-forecast-index.js';
import { parseCsv, parseNumeric } from '../../src/support/ogd-csv-parser.js';

const FORECASTS = path.join(__dirname, '..', '__fixtures__', 'ogd', 'forecasts');

/** The pre-index path, verbatim from ogd-local-forecast.ts. */
function legacy(text: string, param: string, id: string, type: string): Map<string, number | null> {
  const rows = parseCsv(text, (r) => r.point_id === id && r.point_type_id === type);
  const out = new Map<string, number | null>();
  for (const row of rows) out.set(row.Date ?? '', parseNumeric(row[param] ?? null));
  return out;
}

describe('forecast index', () => {
  it.each(['tre200h0', 'tre200dx', 'jww003i0', 'fu3010h1'])(
    'matches the uncached path for every point in %s',
    (param) => {
      const text = fs.readFileSync(path.join(FORECASTS, `${param}.csv`), 'utf-8');
      const { value: index } = buildForecastIndex(text, param);
      const keys = [...index.points.keys()];
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const [id, type] = key.split(':') as [string, string];
        const got = lookupForecastSeries(index, id, type);
        expect(got.size).toBeGreaterThan(0);
        expect([...got.entries()]).toEqual([...legacy(text, param, id, type).entries()]);
      }
    }
  );

  it('maps - and empty to null, keeps duplicates last-write-wins, and null Date to empty string', () => {
    const text = [
      'point_id;point_type_id;Date;tre200h0',
      '1;1;202601010000;1.5',
      '1;1;202601010100;-',
      '1;1;202601010200;',
      '1;1;202601010000;9.9',
      '1;1;;3.0',
      '2;1;202601010000;7',
      '',
    ].join('\n');
    const { value: index } = buildForecastIndex(text, 'tre200h0');
    expect([...lookupForecastSeries(index, '1', '1').entries()]).toEqual([
      ['202601010000', 9.9],
      ['202601010100', null],
      ['202601010200', null],
      ['', 3],
    ]);
    expect([...legacy(text, 'tre200h0', '1', '1').entries()]).toEqual([
      ['202601010000', 9.9],
      ['202601010100', null],
      ['202601010200', null],
      ['', 3],
    ]);
  });

  it('returns an empty series for an unknown point or a point-type mismatch', () => {
    const text = 'point_id;point_type_id;Date;tre200h0\n1;1;202601010000;1\n';
    const { value: index } = buildForecastIndex(text, 'tre200h0');
    expect(lookupForecastSeries(index, '99', '1').size).toBe(0);
    expect(lookupForecastSeries(index, '1', '2').size).toBe(0);
  });

  it('reports a size that grows with the data', () => {
    const small = buildForecastIndex('point_id;point_type_id;Date;x\n1;1;a;1\n', 'x');
    const rows = Array.from({ length: 1000 }, (_, i) => `1;1;t${i};${i}`);
    const large = buildForecastIndex(`point_id;point_type_id;Date;x\n${rows.join('\n')}\n`, 'x');
    expect(large.bytes).toBeGreaterThan(small.bytes + 1000 * 8);
  });
});

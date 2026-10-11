import { describe, expect, it } from 'vitest';
import { parseCsv, parseNumeric } from '../../src/support/ogd-csv-parser.js';

describe('parseCsv', () => {
  it('should parse simple semicolon-delimited CSV', () => {
    const csv = 'name;value\nalpha;1\nbeta;2';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'alpha', value: '1' });
    expect(rows[1]).toEqual({ name: 'beta', value: '2' });
  });

  it('should treat empty strings and dashes as null', () => {
    const csv = 'a;b;c\n1;;-';
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual({ a: '1', b: null, c: null });
  });

  it('should handle quoted fields with embedded semicolons', () => {
    const csv =
      'code;description_de;description_en;unit\n' +
      'kaalnud0;"Erle; tägliche Pollenkonzentration";"Alder; daily pollen concentration";No/m³';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe('kaalnud0');
    expect(rows[0]!.description_de).toBe('Erle; tägliche Pollenkonzentration');
    expect(rows[0]!.description_en).toBe('Alder; daily pollen concentration');
    expect(rows[0]!.unit).toBe('No/m³');
  });

  it('should handle escaped double quotes inside quoted fields', () => {
    const csv = 'a;b\n1;"he said ""hello"""';
    const rows = parseCsv(csv);
    expect(rows[0]!.b).toBe('he said "hello"');
  });

  it('should parse pollen parameter metadata format correctly', () => {
    const csv =
      'shortname;desc_de;desc_fr;desc_it;desc_en;grp_de;grp_fr;grp_it;grp_en;gran;dec;dtype;unit\n' +
      'kaalnud0;"Erle; mittlere Pollenkonzentration";"Aune; concentration pollinique";"Ontano; concentrazione";"Alder; daily average pollen concentration / Alnus";Pollen;Pollen;Pollini;Pollen;D;0;Integer;No/m³';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.shortname).toBe('kaalnud0');
    expect(rows[0]!.desc_de).toBe('Erle; mittlere Pollenkonzentration');
    expect(rows[0]!.desc_en).toBe('Alder; daily average pollen concentration / Alnus');
    expect(rows[0]!.unit).toBe('No/m³');
  });

  it('should apply filter predicate', () => {
    const csv = 'name;value\nalpha;1\nbeta;2\nalpha;3';
    const rows = parseCsv(csv, (row) => row.name === 'alpha');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.value).toBe('1');
    expect(rows[1]!.value).toBe('3');
  });

  it('should return empty array for CSV with only a header', () => {
    expect(parseCsv('header_only')).toEqual([]);
  });

  it('should return empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseNumeric', () => {
  it('should parse valid numbers', () => {
    expect(parseNumeric('42')).toBe(42);
    expect(parseNumeric('3.14')).toBe(3.14);
    expect(parseNumeric('-1')).toBe(-1);
    expect(parseNumeric('0')).toBe(0);
  });

  it('should return null for non-numeric values', () => {
    expect(parseNumeric('abc')).toBeNull();
  });

  it('should coerce empty string to 0 (callers pass null for missing values)', () => {
    // parseCsv converts empty strings to null before calling parseNumeric,
    // so in practice parseNumeric never receives '' from the pipeline
    expect(parseNumeric('')).toBe(0);
  });

  it('should return null for null input', () => {
    expect(parseNumeric(null)).toBeNull();
  });

  it('should return null for non-finite values (FUN-18)', () => {
    expect(parseNumeric('Infinity')).toBeNull();
    expect(parseNumeric('-Infinity')).toBeNull();
    expect(parseNumeric('1e309')).toBeNull(); // overflows to Infinity
  });
});

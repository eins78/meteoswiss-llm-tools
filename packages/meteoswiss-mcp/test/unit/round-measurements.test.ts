import { describe, expect, it } from 'vitest';
import {
  roundByUnit,
  roundNullable,
  roundOptional,
} from '../../src/support/round-measurements.js';

describe('roundByUnit', () => {
  it('rounds 1-decimal units', () => {
    expect(roundByUnit(12.34, '°C')).toBe(12.3);
  });

  it('rounds 0-decimal units', () => {
    expect(roundByUnit(1013.2, 'hPa')).toBe(1013);
  });

  it('rounds the remaining unit-table entries (guards against literal typos, e.g. unicode)', () => {
    expect(roundByUnit(500.7, 'W/m²')).toBe(501);
    expect(roundByUnit(183.6, '°')).toBe(184);
    expect(roundByUnit(45.3, 'min')).toBe(45);
    expect(roundByUnit(12.6, 'cm')).toBe(13);
    expect(roundByUnit(1123.6, 'particles/m³')).toBe(1124);
    expect(roundByUnit(3.456, 'm/s')).toBe(3.5);
    expect(roundByUnit(7.89, 'mm')).toBe(7.9);
    expect(roundByUnit(45.67, 'km/h')).toBe(45.7);
  });

  it('passes unknown units through unchanged', () => {
    expect(roundByUnit(12.34567, 'furlongs')).toBe(12.34567);
  });

  it('rounds negative numbers correctly', () => {
    expect(roundByUnit(-2.36, '°C')).toBe(-2.4);
  });

  it('leaves whole numbers as whole numbers', () => {
    const result = roundByUnit(8, '°C');
    expect(result).toBe(8);
    expect(typeof result).toBe('number');
  });

  it('passes NaN through unchanged', () => {
    expect(Number.isNaN(roundByUnit(NaN, '°C'))).toBe(true);
  });

  it('passes Infinity and -Infinity through unchanged', () => {
    // parseNumeric uses Number(value), so non-finite input can reach this
    // helper; string-shift rounding would otherwise corrupt it (e.g.
    // `Number('Infinitye1')` is NaN), so it must be guarded explicitly.
    expect(roundByUnit(Infinity, '°C')).toBe(Infinity);
    expect(roundByUnit(-Infinity, 'mm')).toBe(-Infinity);
  });

  it('rounds the classic IEEE-754 half-step case correctly (0.15 -> 0.2, not 0.1)', () => {
    // 0.15 * 10 === 1.4999999999999998 in IEEE-754, which naive
    // Math.round(value * factor) / factor would floor to 0.1.
    expect(roundByUnit(0.15, '°C')).toBe(0.2);
    expect(roundByUnit(1.15, 'mm')).toBe(1.2);
  });

  it('rounds negative half-steps away from zero, symmetric with positive half-steps', () => {
    // Math.round(-23.5) === -23 in JS (ties round toward +Infinity), which
    // would otherwise make -2.35 round to -2.3 while 2.35 rounds to 2.4.
    expect(roundByUnit(2.35, '°C')).toBe(2.4);
    expect(roundByUnit(-2.35, '°C')).toBe(-2.4);
  });
});

describe('roundNullable', () => {
  it('rounds a number by unit', () => {
    expect(roundNullable(12.3456, '°C')).toBe(12.3);
  });

  it('passes null through as null', () => {
    expect(roundNullable(null, '°C')).toBeNull();
  });
});

describe('roundOptional', () => {
  it('rounds a number by unit', () => {
    expect(roundOptional(12.3456, '°C')).toBe(12.3);
  });

  it('passes undefined through as undefined', () => {
    expect(roundOptional(undefined, '°C')).toBeUndefined();
  });
});

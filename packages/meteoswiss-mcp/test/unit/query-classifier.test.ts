import { describe, expect, it } from 'vitest';
import { classifyQuery } from '../../src/support/query-classifier.js';

describe('classifyQuery', () => {
  it('classifies 4-digit numeric queries as postal_code', () => {
    expect(classifyQuery('8001')).toBe('postal_code');
    expect(classifyQuery('1200')).toBe('postal_code');
    expect(classifyQuery('3000')).toBe('postal_code');
    expect(classifyQuery('9999')).toBe('postal_code');
  });

  it('does NOT classify 5-digit (or other) numeric strings as postal_code', () => {
    expect(classifyQuery('99999')).toBe('place_name');
    expect(classifyQuery('123')).toBe('place_name');
    expect(classifyQuery('12345')).toBe('place_name');
  });

  it('classifies multi-word queries with a digit as address', () => {
    expect(classifyQuery('Bahnhofplatz 1 Bern')).toBe('address');
    expect(classifyQuery('Route 66')).toBe('address');
    expect(classifyQuery('8001 Zurich')).toBe('address');
  });

  it('classifies plain place names as place_name', () => {
    expect(classifyQuery('Bern')).toBe('place_name');
    expect(classifyQuery('Zurich')).toBe('place_name');
    expect(classifyQuery('Paris')).toBe('place_name');
    expect(classifyQuery('La Chaux-de-Fonds')).toBe('place_name');
    expect(classifyQuery('NOTASTATION')).toBe('place_name');
    expect(classifyQuery('ABCDE')).toBe('place_name');
  });

  it('classifies single-word queries with digits but no spaces as place_name', () => {
    // Not an address shape (no whitespace-separated tokens).
    // Falls through to place_name; geocoder preset decides what to do.
    expect(classifyQuery('ABC123')).toBe('place_name');
  });
});

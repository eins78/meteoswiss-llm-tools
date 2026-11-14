import { describe, expect, it } from 'vitest';
import {
  inArea,
  parseAreaFilter,
  windowTimestamps,
} from '../../src/data/weather-situation-filters.js';

const ZURICH = { lat: 47.3723, lon: 8.5422 };

describe('windowTimestamps', () => {
  it('is the single hour without until', () => {
    expect(windowTimestamps('202611140900')).toEqual(['202611140900']);
  });

  it('lists every hour from time to until, both included, across midnight', () => {
    expect(windowTimestamps('202611132200', '202611140100')).toEqual([
      '202611132200',
      '202611132300',
      '202611140000',
      '202611140100',
    ]);
    expect(windowTimestamps('202611140900', '202611140900')).toEqual(['202611140900']);
  });

  it('allows 12 hours after time, not 13', () => {
    expect(windowTimestamps('202611140600', '202611141800')).toHaveLength(13);
    expect(() => windowTimestamps('202611140600', '202611141900')).toThrow(/13 h after time/);
  });

  it('rejects until before time', () => {
    expect(() => windowTimestamps('202611140900', '202611140800')).toThrow(/before time/);
  });
});

describe('parseAreaFilter', () => {
  it('accepts no filter', () => {
    expect(parseAreaFilter({})).toEqual({});
  });

  it('checks the box', () => {
    expect(parseAreaFilter({ bbox: [7, 46.5, 8.5, 47.5] })).toEqual({
      box: { west: 7, south: 46.5, east: 8.5, north: 47.5 },
    });
    expect(() => parseAreaFilter({ bbox: [8.5, 46.5, 7, 47.5] })).toThrow(/west must be less/);
    expect(() => parseAreaFilter({ bbox: [7, 47.5, 8.5, 46.5] })).toThrow(/south less than/);
    expect(() => parseAreaFilter({ bbox: [7, 46.5, 8.5] })).toThrow(/four numbers/);
  });

  it('checks the radius', () => {
    expect(parseAreaFilter({ near: { ...ZURICH, radius_km: 150 } }).near?.radiusKm).toBe(150);
    expect(() => parseAreaFilter({ near: { ...ZURICH, radius_km: 151 } })).toThrow(/at most 150/);
    expect(() => parseAreaFilter({ near: { ...ZURICH, radius_km: 0 } })).toThrow(/more than 0/);
  });

  it('checks the altitude limits', () => {
    expect(parseAreaFilter({ min_altitude_m: 800, max_altitude_m: 800 })).toEqual({
      minAltitude: 800,
      maxAltitude: 800,
    });
    expect(() => parseAreaFilter({ min_altitude_m: 1000, max_altitude_m: 500 })).toThrow(
      /above max_altitude_m/
    );
  });
});

describe('inArea', () => {
  const zurich = { ...ZURICH, altitude: 409 };
  const einsiedeln = { lat: 47.133, lon: 8.7566, altitude: 911 };

  it('passes every point without a filter', () => {
    expect(inArea({}, zurich)).toBe(true);
  });

  it('keeps altitude limits inclusive', () => {
    expect(inArea({ minAltitude: 409 }, zurich)).toBe(true);
    expect(inArea({ minAltitude: 410 }, zurich)).toBe(false);
    expect(inArea({ maxAltitude: 409 }, zurich)).toBe(true);
    expect(inArea({ maxAltitude: 408 }, zurich)).toBe(false);
  });

  it('keeps the box edges', () => {
    const box = { west: 8.5422, south: 47.0, east: 9.0, north: 47.3723 };
    expect(inArea({ box }, zurich)).toBe(true);
    expect(inArea({ box: { ...box, west: 8.55 } }, zurich)).toBe(false);
  });

  it('measures near as air distance (Einsiedeln is about 31 km from Zurich)', () => {
    expect(inArea({ near: { ...ZURICH, radiusKm: 32 } }, einsiedeln)).toBe(true);
    expect(inArea({ near: { ...ZURICH, radiusKm: 30 } }, einsiedeln)).toBe(false);
  });

  it('needs every given filter to hold', () => {
    const near = { ...ZURICH, radiusKm: 40 };
    expect(inArea({ near, minAltitude: 500 }, einsiedeln)).toBe(true);
    expect(inArea({ near, minAltitude: 500 }, zurich)).toBe(false);
  });
});

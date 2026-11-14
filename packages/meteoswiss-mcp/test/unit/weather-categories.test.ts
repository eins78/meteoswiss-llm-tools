import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LEGEND,
  WEATHER_CATEGORIES,
  categorizeHour,
  symbolCategory,
} from '../../src/support/weather-categories.js';

describe('symbolCategory', () => {
  it('gives every MeteoSwiss symbol code a category, by day and by night', () => {
    for (let code = 1; code <= 42; code++) {
      expect(symbolCategory(code), String(code)).not.toBeNull();
      expect(symbolCategory(code + 100), String(code + 100)).not.toBeNull();
    }
  });

  it('maps the codes of plan §2', () => {
    expect(symbolCategory(1)).toBe('sunny');
    expect(symbolCategory(2)).toBe('sunny');
    expect(symbolCategory(3)).toBe('partly_sunny');
    expect(symbolCategory(35)).toBe('cloudy');
    expect(symbolCategory(26)).toBe('high_cloud');
    expect(symbolCategory(27)).toBe('fog_or_stratus');
    expect(symbolCategory(28)).toBe('fog_or_stratus');
    expect(symbolCategory(14)).toBe('rain');
    expect(symbolCategory(31)).toBe('sleet');
    expect(symbolCategory(22)).toBe('snow');
    expect(symbolCategory(39)).toBe('thunder');
  });

  it('treats a clear night as its own category and a partly cloudy night as cloudy', () => {
    expect(symbolCategory(101)).toBe('clear_night');
    expect(symbolCategory(102)).toBe('clear_night');
    expect(symbolCategory(103)).toBe('cloudy');
    expect(symbolCategory(128)).toBe('fog_or_stratus');
    expect(symbolCategory(114)).toBe('rain');
  });

  it('returns null for missing or unknown codes', () => {
    for (const code of [NaN, 0, 43, 100, 143, 1.5, -1]) {
      expect(symbolCategory(code), String(code)).toBeNull();
    }
  });

  it('has a legend entry for every category', () => {
    for (const category of WEATHER_CATEGORIES) {
      expect(CATEGORY_LEGEND[category]).toMatch(/\w/);
    }
  });
});

describe('categorizeHour (cloud rule)', () => {
  it('turns an overcast or partly sunny hour under a low deck into fog_or_stratus', () => {
    expect(categorizeHour(35, 0.95, 0.05, 0.1)).toBe('fog_or_stratus');
    expect(categorizeHour(3, 0.85, 0.1, 0.2)).toBe('fog_or_stratus');
    expect(categorizeHour(103, 0.9, 0, 0)).toBe('fog_or_stratus');
    expect(categorizeHour(5, 0.8, 0.49, 0.49)).toBe('fog_or_stratus');
  });

  it('keeps the symbol when there is cloud above the deck or the deck is thin', () => {
    expect(categorizeHour(5, 0.9, 0.6, 0.3)).toBe('cloudy');
    expect(categorizeHour(5, 0.9, 0.3, 0.5)).toBe('cloudy');
    expect(categorizeHour(3, 0.79, 0, 0)).toBe('partly_sunny');
  });

  it('never applies the rule to other categories', () => {
    expect(categorizeHour(1, 1, 0, 0)).toBe('sunny');
    expect(categorizeHour(14, 1, 0, 0)).toBe('rain');
    expect(categorizeHour(101, 1, 0, 0)).toBe('clear_night');
  });

  it('leaves the symbol alone when a cloud value is missing', () => {
    expect(categorizeHour(35, NaN, 0, 0)).toBe('cloudy');
    expect(categorizeHour(35, 0.95, NaN, 0)).toBe('cloudy');
    expect(categorizeHour(35, 0.95, 0, NaN)).toBe('cloudy');
    expect(categorizeHour(NaN, 1, 0, 0)).toBeNull();
  });
});

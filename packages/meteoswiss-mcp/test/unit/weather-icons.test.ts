import { describe, expect, it } from 'vitest';
import { weatherIconDescription, weatherIconUrl } from '../../src/support/weather-icons.js';

describe('weatherIconDescription', () => {
  it('should return description for day codes', () => {
    expect(weatherIconDescription(1)).toBe('sunny');
    expect(weatherIconDescription(20)).toBe('very overcast with rain');
    expect(weatherIconDescription(35)).toBe('overcast and dry');
  });

  it('should return description for previously-unmapped day codes 36-42 (issue #110, BUG-3)', () => {
    expect(weatherIconDescription(36)).toBe('slightly overcast, slightly stormy');
    expect(weatherIconDescription(37)).toBe('slightly overcast, stormy snow showers');
    expect(weatherIconDescription(38)).toBe('overcast, thundery showers');
    expect(weatherIconDescription(39)).toBe('overcast, thundery snow showers');
    expect(weatherIconDescription(40)).toBe('very cloudy, slightly stormy');
    expect(weatherIconDescription(41)).toBe('overcast, slightly stormy');
    expect(weatherIconDescription(42)).toBe('very cloudy, thundery snow showers');
  });

  it('should return description for night codes', () => {
    expect(weatherIconDescription(101)).toBe('clear');
    expect(weatherIconDescription(128)).toBe('fog');
    expect(weatherIconDescription(142)).toBe('very cloudy, thundery snow showers');
  });

  it('should return unknown for unmapped codes', () => {
    expect(weatherIconDescription(0)).toBe('unknown (0)');
    expect(weatherIconDescription(50)).toBe('unknown (50)');
    expect(weatherIconDescription(999)).toBe('unknown (999)');
  });
});

describe('weatherIconUrl', () => {
  it('should return SVG URL for valid day codes', () => {
    expect(weatherIconUrl(1)).toBe(
      'https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/1.svg'
    );
    expect(weatherIconUrl(35)).toBe(
      'https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/35.svg'
    );
    expect(weatherIconUrl(36)).toBe(
      'https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/36.svg'
    );
  });

  it('should return SVG URL for valid night codes', () => {
    expect(weatherIconUrl(101)).toBe(
      'https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/101.svg'
    );
    expect(weatherIconUrl(142)).toBe(
      'https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/142.svg'
    );
  });

  it('should return null for unknown codes', () => {
    expect(weatherIconUrl(0)).toBeNull();
    expect(weatherIconUrl(50)).toBeNull();
    expect(weatherIconUrl(99)).toBeNull();
    expect(weatherIconUrl(999)).toBeNull();
    expect(weatherIconUrl(-1)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { fogTop } from '../../src/data/weather-situation-fog.js';
import type { WeatherCategory } from '../../src/support/weather-categories.js';

type Sample = { altitude: number; category: WeatherCategory };

/**
 * `n` points spread over one 100 m band from `from` m; the first `fog` are
 * fog_or_stratus, the rest `other`.
 */
function band(from: number, n: number, fog: number, other: WeatherCategory = 'sunny'): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    altitude: from + (i * 100) / n,
    category: i < fog ? 'fog_or_stratus' : other,
  }));
}

/** A fog sea from 400 m up to 800 m (80 % fog per band), the given weather above. */
function fogSea(above: WeatherCategory, aboveShare = 0.9): Sample[] {
  const clear = Math.round(10 * aboveShare);
  return [
    ...band(400, 20, 16),
    ...band(500, 20, 16),
    ...band(600, 20, 16),
    ...band(700, 20, 16),
    ...band(800, 10, 10 - clear, above).map(flipFog(above)),
    ...band(900, 10, 10 - clear, above).map(flipFog(above)),
    ...band(1000, 10, 10 - clear, above).map(flipFog(above)),
  ];
}

/** Above the sea, the "fog" points of `band` stand for cloudy ones, the rest for `above`. */
function flipFog(above: WeatherCategory): (s: Sample) => Sample {
  return (s) => ({ ...s, category: s.category === 'fog_or_stratus' ? 'cloudy' : above });
}

describe('fogTop', () => {
  it('finds a fog sea at 800 m with sun above', () => {
    expect(fogTop(fogSea('sunny'))).toEqual({ topM: 800, clearAbovePct: 90, points: 110 });
  });

  it('counts partly sunny and clear night above as clear', () => {
    expect(fogTop(fogSea('clear_night'))?.topM).toBe(800);
    expect(fogTop(fogSea('partly_sunny', 0.6))).toEqual({
      topM: 800,
      clearAbovePct: 60,
      points: 110,
    });
  });

  it('gives no fog top with cloud above the low deck', () => {
    expect(fogTop(fogSea('sunny', 0.5))).toBeNull();
    expect(fogTop(fogSea('rain'))).toBeNull();
  });

  it('starts the layer at the lowest foggy band, so clear low corners do not hide the sea', () => {
    // Like the Plateau forecast for 14.11.2026 10:00: 300-499 m mostly clear, 500-899 m fog.
    const samples = [
      ...band(300, 10, 2),
      ...band(400, 10, 4),
      ...band(500, 10, 6),
      ...band(600, 10, 8),
      ...band(700, 10, 8),
      ...band(800, 10, 6),
      ...band(900, 10, 2),
      ...band(1000, 10, 0),
    ];
    expect(fogTop(samples)).toEqual({ topM: 900, clearAbovePct: 90, points: 60 });
  });

  it('needs the layer to start below 1000 m', () => {
    const samples = [...band(600, 10, 0), ...band(1000, 10, 9), ...band(1100, 10, 0)];
    expect(fogTop(samples)).toBeNull();
    const lower = [...band(600, 10, 0), ...band(900, 10, 9), ...band(1000, 10, 0)];
    expect(fogTop(lower)?.topM).toBe(1000);
  });

  it('ends the layer at the first clear band above it', () => {
    const samples = [
      ...band(400, 10, 9),
      ...band(500, 10, 0),
      ...band(600, 10, 0),
      ...band(700, 10, 0),
      ...band(800, 10, 9), // a second layer higher up is not part of this one
    ];
    expect(fogTop(samples)).toEqual({ topM: 500, clearAbovePct: 100, points: 40 });
  });

  it('counts a band at exactly 50 % fog as fog', () => {
    const samples = [...band(400, 10, 5), ...band(500, 10, 0)];
    expect(fogTop(samples)).toEqual({ topM: 500, clearAbovePct: 100, points: 20 });
  });

  it('skips bands with fewer than 5 points, below and inside the layer', () => {
    const samples = [
      ...band(300, 4, 0), // too thin to be the lowest band
      ...band(400, 10, 8),
      ...band(500, 3, 0), // too thin to end the layer
      ...band(600, 10, 8),
      ...band(700, 10, 0),
    ];
    expect(fogTop(samples)).toEqual({ topM: 700, clearAbovePct: 100, points: 30 });
  });

  it('gives no fog top when nothing (or too little) is above it', () => {
    expect(fogTop([...band(400, 10, 10), ...band(500, 10, 10)])).toBeNull();
    expect(fogTop([...band(400, 10, 10), ...band(500, 4, 0)])).toBeNull();
  });

  it('does not read cloud on the peaks as a fog sea (base above 1000 m)', () => {
    const samples = [
      ...band(500, 20, 1),
      ...band(1500, 10, 0),
      ...band(3000, 10, 10),
      ...band(3100, 10, 9),
    ];
    expect(fogTop(samples)).toBeNull();
  });

  it('gives no fog top without points', () => {
    expect(fogTop([])).toBeNull();
  });
});

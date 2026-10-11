import { describe, expect, it , vi, beforeAll, afterAll } from 'vitest';
import { MCPClient } from './mcp-client.js';

describe('meteoswissLocalForecast Tool', () => {
  let client: MCPClient;

  beforeAll(async () => {
    process.env.USE_TEST_FIXTURES = 'true';
    client = new MCPClient();
    await client.start();
  });

  afterAll(async () => {
    await client.stop();
    vi.restoreAllMocks();
  });

  it('should be registered as meteoswissLocalForecast', async () => {
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === 'meteoswissLocalForecast');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('forecast');
  });

  it('should accept location and days parameters', async () => {
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === 'meteoswissLocalForecast');
    expect(tool?.inputSchema?.properties).toHaveProperty('location');
    expect(tool?.inputSchema?.properties).toHaveProperty('days');
  });

  it('should return forecast with content for a postal code', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: '8001',
      days: 2,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.location).toBeDefined();
    expect(data.location.coordinates).toHaveProperty('lat');
    expect(data.location.coordinates).toHaveProperty('lon');
    expect(data.forecast).toBeDefined();
    expect(Array.isArray(data.forecast)).toBe(true);
    expect(data.source).toBe('MeteoSwiss Open Data');

    // Assert content, not just structure — postal code path must populate all fields
    const day = data.forecast[0];
    expect(day).toHaveProperty('date');
    expect(day.temperature_min_c).toEqual(expect.any(Number));
    expect(day.temperature_max_c).toEqual(expect.any(Number));
    expect(day.precipitation_total_mm).toEqual(expect.any(Number));
    expect(day.sunshine_total_minutes).toEqual(expect.any(Number));
    expect(day.wind_avg_kmh).toEqual(expect.any(Number));
    expect(day.wind_gust_max_kmh).toEqual(expect.any(Number));
    expect(day.weather).toEqual(expect.any(String));
    expect(day.weather_icon_url).toMatch(/^https:\/\/www\.meteoschweiz\.admin\.ch\/static\/resources\/weather-symbols\/\d+\.svg$/);
  });

  it('returns a unified hourly breakdown (temperature, precipitation, sunshine, wind, gust) for a postal code, in local Zurich time', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: '8001',
      days: 2,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);

    // Fixture day 2026-03-28 (point 800100): 06:00-09:00 UTC and 14:00-16:00 UTC carry
    // rain; every other hourly series (temp/sunshine/wind/gust) has its own known
    // per-hour values. Assert exact series content — not just array shape.
    const day1 = data.forecast.find((d: { date: string }) => d.date === '2026-03-28');
    expect(day1).toBeDefined();
    expect(Array.isArray(day1.hourly)).toBe(true);
    expect(day1.hourly.length).toBeGreaterThan(0);
    expect(day1.hourly).toContainEqual({
      time: '2026-03-28T09:00:00+01:00',
      temperature_c: 1.5,
      precip_mm: 0.5,
      sunshine_minutes: 0,
      wind_kmh: 11.0,
      wind_gust_kmh: 18.5,
    });

    // Every daily summary must be derivable from (i.e. consistent with) the SAME
    // hourly series shown alongside it — they cannot disagree, by construction.
    type HourlyEntry = {
      time: string;
      temperature_c: number | null;
      precip_mm: number | null;
      sunshine_minutes: number | null;
      wind_kmh: number | null;
      wind_gust_kmh: number | null;
    };
    const nonNull = (values: Array<number | null>): number[] =>
      values.filter((v): v is number => v !== null);
    const round1 = (n: number): number => Math.round(n * 10) / 10;

    const hourly1: HourlyEntry[] = day1.hourly;
    const temps1 = nonNull(hourly1.map((h) => h.temperature_c));
    const precips1 = nonNull(hourly1.map((h) => h.precip_mm));
    const sun1 = nonNull(hourly1.map((h) => h.sunshine_minutes));
    const wind1 = nonNull(hourly1.map((h) => h.wind_kmh));
    const gust1 = nonNull(hourly1.map((h) => h.wind_gust_kmh));

    expect(day1.temperature_min_c).toBe(round1(Math.min(...temps1)));
    expect(day1.temperature_max_c).toBe(round1(Math.max(...temps1)));
    expect(day1.precipitation_total_mm).toBe(round1(precips1.reduce((a, b) => a + b, 0)));
    expect(day1.sunshine_total_minutes).toBe(sun1.reduce((a, b) => a + b, 0));
    expect(day1.wind_avg_kmh).toBe(round1(wind1.reduce((a, b) => a + b, 0) / wind1.length));
    expect(day1.wind_gust_max_kmh).toBe(round1(Math.max(...gust1)));

    // Exact known values for this fixture (guards the above generic derivation checks
    // against a bug that happens to be self-consistent but wrong).
    expect(day1.temperature_min_c).toBe(-0.8);
    expect(day1.temperature_max_c).toBe(8.1);
    expect(day1.precipitation_total_mm).toBe(1.7);
    expect(day1.sunshine_total_minutes).toBe(178);
    expect(day1.wind_avg_kmh).toBe(7.8);
    expect(day1.wind_gust_max_kmh).toBe(24.5);

    // Every hourly entry's local calendar date must match the day it's nested
    // under. UTC 202603282300 is local 2026-03-29T00:00:00+01:00 — it must be
    // attributed to day2, not day1, even though its raw timestamp says "28".
    for (const h of hourly1) {
      expect(h.time.slice(0, 10)).toBe('2026-03-28');
    }

    // Fixture crosses the CET->CEST spring-forward (2026-03-29, 02:00 local).
    // Day 2 must contain readings on both sides of the DST boundary.
    const day2 = data.forecast.find((d: { date: string }) => d.date === '2026-03-29');
    expect(day2).toBeDefined();
    const hourly2: HourlyEntry[] = day2.hourly;
    const offsets = new Set(hourly2.map((h) => h.time.slice(-6)));
    expect(offsets.has('+01:00')).toBe(true);
    expect(offsets.has('+02:00')).toBe(true);
    for (const h of hourly2) {
      expect(h.time.slice(0, 10)).toBe('2026-03-29');
    }
    // The UTC 23:00-on-the-28th reading (local midnight of the 29th) must land here,
    // carrying every series' value for that hour, not just precipitation.
    expect(hourly2).toContainEqual({
      time: '2026-03-29T00:00:00+01:00',
      temperature_c: -0.4,
      precip_mm: 0.0,
      sunshine_minutes: 0,
      wind_kmh: 3.5,
      wind_gust_kmh: 7.2,
    });
    expect(hourly2).toContainEqual({
      time: '2026-03-29T01:00:00+01:00',
      temperature_c: -0.6,
      precip_mm: 0.0,
      sunshine_minutes: 0,
      wind_kmh: 3.0,
      wind_gust_kmh: 6.5,
    });
    expect(hourly2).toContainEqual({
      time: '2026-03-29T03:00:00+02:00',
      temperature_c: -0.8,
      precip_mm: 0.0,
      sunshine_minutes: 0,
      wind_kmh: 2.5,
      wind_gust_kmh: 5.8,
    });
  });

  it('reports a per-field null for a missing hourly reading without omitting the whole hour (sparse data)', async () => {
    // Fixture sre000h0.csv deliberately has a '-' (no-data marker) at UTC 2026-03-28T12:00
    // (local 13:00+01:00) — a normally-sunny midday hour. Every OTHER series still has a
    // real reading for that same hour, so the hour must still appear, with only
    // sunshine_minutes null.
    const result = await client.callTool('meteoswissLocalForecast', {
      location: '8001',
      days: 1,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    const day1 = data.forecast[0];
    const entry = day1.hourly.find((h: { time: string }) => h.time === '2026-03-28T13:00:00+01:00');
    expect(entry).toBeDefined();
    expect(entry.sunshine_minutes).toBeNull();
    expect(entry.temperature_c).toBe(7.5);
    expect(entry.precip_mm).toBe(0.0);
    expect(entry.wind_kmh).toBe(12.0);
    expect(entry.wind_gust_kmh).toBe(20.0);

    // The missing hour must be EXCLUDED from the sum (treated as no reading), not
    // silently counted as 0 — the daily total already asserted as 178 in the
    // previous test would be wrong (178 - 0 vs some other value) if this hour's
    // absence were mishandled either way, so pin it explicitly here too.
    expect(day1.sunshine_total_minutes).toBe(178);
  });

  it('still includes a day whose 5 hourly series are a total gap, as hourly: [] rather than dropping the day (issue #101 Copilot review)', async () => {
    // Fixture jww003i0.csv (icon, 3-hourly) has rows for 2026-03-30, but none of
    // tre200h0/rre150h0/sre000h0/fu3010h0/fu3010h1 do — a day the forecast run genuinely
    // covers (icon data exists), but with a complete gap across every hourly reading series.
    // The day must still appear in `forecast[]` with `hourly: []` and null summary fields,
    // not be silently omitted because the date-derivation only looked at series with data.
    const result = await client.callTool('meteoswissLocalForecast', {
      location: '8001',
      days: 3,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    const gapDay = data.forecast.find((d: { date: string }) => d.date === '2026-03-30');
    expect(gapDay).toBeDefined();
    expect(gapDay.hourly).toEqual([]);
    expect(gapDay.temperature_min_c).toBeNull();
    expect(gapDay.temperature_max_c).toBeNull();
    expect(gapDay.precipitation_total_mm).toBeNull();
    expect(gapDay.sunshine_total_minutes).toBeNull();
    expect(gapDay.wind_avg_kmh).toBeNull();
    expect(gapDay.wind_gust_max_kmh).toBeNull();
    // Icon still resolves independently of the 5 gapped hourly series.
    expect(gapDay.weather).toEqual(expect.any(String));
  });

  it('should return forecast with weather_icon_url for a station', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: 'Napf',
      days: 2,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.location.type).toBe('station');
    const day = data.forecast[0];
    expect(day.weather).toEqual(expect.any(String));
    expect(day.weather_icon_url).toMatch(
      /^https:\/\/www\.meteoschweiz\.admin\.ch\/static\/resources\/weather-symbols\/\d+\.svg$/
    );
    // Stations now fetch hourly params too (issue #101) — hourly must be a real,
    // non-empty array, not the pre-#101 hardcoded null.
    expect(Array.isArray(day.hourly)).toBe(true);
    expect(day.hourly.length).toBeGreaterThan(0);
  });

  it('folds in station-point hourly data while keeping the official daily aggregate as the summary (issue #101 Q2)', async () => {
    // Napf (point 48). Official daily aggregates (from tre200dn/tre200dx/rka150d0,
    // unchanged pre-existing fixture rows) vs. the NEW hourly series (rre150h0 etc.,
    // now also fetched for stations) are deliberately DIFFERENT products in this
    // fixture — the station's own daily total (11.3mm on the 26th) does not equal
    // summing its shown hourly series (9.5mm) by design (Max's Q2 ruling): a
    // station's daily aggregate is MeteoSwiss's own curated figure, not derived
    // from the hourly breakdown shown alongside it.
    const result = await client.callTool('meteoswissLocalForecast', {
      location: 'Napf',
      days: 2,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);

    const day1 = data.forecast.find((d: { date: string }) => d.date === '2026-03-26');
    expect(day1).toBeDefined();
    // Official daily aggregate — unchanged by the hourly fold-in.
    expect(day1.temperature_min_c).toBe(-6.7);
    expect(day1.temperature_max_c).toBe(-3.7);
    expect(day1.precipitation_total_mm).toBe(11.3);
    // Real hourly breakdown is now present.
    expect(Array.isArray(day1.hourly)).toBe(true);
    const hourlySum =
      Math.round(
        day1.hourly
          .filter((h: { precip_mm: number | null }) => h.precip_mm !== null)
          .reduce((sum: number, h: { precip_mm: number | null }) => sum + (h.precip_mm as number), 0) * 10
      ) / 10;
    expect(hourlySum).toBe(9.5);
    // The relaxed invariant itself: official total must NOT equal the hourly sum here.
    expect(day1.precipitation_total_mm).not.toBe(hourlySum);
    // Sunshine/wind have no official daily product — they're derived from the hourly
    // series even for stations.
    expect(day1.sunshine_total_minutes).toBe(360);
    expect(day1.wind_avg_kmh).toBe(6.1);
    expect(day1.wind_gust_max_kmh).toBe(15.8);

    const day2 = data.forecast.find((d: { date: string }) => d.date === '2026-03-27');
    expect(day2).toBeDefined();
    expect(day2.temperature_min_c).toBe(-7.5);
    expect(day2.temperature_max_c).toBe(-3.8);
    expect(day2.precipitation_total_mm).toBe(1.4);
    expect(day2.sunshine_total_minutes).toBe(278);
    expect(day2.wind_avg_kmh).toBe(7.0);
    expect(day2.wind_gust_max_kmh).toBe(17.9);
  });

  it('rounds station-path temperature/precipitation to unit precision (1 decimal place)', async () => {
    // Napf resolves to a station forecast (official daily params for temp/precip).
    // Fixture point 48, date 2026-03-26: tre200dn=-6.7, tre200dx=-3.7, rka150d0=11.3.
    const result = await client.callTool('meteoswissLocalForecast', {
      location: 'Napf',
      days: 1,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    const day = data.forecast[0];
    expect(day.date).toBe('2026-03-26');
    // Exact 1-decimal-place equality already proves the °C/mm rounding contract;
    // a separate `value * 10` integer check would be flaky here since IEEE-754
    // multiplication can turn an already-correct value like 12.3 into
    // 123.00000000000001, making `Number.isInteger` fail on correct output.
    expect(day.temperature_min_c).toBe(-6.7);
    expect(day.temperature_max_c).toBe(-3.7);
    expect(day.precipitation_total_mm).toBe(11.3);
    // Sunshine has no official daily aggregate — 0 decimals (whole minutes).
    expect(Number.isInteger(day.sunshine_total_minutes)).toBe(true);
  });

  it('should return error for empty location', async () => {
    const result = await client
      .callTool('meteoswissLocalForecast', { location: '' })
      .catch((e: Error) => ({ isError: true, content: [{ text: e.message }] }));
    expect(result.isError).toBeTruthy();
  });

  it('should return error for whitespace-only location', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: '   ',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('empty');
  });

  it('should resolve "Bern" to a Bern-area point, not Passo del Bernina', async () => {
    // Intent of this test (from rc.2): name-matching must prefer word-boundary
    // matches over substring matches, so "Bern" does NOT match "Bernina".
    // The winning point may be the BER station OR a Bern postal code — both
    // are in the Bern area (lat ~46.95) and both are correct for this query.
    const result = await client.callTool('meteoswissLocalForecast', {
      location: 'Bern',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.location.name.toLowerCase()).toContain('bern');
    expect(data.location.name).not.toContain('Bernina');
    expect(data.location.coordinates.lat).toBeGreaterThan(46.8);
    expect(data.location.coordinates.lat).toBeLessThan(47.1);
  });

  // --- B2 regression tests (rc.2 failing cases) ---

  it('rejects non-Swiss city "Paris" with a helpful error', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: 'Paris',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"Paris"');
    expect(result.content[0].text).toContain('international city');
  });

  // --- rc.4 regression tests — international city blocklist ---

  it('rejects "London" as a forecast location (international city)', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: 'London',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"London"');
    expect(result.content[0].text).toContain('international city');
  });

  it('rejects "Berlin" as a forecast location (international city)', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: 'Berlin',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"Berlin"');
    expect(result.content[0].text).toContain('international city');
  });

  it('rejects invalid 5-digit postal code "99999" with a helpful error', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: '99999',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"99999"');
    expect(result.content[0].text).toMatch(/forecast location found for/);
  });

  it('rejects gibberish location "ABCDE" with a helpful error', async () => {
    const result = await client.callTool('meteoswissLocalForecast', {
      location: 'ABCDE',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"ABCDE"');
    expect(result.content[0].text).toMatch(/forecast location found for/);
  });

  it('resolves parent postal code "1200" to a Geneva-area point via prefix fallback', async () => {
    // MeteoSwiss metadata lacks round-number parent codes like 1200 (Geneva).
    // Prefix fallback must pick the numerically closest same-prefix code (1201 Genève in the fixture).
    const result = await client.callTool('meteoswissLocalForecast', {
      location: '1200',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.location).toBeDefined();
    expect(data.location.type).toBe('postal_code');
    // Geneva lies at ~46.2° N; the prefix-fallback neighbour must be in that band.
    expect(data.location.coordinates.lat).toBeGreaterThanOrEqual(46.1);
    expect(data.location.coordinates.lat).toBeLessThanOrEqual(46.3);
  });

  it('resolves parent postal code "3000" to a Bern-area point via prefix fallback', async () => {
    // Bern ~46.94° N; prefix fallback should land in 3001 Bern (fixture).
    const result = await client.callTool('meteoswissLocalForecast', {
      location: '3000',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.location).toBeDefined();
    expect(data.location.type).toBe('postal_code');
    expect(data.location.coordinates.lat).toBeGreaterThanOrEqual(46.8);
    expect(data.location.coordinates.lat).toBeLessThanOrEqual(47.0);
  });
});

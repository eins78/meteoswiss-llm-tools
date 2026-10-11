import { describe, expect, it , vi, beforeAll, afterAll } from 'vitest';
import { MCPClient } from './mcp-client.js';

describe('meteoswissCurrentWeather Tool', () => {
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

  it('should be registered as meteoswissCurrentWeather', async () => {
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === 'meteoswissCurrentWeather');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('real-time');
  });

  it('should accept station and coordinates parameters', async () => {
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === 'meteoswissCurrentWeather');
    expect(tool?.inputSchema?.properties).toHaveProperty('station');
    expect(tool?.inputSchema?.properties).toHaveProperty('coordinates');
  });

  it('should return weather for a station name', async () => {
    // The VQHA80 fixture has station TAE, COM, ABO, AIG
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'ABO',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station).toBeDefined();
    expect(data.station.abbreviation).toBe('ABO');
    expect(data.measurements).toBeDefined();
    expect(data.measurements.temperature).toHaveProperty('value');
    expect(data.measurements.temperature).toHaveProperty('unit');
    expect(data.source).toBe('MeteoSwiss Open Data');
  });

  it('should return weather for coordinates, resolving to the nearest station (normal case)', async () => {
    // Coordinates near Adelboden (ABO station), which has temperature data —
    // the nearest-with-temperature selector should reduce to plain nearest.
    const result = await client.callTool('meteoswissCurrentWeather', {
      coordinates: { lat: 46.49, lon: 7.56 },
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station).toBeDefined();
    expect(data.station.abbreviation).toBe('ABO');
    expect(data.station.distance_km).toBeDefined();
    expect(typeof data.station.distance_km).toBe('number');
    expect(data.measurements.temperature).toBeDefined();
  });

  it('should skip a geometrically-nearer sparse station in favor of the nearest station with temperature (issue #110, DECISION-4)', async () => {
    // Coordinates near Zürich Kreis 3: UEB (Uetliberg, ~2.65km) is nearer
    // than SMA (Fluntern, ~3.97km) but only reports sunshine/radiation in
    // this fixture, mirroring the real-world Uetliberg gap. The tool must
    // skip past it to SMA, which has temperature.
    const result = await client.callTool('meteoswissCurrentWeather', {
      coordinates: { lat: 47.3667, lon: 8.5167 },
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station.abbreviation).toBe('SMA');
    expect(data.station.distance_km).toBeCloseTo(3.97, 1);
    expect(data.measurements.temperature).toBeDefined();
    expect(data.measurements.temperature.value).toBe(5.2);
  });

  it('should return error when neither station nor coordinates provided', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('station');
  });

  it('rounds pressure_station to whole hPa at assembly time (fixture has 868.70)', async () => {
    // Fixture row ABO has prestas0=868.70, which must round to 869 (hPa has
    // 0 decimal places) rather than pass through as 868.7.
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'ABO',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.measurements.pressure_station.value).toBe(869);
  });

  it('should include visual observations for OBS stations with all boolean fields', async () => {
    // ALT (Altdorf) is one of the 8 OBS stations with visual observations
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'ALT',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station.abbreviation).toBe('ALT');
    expect(data.measurements.temperature).toBeDefined();

    // OBS stations should have visual observations
    expect(data.visual_observations).toBeDefined();
    expect(data.visual_observations).toHaveProperty('date');
    expect(data.visual_observations).toHaveProperty('cloud_cover_percent');
    expect(typeof data.visual_observations.cloud_cover_percent).toBe('number');

    // All boolean fields must be present (not stripped as undefined)
    // MeteoSwiss '-' means "not observed" = false, not missing
    expect(typeof data.visual_observations.is_clear_day).toBe('boolean');
    expect(typeof data.visual_observations.is_overcast_day).toBe('boolean');
    expect(typeof data.visual_observations.has_rain).toBe('boolean');
    expect(typeof data.visual_observations.has_rain_and_snow).toBe('boolean');
    expect(typeof data.visual_observations.has_snowfall).toBe('boolean');
    expect(typeof data.visual_observations.has_hail).toBe('boolean');
    expect(typeof data.visual_observations.has_fog).toBe('boolean');
    expect(typeof data.visual_observations.has_snow_coverage).toBe('boolean');
  });

  it('should NOT include visual observations for non-OBS stations', async () => {
    // ABO (Adelboden) is NOT an OBS station
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'ABO',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station.abbreviation).toBe('ABO');
    expect(data.visual_observations).toBeUndefined();
  });

  it('should resolve "Bern" to BER (Bern / Zollikofen), not BEH (Passo del Bernina)', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'Bern',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station.abbreviation).toBe('BER');
    expect(data.station.name).toContain('Bern');
  });

  it('should resolve "Zurich" to SMA (Fluntern), not KLO (Kloten) (issue #110, DECISION-5)', async () => {
    // Without the canonical alias, "Zurich" scores an equal fuzzy match
    // against both stations and the shorter-name tie-break picks Kloten —
    // SMA is the canonical Zürich city station, matching how
    // meteoswissClimateData resolves "Zurich".
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'Zurich',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station.abbreviation).toBe('SMA');
  });

  it('should still resolve "Zürich / Kloten" (full name) to KLO — the alias is targeted, not broad', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'Zürich / Kloten',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station.abbreviation).toBe('KLO');
  });

  it('should return error for whitespace-only station query', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: '   ',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('empty');
  });

  it('should return precipitation for a precip-only station', async () => {
    // ABE is a precipitation-only station from the smn-precip network
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'ABE',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.station).toBeDefined();
    expect(data.station.abbreviation).toBe('ABE');
    expect(data.station.network).toBe('smn-precip');
    // Precip-only stations have precipitation but not temperature
    expect(data.measurements.precipitation).toBeDefined();
    expect(data.measurements.precipitation.unit).toBe('mm');
    expect(data.measurements.temperature).toBeUndefined();
    expect(data.source).toBe('MeteoSwiss Open Data');
  });

  // --- B2 regression tests (rc.2 failing cases) ---

  it('rejects non-Swiss city "Paris" with a helpful error', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'Paris',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"Paris"');
    expect(result.content[0].text).toContain('international city');
  });

  it('rejects gibberish station name "NOTASTATION" with a helpful error', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'NOTASTATION',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"NOTASTATION"');
    expect(result.content[0].text).toMatch(/weather station found for/);
    expect(result.content[0].text).toContain('meteoswissStations');
  });

  // --- rc.4 regression tests — international city blocklist ---

  it('rejects "Berlin" (international city, not Swiss)', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'Berlin',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"Berlin"');
    expect(result.content[0].text).toContain('international city');
  });

  it('rejects "London" (international city, not Swiss)', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'London',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"London"');
    expect(result.content[0].text).toContain('international city');
  });

  it('rejects "Tokyo" (international city, not Swiss)', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'Tokyo',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"Tokyo"');
    expect(result.content[0].text).toContain('international city');
  });

  it('rejects gibberish "ZZZZZZ" with a helpful error', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: 'ZZZZZZ',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"ZZZZZZ"');
    expect(result.content[0].text).toMatch(/weather station found for/);
  });

  it('rejects numeric gibberish "1234567890" with a helpful error', async () => {
    const result = await client.callTool('meteoswissCurrentWeather', {
      station: '1234567890',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/weather station found for/);
  });
});

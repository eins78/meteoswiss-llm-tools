import { describe, expect, it } from 'vitest';
import { WeatherSituationResponseSchema } from '../../src/schemas/ogd-weather-situation.js';
import { createServer } from '../../src/server.js';

/** Text nits from the map TEST run (17.11): what a model reads must say these things. */
describe('weather situation tool text', () => {
  const server = createServer() as unknown as {
    _registeredTools: Record<string, { description?: string }>;
  };
  const description = server._registeredTools['meteoswissWeatherSituation']?.description ?? '';

  it('explains "missing"', () => {
    expect(description).toMatch(/"missing".*no weather symbol/);
  });

  it('points to the map tool, if listed, and gives the grid size fields', () => {
    expect(description).toMatch(/meteoswissWeatherMapExperimental if it is listed/);
    expect(description).toMatch(/"grid\.cols".*"grid\.row_count"/);
  });

  it('has cols and row_count in the grid schema', () => {
    const grid = WeatherSituationResponseSchema.shape.grid.unwrap();
    expect(Object.keys(grid.shape)).toEqual(expect.arrayContaining(['cols', 'row_count']));
  });
});

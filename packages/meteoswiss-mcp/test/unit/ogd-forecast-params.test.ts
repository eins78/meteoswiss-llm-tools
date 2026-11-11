import { describe, expect, it } from 'vitest';
import { forecastParamsFor } from '../../src/data/ogd-local-forecast.js';
import { GetLocalForecastParamsSchema } from '../../src/schemas/ogd-local-forecast.js';

describe('forecastParamsFor', () => {
  it('fetches main\'s six hourly params for a basic non-station', () => {
    expect(forecastParamsFor(false, 'basic')).toEqual([
      'tre200h0',
      'rre150h0',
      'jww003i0',
      'sre000h0',
      'fu3010h0',
      'fu3010h1',
    ]);
  });

  it('fetches daily aggregates plus the hourly series WITHOUT jww003i0 for a basic station', () => {
    expect(forecastParamsFor(true, 'basic')).toEqual([
      'tre200dx',
      'tre200dn',
      'rka150d0',
      'jp2000d0',
      'tre200h0',
      'rre150h0',
      'sre000h0',
      'fu3010h0',
      'fu3010h1',
    ]);
  });

  it('adds the cloud cover files for a sky non-station', () => {
    expect(forecastParamsFor(false, 'sky')).toEqual([
      'tre200h0',
      'rre150h0',
      'jww003i0',
      'sre000h0',
      'fu3010h0',
      'fu3010h1',
      'nprolohs',
      'npromths',
      'nprohihs',
    ]);
  });

  it('adds jww003i0 and the cloud cover files for a sky station', () => {
    expect(forecastParamsFor(true, 'sky')).toEqual([
      'tre200dx',
      'tre200dn',
      'rka150d0',
      'jp2000d0',
      'tre200h0',
      'rre150h0',
      'jww003i0',
      'sre000h0',
      'fu3010h0',
      'fu3010h1',
      'nprolohs',
      'npromths',
      'nprohihs',
    ]);
  });

  it('never fetches a cloud cover file for "basic"', () => {
    for (const isStation of [false, true]) {
      for (const param of forecastParamsFor(isStation, 'basic')) {
        expect(param.startsWith('npro')).toBe(false);
      }
    }
  });
});

describe('GetLocalForecastParamsSchema detail', () => {
  it('defaults to "basic"', () => {
    expect(GetLocalForecastParamsSchema.parse({ location: '8001' }).detail).toBe('basic');
  });

  it('rejects an unknown detail value', () => {
    expect(() =>
      GetLocalForecastParamsSchema.parse({ location: '8001', detail: 'full' })
    ).toThrow();
  });
});

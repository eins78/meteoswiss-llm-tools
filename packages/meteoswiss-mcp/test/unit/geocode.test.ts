import { describe, expect, it } from 'vitest';
import {
  buildGeocodeUrl,
  isInsideSwitzerland,
  GEOCODE_ORIGINS,
} from '../../src/support/geocode.js';

describe('buildGeocodeUrl — origin presets', () => {
  it('omits the origins query param for the default "all" preset', () => {
    const url = buildGeocodeUrl('Zurich');
    expect(url).not.toContain('origins=');
    expect(url).toContain('searchText=Zurich');
    expect(url).toContain('type=locations');
    expect(url).toContain('sr=4326');
    expect(url).toContain('limit=1');
  });

  it('omits the origins query param when "all" is passed explicitly', () => {
    const url = buildGeocodeUrl('Zurich', 'all');
    expect(url).not.toContain('origins=');
  });

  it('sends origins=zipcode,gg25,district,kantone for the "place" preset', () => {
    const url = buildGeocodeUrl('Zurich', 'place');
    // URLSearchParams encodes commas as %2C
    expect(url).toContain('origins=zipcode%2Cgg25%2Cdistrict%2Ckantone');
  });

  it('sends origins=address for the "address" preset', () => {
    const url = buildGeocodeUrl('Bahnhofplatz 1 Bern', 'address');
    expect(url).toContain('origins=address');
  });

  it('URL-encodes the search query correctly', () => {
    const url = buildGeocodeUrl('Bahnhofplatz 1 Bern', 'all');
    // Spaces become + with URLSearchParams
    expect(url).toContain('searchText=Bahnhofplatz+1+Bern');
  });

  it('exposes exactly three presets', () => {
    expect([...GEOCODE_ORIGINS].sort()).toEqual(['address', 'all', 'place']);
  });
});

describe('isInsideSwitzerland', () => {
  it('accepts coordinates inside the Swiss bounding box', () => {
    // Zürich Fluntern: 47.37, 8.54
    expect(isInsideSwitzerland(47.37, 8.54)).toBe(true);
    // Genève: 46.2, 6.14
    expect(isInsideSwitzerland(46.2, 6.14)).toBe(true);
    // Lugano: 46.0, 8.95
    expect(isInsideSwitzerland(46.0, 8.95)).toBe(true);
  });

  it('rejects coordinates outside the Swiss bounding box', () => {
    // Paris, France
    expect(isInsideSwitzerland(48.86, 2.35)).toBe(false);
    // London, UK
    expect(isInsideSwitzerland(51.51, -0.13)).toBe(false);
    // Milan, Italy (just south of the bbox)
    expect(isInsideSwitzerland(45.46, 9.19)).toBe(false);
  });
});

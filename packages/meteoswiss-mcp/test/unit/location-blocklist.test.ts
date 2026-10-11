import { describe, expect, it } from 'vitest';
import { isBlocklisted } from '../../src/support/location-blocklist.js';

describe('isBlocklisted', () => {
  it('blocks well-known international city names', () => {
    expect(isBlocklisted('Paris')).toBe(true);
    expect(isBlocklisted('Berlin')).toBe(true);
    expect(isBlocklisted('London')).toBe(true);
    expect(isBlocklisted('Tokyo')).toBe(true);
    expect(isBlocklisted('Rome')).toBe(true);
    expect(isBlocklisted('Madrid')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isBlocklisted('paris')).toBe(true);
    expect(isBlocklisted('PARIS')).toBe(true);
    expect(isBlocklisted('PaRiS')).toBe(true);
  });

  it('does not block legitimate Swiss queries', () => {
    expect(isBlocklisted('Zurich')).toBe(false);
    expect(isBlocklisted('Bern')).toBe(false);
    expect(isBlocklisted('Lausanne')).toBe(false);
    expect(isBlocklisted('Davos')).toBe(false);
    expect(isBlocklisted('SMA')).toBe(false);
    expect(isBlocklisted('8001')).toBe(false);
  });

  it('does not block names that are substrings of blocklisted names', () => {
    expect(isBlocklisted('Pariso')).toBe(false);
    expect(isBlocklisted('New')).toBe(false);
  });
});

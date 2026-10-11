import { describe, expect, it } from 'vitest';
import { normalizeOgdTimestamp } from '../../src/support/ogd-timestamp.js';

/** FUN-3: both fixed-width OGD timestamp formats must normalize to ISO 8601. */
describe('normalizeOgdTimestamp', () => {
  it('normalizes the VQHA80 YYYYMMDDhhmm format', () => {
    expect(normalizeOgdTimestamp('202603281940')).toBe('2026-03-28T19:40:00Z');
  });

  it('normalizes the DD.MM.YYYY HH:MM format', () => {
    expect(normalizeOgdTimestamp('08.04.2026 14:30')).toBe('2026-04-08T14:30:00Z');
  });

  it('normalizes a date-only DD.MM.YYYY to midnight UTC', () => {
    expect(normalizeOgdTimestamp('08.04.2026')).toBe('2026-04-08T00:00:00Z');
  });

  it('returns empty string for an empty cell', () => {
    expect(normalizeOgdTimestamp('')).toBe('');
    expect(normalizeOgdTimestamp('   ')).toBe('');
  });

  it('returns an unrecognized format unchanged (no fabrication)', () => {
    expect(normalizeOgdTimestamp('not-a-date')).toBe('not-a-date');
  });
});

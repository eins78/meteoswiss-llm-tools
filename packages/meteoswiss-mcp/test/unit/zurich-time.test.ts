import { describe, expect, it } from 'vitest';
import { localHourToUtcTs, zurichIso, zurichParts } from '../../src/support/zurich-time.js';

describe('localHourToUtcTs', () => {
  it('reads winter and summer local hours (DST changes on 29.03.2026)', () => {
    expect(localHourToUtcTs('2026-03-28T09:00')).toBe('202603280800'); // CET, UTC+1
    expect(localHourToUtcTs('2026-03-29T08:00')).toBe('202603290600'); // CEST, UTC+2
    expect(localHourToUtcTs('2026-11-14T10:00')).toBe('202611140900');
  });

  it('drops minutes and seconds and accepts a space or a bare hour', () => {
    expect(localHourToUtcTs('2026-11-14T10:45')).toBe('202611140900');
    expect(localHourToUtcTs('2026-11-14T10:59:59')).toBe('202611140900');
    expect(localHourToUtcTs('2026-11-14 10')).toBe('202611140900');
    expect(localHourToUtcTs(' 2026-11-14T10:00 ')).toBe('202611140900');
  });

  it('takes a time with an offset or Z as given', () => {
    expect(localHourToUtcTs('2026-11-14T10:00:00+01:00')).toBe('202611140900');
    expect(localHourToUtcTs('2026-07-14T10:00:00+02:00')).toBe('202607140800');
    expect(localHourToUtcTs('2026-11-14T10:00Z')).toBe('202611141000');
    expect(localHourToUtcTs('2026-11-14T10:30:00-0230')).toBe('202611141300');
  });

  it('gives the first, summer-time occurrence of the doubled autumn hour', () => {
    expect(localHourToUtcTs('2026-10-25T02:00')).toBe('202610250000');
    expect(localHourToUtcTs('2026-10-25T03:00')).toBe('202610250200');
  });

  it('rejects the skipped spring hour', () => {
    expect(() => localHourToUtcTs('2026-03-29T02:00')).toThrow(/does not exist/);
  });

  it('rejects text that is not a date and hour', () => {
    expect(() => localHourToUtcTs('tomorrow')).toThrow(/not a date and hour/);
    expect(() => localHourToUtcTs('2026-11-14')).toThrow(/not a date and hour/);
    expect(() => localHourToUtcTs('2026-02-30T10:00')).toThrow(/not a valid date/);
    expect(() => localHourToUtcTs('2026-11-14T24:00')).toThrow(/not a valid date/);
  });
});

describe('zurichIso / zurichParts', () => {
  it('renders UTC OGD timestamps as local time with offset', () => {
    expect(zurichIso('202603280800')).toBe('2026-03-28T09:00:00+01:00');
    expect(zurichIso('202603290600')).toBe('2026-03-29T08:00:00+02:00');
    expect(zurichParts('202603282300').date).toBe('2026-03-29');
  });
});

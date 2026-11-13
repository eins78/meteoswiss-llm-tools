/**
 * Europe/Zurich wall-clock time for OGD timestamps, in both directions.
 *
 * OGD forecast files carry UTC timestamps (`YYYYMMDDhhmm`); the tools show and
 * accept local Swiss time. Both directions are DST-aware through `Intl`.
 */

/**
 * Formatter that renders a UTC instant as local Europe/Zurich wall-clock time
 * plus its UTC offset (DST-aware). Reused across calls since constructing an
 * `Intl.DateTimeFormat` repeatedly is comparatively expensive.
 */
const zurichFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

/** Local Europe/Zurich date, time and UTC offset of one instant. */
export type ZurichParts = { date: string; time: string; offset: string };

/**
 * Render an instant's local Europe/Zurich date and wall-clock time, DST-correct.
 *
 * @param instant - The instant
 * @returns `date` (YYYY-MM-DD), `time` (hh:mm:ss) and `offset` (e.g. "+01:00")
 */
export function zurichPartsOfDate(instant: Date): ZurichParts {
  const parts = zurichFormatter.formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
    offset: get('timeZoneName').replace('GMT', ''),
  };
}

/**
 * Render a UTC OGD timestamp's local Europe/Zurich date and wall-clock time, DST-correct.
 *
 * @param ts - UTC timestamp `YYYYMMDDhhmm`
 */
export function zurichParts(ts: string): ZurichParts {
  const utcMs = Date.UTC(
    Number(ts.slice(0, 4)),
    Number(ts.slice(4, 6)) - 1,
    Number(ts.slice(6, 8)),
    Number(ts.slice(8, 10)),
    Number(ts.slice(10, 12))
  );
  return zurichPartsOfDate(new Date(utcMs));
}

/**
 * A UTC OGD timestamp as local ISO 8601 with offset, e.g. `2026-03-28T09:00:00+01:00`.
 *
 * @param ts - UTC timestamp `YYYYMMDDhhmm`
 */
export function zurichIso(ts: string): string {
  const { date, time, offset } = zurichParts(ts);
  return `${date}T${time}${offset}`;
}

/** Format an instant as a UTC OGD timestamp `YYYYMMDDhhmm`. */
function toOgdTimestamp(utcMs: number): string {
  const d = new Date(utcMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}

const LOCAL_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

const HOUR_MS = 3_600_000;

/**
 * Parse a time a caller gives and return the UTC OGD timestamp of its hour.
 *
 * Without an offset the time is local Europe/Zurich wall-clock time
 * (`"2026-11-14T10:00"`); with `Z` or `±hh:mm` it is taken as given, so a
 * `time` from another tool's answer can be passed back unchanged. Minutes and
 * seconds are dropped (the hour that contains the time).
 *
 * In the autumn hour that occurs twice (02:00–02:59 on the last Sunday of
 * October) a local time means the first one, in summer time. A local time in
 * the skipped spring hour does not exist and is rejected.
 *
 * @param input - e.g. `"2026-11-14T10:00"`, `"2026-11-14 10"`, `"2026-11-14T10:00:00+01:00"`
 * @returns UTC timestamp `YYYYMMDDhh00`
 * @throws {RangeError} If the text is not a date and hour, or the local hour does not exist
 */
export function localHourToUtcTs(input: string): string {
  const match = LOCAL_TIME.exec(input.trim());
  if (!match) {
    throw new RangeError(
      `"${input}" is not a date and hour; use local Swiss time like "2026-11-14T10:00"`
    );
  }
  const [, y, mo, d, h, mi = '00', , zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const dayCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    dayCheck.getUTCDate() !== day ||
    dayCheck.getUTCMonth() !== month - 1 ||
    hour > 23 ||
    minute > 59
  ) {
    throw new RangeError(`"${input}" is not a valid date and time`);
  }

  if (zone !== undefined) {
    const offsetMin =
      zone === 'Z'
        ? 0
        : (zone.startsWith('-') ? -1 : 1) *
          (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    const utcMs = Date.UTC(year, month - 1, day, hour, minute) - offsetMin * 60_000;
    return toOgdTimestamp(Math.floor(utcMs / HOUR_MS) * HOUR_MS);
  }

  // Swiss time is UTC+2 (summer) or UTC+1 (winter): keep the candidate whose local
  // rendering is the hour asked for. Summer time first, so the doubled autumn hour
  // resolves to its first occurrence.
  const wantDate = `${y}-${mo}-${d}`;
  for (const offsetH of [2, 1]) {
    const utcMs = Date.UTC(year, month - 1, day, hour) - offsetH * HOUR_MS;
    const local = zurichPartsOfDate(new Date(utcMs));
    if (local.date === wantDate && Number(local.time.slice(0, 2)) === hour) {
      return toOgdTimestamp(utcMs);
    }
  }
  throw new RangeError(
    `${wantDate} ${h}:00 does not exist in Swiss local time (the clocks skip that hour)`
  );
}

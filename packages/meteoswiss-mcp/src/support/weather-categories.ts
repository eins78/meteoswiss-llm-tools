/**
 * Coarse weather categories for counting MeteoSwiss weather symbols over many points.
 *
 * MeteoSwiss's hourly symbol (OGD `jww003i0`, 1-42 by day, 101-142 by night) has
 * 42 values per half of the day; an area overview needs about ten. Night codes
 * map like their day code (`code - 100`), except that a clear night is its own
 * category (not "sunny") and a partly cloudy night (103) counts as cloudy.
 *
 * The symbol alone often misses low stratus: an "overcast" or "partly sunny"
 * hour under a low cloud deck carries no fog or stratus symbol. The cloud rule
 * ({@link CLOUD_RULE}) reads the cloud cover files to catch it.
 */

/** Category ids, in legend order. */
export const WEATHER_CATEGORIES = [
  'sunny',
  'clear_night',
  'partly_sunny',
  'cloudy',
  'high_cloud',
  'fog_or_stratus',
  'rain',
  'sleet',
  'snow',
  'thunder',
] as const;

/** One weather category. */
export type WeatherCategory = (typeof WEATHER_CATEGORIES)[number];

/** Day symbol codes per category (night codes are `code + 100`). */
const DAY_CODES: Record<WeatherCategory, readonly number[]> = {
  sunny: [1, 2],
  clear_night: [],
  partly_sunny: [3],
  cloudy: [4, 5, 35],
  high_cloud: [26],
  fog_or_stratus: [27, 28],
  rain: [6, 9, 14, 17, 20, 29, 32, 33],
  sleet: [7, 10, 15, 18, 21, 31],
  snow: [8, 11, 16, 19, 22, 30, 34],
  thunder: [12, 13, 23, 24, 25, 36, 37, 38, 39, 40, 41, 42],
};

const CATEGORY_BY_DAY_CODE: ReadonlyMap<number, WeatherCategory> = new Map(
  WEATHER_CATEGORIES.flatMap((category) =>
    DAY_CODES[category].map((code) => [code, category] as const)
  )
);

/** What each category means, with its symbol codes. */
export const CATEGORY_LEGEND: Record<WeatherCategory, string> = {
  sunny: 'sunny or mostly sunny (symbols 1, 2)',
  clear_night: 'clear or mostly clear night (101, 102)',
  partly_sunny: 'partly sunny (3)',
  cloudy: 'overcast or very cloudy, dry (4, 5, 35; 103 at night)',
  high_cloud: 'high cloud, sun through veils (26)',
  fog_or_stratus:
    'fog or low stratus (27, 28), or an overcast or partly sunny hour with low cloud >= 80 % and medium and high cloud < 50 %',
  rain: 'rain or rain showers (6, 9, 14, 17, 20, 29, 32, 33)',
  sleet: 'sleet (7, 10, 15, 18, 21, 31)',
  snow: 'snow or snow showers (8, 11, 16, 19, 22, 30, 34)',
  thunder: 'thunderstorms possible (12, 13, 23-25, 36-42)',
};

/**
 * The cloud rule: a `cloudy` or `partly_sunny` hour with at least `lowMin` low
 * cloud and less than `midMax` medium and `highMax` high cloud is a low cloud
 * deck, so it counts as `fog_or_stratus`. Fractions of the sky (0-1), as in the
 * OGD files `nprolohs`, `npromths`, `nprohihs`. A first guess, to be tuned
 * against observed fog days.
 */
export const CLOUD_RULE = { lowMin: 0.8, midMax: 0.5, highMax: 0.5 } as const;

/**
 * Category of a MeteoSwiss weather symbol code alone.
 *
 * @param code - `jww003i0` value (1-42 by day, 101-142 by night)
 * @returns The category, or null for a missing or unknown code
 */
export function symbolCategory(code: number): WeatherCategory | null {
  if (!Number.isInteger(code)) return null;
  if (code === 101 || code === 102) return 'clear_night';
  if (code === 103) return 'cloudy';
  const day = code > 100 ? code - 100 : code;
  return CATEGORY_BY_DAY_CODE.get(day) ?? null;
}

/**
 * Category of one point-hour: the symbol's category, turned into
 * `fog_or_stratus` by the cloud rule when the cloud cover shows a low deck.
 * A missing cloud value (NaN) leaves the symbol's category as it is.
 *
 * @param code - `jww003i0` value; NaN if missing
 * @param low - Low cloud cover, fraction 0-1; NaN if missing
 * @param mid - Medium cloud cover, fraction 0-1; NaN if missing
 * @param high - High cloud cover, fraction 0-1; NaN if missing
 * @returns The category, or null for a missing or unknown code
 */
export function categorizeHour(
  code: number,
  low: number,
  mid: number,
  high: number
): WeatherCategory | null {
  const category = symbolCategory(code);
  if (
    (category === 'cloudy' || category === 'partly_sunny') &&
    low >= CLOUD_RULE.lowMin &&
    mid < CLOUD_RULE.midMax &&
    high < CLOUD_RULE.highMax
  ) {
    return 'fog_or_stratus';
  }
  return category;
}

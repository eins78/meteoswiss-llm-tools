/**
 * MeteoSwiss weather pictogram code mapping.
 * Maps numeric codes from jp2000d0 (daily) and jww003i0 (hourly) parameters
 * to human-readable weather descriptions.
 *
 * Source: MeteoSwiss official icon spreadsheet and opendata documentation.
 * SVG icons: https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/{code}.svg
 */

/** Daytime weather descriptions (codes 1-42) */
const DAY_ICONS: Record<number, string> = {
  1: 'sunny',
  2: 'mostly sunny, some clouds',
  3: 'partly sunny, thick passing clouds',
  4: 'overcast',
  5: 'very cloudy',
  6: 'sunny intervals, isolated showers',
  7: 'sunny intervals, isolated sleet',
  8: 'sunny intervals, snow showers',
  9: 'overcast, some rain showers',
  10: 'overcast, some sleet',
  11: 'overcast, some snow showers',
  12: 'sunny intervals, chance of thunderstorms',
  13: 'sunny intervals, possible thunderstorms',
  14: 'very cloudy, light rain',
  15: 'very cloudy, light sleet',
  16: 'very cloudy, light snow showers',
  17: 'very cloudy, intermittent rain',
  18: 'very cloudy, intermittent sleet',
  19: 'very cloudy, intermittent snow',
  20: 'very overcast with rain',
  21: 'very overcast with frequent sleet',
  22: 'very overcast with heavy snow',
  23: 'very overcast, slight chance of storms',
  24: 'very overcast with storms',
  25: 'very cloudy, very stormy',
  26: 'high clouds',
  27: 'stratus',
  28: 'fog',
  29: 'sunny intervals, scattered showers',
  30: 'sunny intervals, scattered snow showers',
  31: 'sunny intervals, scattered sleet',
  32: 'sunny intervals, some showers',
  33: 'short sunny intervals, frequent rain',
  34: 'short sunny intervals, frequent snowfall',
  35: 'overcast and dry',
  // 36-42 mirror night codes 136-142 (day/night code pairs offset by 100);
  // previously missing from this table (issue #110, BUG-3).
  36: 'slightly overcast, slightly stormy',
  37: 'slightly overcast, stormy snow showers',
  38: 'overcast, thundery showers',
  39: 'overcast, thundery snow showers',
  40: 'very cloudy, slightly stormy',
  41: 'overcast, slightly stormy',
  42: 'very cloudy, thundery snow showers',
};

/** Nighttime weather descriptions (codes 101-142) */
const NIGHT_ICONS: Record<number, string> = {
  101: 'clear',
  102: 'slightly overcast',
  103: 'heavy cloud formations',
  104: 'overcast',
  105: 'very cloudy',
  106: 'overcast, scattered showers',
  107: 'overcast, scattered rain and snow showers',
  108: 'overcast, snow showers',
  109: 'overcast, some showers',
  110: 'overcast, some rain and snow showers',
  111: 'overcast, some snow showers',
  112: 'slightly stormy',
  113: 'storms',
  114: 'very cloudy, light rain',
  115: 'very cloudy, light rain and snow showers',
  116: 'very cloudy, light snowfall',
  117: 'very cloudy, intermittent rain',
  118: 'very cloudy, intermittent mixed rain and snowfall',
  119: 'very cloudy, intermittent snowfall',
  120: 'very cloudy, constant rain',
  121: 'very cloudy, frequent rain and snowfall',
  122: 'very cloudy, heavy snowfall',
  123: 'very cloudy, slightly stormy',
  124: 'very cloudy, stormy',
  125: 'very cloudy, storms',
  126: 'high cloud',
  127: 'stratus',
  128: 'fog',
  129: 'slightly overcast, scattered showers',
  130: 'slightly overcast, scattered snowfall',
  131: 'slightly overcast, rain and snow showers',
  132: 'slightly overcast, some showers',
  133: 'overcast, frequent rain showers',
  134: 'overcast, frequent snow showers',
  135: 'overcast and dry',
  136: 'slightly overcast, slightly stormy',
  137: 'slightly overcast, stormy snow showers',
  138: 'overcast, thundery showers',
  139: 'overcast, thundery snow showers',
  140: 'very cloudy, slightly stormy',
  141: 'overcast, slightly stormy',
  142: 'very cloudy, thundery snow showers',
};

const ICON_BASE_URL = 'https://www.meteoschweiz.admin.ch/static/resources/weather-symbols';

/**
 * Map a MeteoSwiss weather pictogram code to a human-readable description.
 *
 * @param code - Numeric pictogram code (1-42 for day, 101-142 for night)
 * @returns Human-readable weather description, or "unknown ({code})" for unmapped codes
 */
export function weatherIconDescription(code: number): string {
  return DAY_ICONS[code] ?? NIGHT_ICONS[code] ?? `unknown (${code})`;
}

/**
 * Get the SVG icon URL for a MeteoSwiss weather pictogram code.
 * Returns null for codes not in the known icon maps.
 *
 * @param code - Numeric pictogram code (1-42 for day, 101-142 for night)
 * @returns URL to the SVG weather symbol, or null for unknown codes
 */
export function weatherIconUrl(code: number): string | null {
  if (DAY_ICONS[code] === undefined && NIGHT_ICONS[code] === undefined) {
    return null;
  }
  return `${ICON_BASE_URL}/${code}.svg`;
}

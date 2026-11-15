/**
 * Recipes for the server `instructions` and the `sunFinder` prompt.
 *
 * The instructions reach the agent's context when a client connects, so they cost
 * context in every session: keep them short. They name the tools in order and say how
 * to read the answer, for the questions that need more than one call.
 */

/** Default travel radius of the sunFinder prompt, in km. */
export const SUN_FINDER_DEFAULT_RADIUS_KM = 60;

/** The server instructions: a few recipes for questions that need more than one tool call. */
export const SERVER_INSTRUCTIONS = `Recipes for questions that need more than one call (all times Europe/Zurich; forecasts reach about 9 days ahead):
1. Where to catch the sun, or get above the fog, on a day from a start place: call meteoswissLocalForecast for the start place (its location.coordinates), then meteoswissWeatherSituation for the morning and noon hours (time, until at most 12 h later, near = {lat, lon, radius_km}, bands such as [600, 800, 1000, 1200, 1500]) and compare the sunny share per altitude band. Then call meteoswissLocalForecast for the 2-3 best places and check sunshine_minutes per hour. Answer with place, altitude and hours.
2. Where is it sunny, wet or snowing across Switzerland: one meteoswissWeatherSituation call per hour or window, not one forecast per place. Read pct and dominant per region and band. "Sunny or mostly sunny" is the category sunny. Points are not area: a band with few points says little.
3. How high does the fog reach: meteoswissWeatherSituation with region mittelland, jura or alpennordhang. fog_top_m is the top of a fog sea with sun above it; null means none, so read the bands. fog_or_stratus on summits is cloud, not a fog sea: set max_altitude_m.
4. One place: meteoswissLocalForecast with a place name, postal code or station code; detail "sky" for fog and cloud, hourly for timing. Measured values now: meteoswissCurrentWeather (a measurement, not a forecast).`;

/** Arguments of the sunFinder prompt, as clients send them (all strings). */
export type SunFinderArgs = {
  day?: string | undefined;
  start?: string | undefined;
  radius_km?: string | undefined;
};

/**
 * The text of the sunFinder prompt: the question with its arguments filled in and the
 * recipe to follow.
 *
 * @param args - The day, the start place and the travel radius in km, each optional
 */
export function sunFinderText(args: SunFinderArgs): string {
  const day = args.day?.trim() || 'tomorrow';
  const start = args.start?.trim() || 'Zurich';
  const radius = Number(args.radius_km);
  const radiusKm =
    Number.isFinite(radius) && radius > 0 ? Math.min(radius, 150) : SUN_FINDER_DEFAULT_RADIUS_KM;
  return `Where can I catch the sun ${day}? I start from ${start} and will travel up to ${radiusKm} km. If there is fog or low cloud where I start, where do I get above it?

Follow this recipe:
1. meteoswissLocalForecast for "${start}": note location.coordinates and the weather there.
2. meteoswissWeatherSituation for the hours from 08:00 to 16:00 on ${day} (one call, time and until at most 12 h apart), near = {lat, lon, radius_km: ${radiusKm}} from step 1, bands [600, 800, 1000, 1200, 1500]. Compare the sunny share per altitude band and per region; fog_top_m is the top of a fog sea.
3. meteoswissLocalForecast for the 2-3 most promising places (name, altitude), checking sunshine_minutes per hour.
Answer briefly: the best 2-3 places, from which hour, at which altitude, and how far from ${start}.`;
}

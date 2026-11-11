/**
 * Third multi-series round (PR #183): the hourly weather symbol and cloud cover.
 *
 * PR #183 adds five fields to every `hourly[]` entry of `meteoswissLocalForecast`, after
 * `wind_gust_kmh`: `weather_code`, `weather`, `cloud_low_pct`, `cloud_mid_pct`,
 * `cloud_high_pct`. That makes the hourly part of a 5-day answer about 75 % larger. Round 2
 * (`multiseries.ts`, results in ../docs/results/2026-07-11-hourly-multiseries-shape-refinement.md)
 * gated one extra field (wind gust) on evidence for the same reason: token cost for small
 * models. This round asks two questions:
 *
 *   1. Distraction cost: do the 14 Round-2 questions (the shipped `b-flat-gust` shape, gust
 *      present) score lower when the hourly objects carry the five new fields?
 *   2. Help: can models answer fog, stratus and cloud questions from the new fields, and do they
 *      decline (not invent) those answers when the fields are absent?
 *
 * Arms (`SYMBOL_ARMS`): {main, pr183} x {1 day, 5 days}.
 *   - `main` = today's shipped shape. The 1-day main fixture is byte-identical to Round 2's
 *     `b-flat-gust` fixture (asserted in symbol-cloud.test.ts), so its numbers compare with July.
 *   - `pr183` = the same object plus the five new fields per hour, in the PR's order.
 *   - 5 days = the Round-2 day as day 3 of 5, with four decoy days around it (see `DECOY_DAYS`).
 *     Every question still names the Round-2 date, so the ground truth does not change; the
 *     decoys make the payload the size of a real 5-day answer, and a model that reads the wrong
 *     day gets a wrong answer.
 *
 * The sky table (`SKY_TABLE`) for the Round-2 day is hand-picked to fit the existing rows:
 * fog only at night with no sun and no rain, rain symbols on the rain hours, sunny symbols where
 * the sun shines, and a low cloud deck in the evening that the symbol calls "overcast".
 * The five existing columns (`hourlyRows()`) are not changed.
 *
 * The new questions (`symbolQuestions`) use the SAME prompt in both arms. Each prompt allows a
 * decline ("this data has no fog/cloud information"); on `main` the decline is the right answer
 * (scored with the `unavailable` leaf kind, which also fails any number the model invents), on
 * `pr183` the facts are. The prompt carries the JSON only, not the tool description, so the
 * description's low-deck hint is not seen: these questions measure the fields alone.
 */

import type { Expected, LeafExpected } from "./questions.js";
import {
  SHAPE_B_VARIANTS,
  hourlyRows,
  multiseriesQuestions,
  shapeBFixture,
  type HourlyRow,
  type MultiseriesQuestion,
} from "./multiseries.js";

/** The Round-2 date and offset, read from its rows so the two files cannot drift apart. */
const DATE = hourlyRows()[0]!.time.slice(0, 10);
const OFFSET = hourlyRows()[0]!.time.slice(-6);

/** Round 2's settled shape (flat container, gust present) — what `main` ships today. */
const SHIPPED_VARIANT = SHAPE_B_VARIANTS["b-flat-gust"]!;

/** MeteoSwiss symbol texts for the codes used below, copied from
 * packages/meteoswiss-mcp/src/support/weather-icons.ts (this package does not import the
 * server's source; see ../README.md). */
const SYMBOL_TEXT: Record<number, string> = {
  2: "mostly sunny, some clouds",
  3: "partly sunny, thick passing clouds",
  4: "overcast",
  5: "very cloudy",
  14: "very cloudy, light rain",
  26: "high clouds",
  27: "stratus",
  28: "fog",
  101: "clear",
  104: "overcast",
  114: "very cloudy, light rain",
  127: "stratus",
  128: "fog",
};

const FOG_CODES = new Set([28, 128]);

/** hour -> [weather_code, cloud_low_pct, cloud_mid_pct, cloud_high_pct] for the Round-2 day.
 * A code describes the 3 hours that end at its hour; day codes 06-19, night codes otherwise.
 * Fits the Round-2 rows: sun 0 and dry at 00-05, 10 min sun at 06, rain at 07-08, sun peaks
 * at 12, no sun from 19. */
const SKY_TABLE: [number, number, number, number][] = [
  [101, 0, 0, 10], // 00 clear
  [101, 5, 0, 10], // 01 clear
  [128, 90, 0, 5], // 02 fog forms (1.0 °C: not below 1)
  [128, 100, 0, 0], // 03 fog, 0.5 °C — the first freezing-fog hour
  [128, 100, 0, 0], // 04 fog
  [128, 100, 0, 0], // 05 fog — the last fog hour
  [27, 85, 10, 0], // 06 stratus: the fog lifts into a low layer (10 min sun)
  [14, 60, 70, 20], // 07 light rain
  [14, 50, 90, 30], // 08 light rain
  [5, 30, 60, 40], // 09 very cloudy
  [3, 20, 40, 30], // 10
  [2, 10, 20, 30], // 11
  [2, 5, 10, 40], // 12
  [2, 5, 10, 50], // 13
  [26, 0, 10, 75], // 14 high clouds
  [26, 0, 10, 85], // 15 high clouds — the most high cloud (unique)
  [3, 10, 40, 60], // 16
  [3, 20, 50, 40], // 17
  [4, 70, 40, 20], // 18 overcast
  [4, 95, 5, 0], // 19 "overcast", but a low cloud deck: low 95, mid 5, high 0
  [127, 100, 0, 0], // 20 stratus
  [127, 100, 0, 0], // 21 stratus
  [104, 95, 5, 0], // 22 overcast (low deck)
  [104, 90, 5, 0], // 23 overcast (low deck)
];

export type SkyRow = {
  code: number;
  low: number;
  mid: number;
  high: number;
};

function skyRow([code, low, mid, high]: [
  number,
  number,
  number,
  number,
]): SkyRow {
  return { code, low, mid, high };
}

export function skyRows(): SkyRow[] {
  return SKY_TABLE.map(skyRow);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isDaytime(hour: number): boolean {
  return hour >= 6 && hour <= 19;
}

/**
 * Decoy days around the Round-2 day for the 5-day arms. Each is the Round-2 table rotated by
 * `shift` hours (row h takes the values of Round-2 hour h - shift), with temperature, sunshine,
 * rain and wind changed, so every "which hour" and "how much" answer differs from the Round-2
 * day. Rotation puts a little sun one or two hours outside April daylight on some decoys; that
 * is accepted (the same in both arms, and no question asks about a decoy day).
 * Sky on decoy days follows a plain rule from the rotated rows (`decoySky`), plus fog on one
 * decoy (`fogHours`), so a fog answer read from the wrong day is wrong.
 */
type DecoyDay = {
  date: string;
  shift: number;
  tempOffset: number;
  sunScale: number;
  precipScale: number;
  windDelta: number;
  weatherCode: number;
  fogHours: number[];
};

const DECOY_DAYS: DecoyDay[] = [
  {
    date: "2026-04-04",
    shift: 2,
    tempOffset: -2.5,
    sunScale: 0.3,
    precipScale: 4,
    windDelta: 4,
    weatherCode: 14,
    fogHours: [],
  },
  {
    date: "2026-04-05",
    shift: -1,
    tempOffset: -1,
    sunScale: 0.7,
    precipScale: 0,
    windDelta: 1,
    weatherCode: 3,
    fogHours: [],
  },
  {
    date: "2026-04-07",
    shift: 1,
    tempOffset: 1.5,
    sunScale: 0.9,
    precipScale: 0,
    windDelta: -2,
    weatherCode: 2,
    fogHours: [4, 5, 6],
  },
  {
    date: "2026-04-08",
    shift: 3,
    tempOffset: 2.5,
    sunScale: 0.5,
    precipScale: 2,
    windDelta: 3,
    weatherCode: 14,
    fogHours: [],
  },
];

function decoyRows(day: DecoyDay): HourlyRow[] {
  const base = hourlyRows();
  return base.map((_, hour) => {
    const src = base[(((hour - day.shift) % 24) + 24) % 24]!;
    const windKmh = Math.max(1, src.windKmh + day.windDelta);
    return {
      hour,
      time: `${day.date}T${String(hour).padStart(2, "0")}:00:00${OFFSET}`,
      precipMm: round1(src.precipMm * day.precipScale),
      sunshineMin: Math.round(src.sunshineMin * day.sunScale),
      windKmh,
      tempC: round1(src.tempC + day.tempOffset),
      gustKmh: Math.max(windKmh + 1, src.gustKmh + day.windDelta),
    };
  });
}

function decoySky(day: DecoyDay, rows: HourlyRow[]): SkyRow[] {
  return rows.map((r) => {
    const day6to19 = isDaytime(r.hour);
    if (day.fogHours.includes(r.hour)) {
      return { code: day6to19 ? 28 : 128, low: 100, mid: 0, high: 0 };
    }
    if (r.precipMm > 0) {
      return { code: day6to19 ? 14 : 114, low: 60, mid: 80, high: 30 };
    }
    if (r.sunshineMin >= 40) return { code: 2, low: 5, mid: 10, high: 30 };
    if (r.sunshineMin > 0) return { code: 3, low: 20, mid: 40, high: 40 };
    if (day6to19) return { code: 4, low: 60, mid: 50, high: 40 };
    return { code: 101, low: 0, mid: 0, high: 10 };
  });
}

/** Render one day in the shipped key order (see packages/meteoswiss-mcp/src/data/
 * ogd-local-forecast.ts, `buildHourlyAggregatedForecast` + `groupUnifiedHourlyByDate`), with the
 * five PR #183 fields appended to each hour when `sky` is given. Summaries are derived from the
 * same rows, as the server derives them for postal codes. */
function renderShippedDay(
  date: string,
  rows: HourlyRow[],
  sky: SkyRow[] | null,
  weather: string,
  iconCode: number,
): Record<string, unknown> {
  const hourly = rows.map((r) => {
    const entry: Record<string, unknown> = {
      time: r.time,
      temperature_c: r.tempC,
      precip_mm: r.precipMm,
      sunshine_minutes: r.sunshineMin,
      wind_kmh: r.windKmh,
      wind_gust_kmh: r.gustKmh,
    };
    if (sky) {
      const s = sky[r.hour]!;
      entry.weather_code = s.code;
      entry.weather = SYMBOL_TEXT[s.code] ?? null;
      entry.cloud_low_pct = s.low;
      entry.cloud_mid_pct = s.mid;
      entry.cloud_high_pct = s.high;
    }
    return entry;
  });
  return {
    date,
    weather,
    weather_icon_url: `https://www.meteoschweiz.admin.ch/static/resources/weather-symbols/${iconCode}.svg`,
    temperature_min_c: round1(Math.min(...rows.map((r) => r.tempC))),
    temperature_max_c: round1(Math.max(...rows.map((r) => r.tempC))),
    precipitation_total_mm: round1(rows.reduce((a, r) => a + r.precipMm, 0)),
    sunshine_total_minutes: rows.reduce((a, r) => a + r.sunshineMin, 0),
    wind_avg_kmh: round1(rows.reduce((a, r) => a + r.windKmh, 0) / rows.length),
    wind_gust_max_kmh: round1(Math.max(...rows.map((r) => r.gustKmh))),
    hourly,
  };
}

/** Round 2's daily text and icon for its day (see multiseries.ts `renderDay`). */
const ROUND2_WEATHER = "sunny intervals, light rain in the morning";
const ROUND2_ICON = 14;

export type SymbolArm = { withSky: boolean; days: 1 | 5 };

export const SYMBOL_ARMS: Record<string, SymbolArm> = {
  "main-1d": { withSky: false, days: 1 },
  "pr183-1d": { withSky: true, days: 1 },
  "main-5d": { withSky: false, days: 5 },
  "pr183-5d": { withSky: true, days: 5 },
};

/** The Round-2 day, rendered by this file's renderer. Without sky it must equal Round 2's
 * `b-flat-gust` day exactly (tested). */
export function round2Day(withSky: boolean): Record<string, unknown> {
  return renderShippedDay(
    DATE,
    hourlyRows(),
    withSky ? skyRows() : null,
    ROUND2_WEATHER,
    ROUND2_ICON,
  );
}

export function symbolFixture(arm: SymbolArm): unknown {
  if (arm.days === 1 && !arm.withSky) {
    // Byte-identical to Round 2's fixture, so the July numbers compare.
    return shapeBFixture(SHIPPED_VARIANT);
  }
  const decoys = DECOY_DAYS.map((d) => {
    const rows = decoyRows(d);
    return {
      date: d.date,
      day: renderShippedDay(
        d.date,
        rows,
        arm.withSky ? decoySky(d, rows) : null,
        SYMBOL_TEXT[d.weatherCode] ?? "",
        d.weatherCode,
      ),
    };
  });
  const days =
    arm.days === 1
      ? [round2Day(arm.withSky)]
      : [
          ...decoys.filter((d) => d.date < DATE).map((d) => d.day),
          round2Day(arm.withSky),
          ...decoys.filter((d) => d.date > DATE).map((d) => d.day),
        ];
  const firstDate = String((days[0] as { date: string }).date);
  return {
    location: {
      name: "Zürich",
      type: "postal_code",
      elevation: 409,
      coordinates: { lat: 47.372289, lon: 8.542189 },
    },
    generated: `${firstDate}T04:00:00.000000Z`,
    forecast: days,
    source: "MeteoSwiss Open Data",
  };
}

/** Ground truth for the new questions, derived from the two Round-2 tables. */
export const symbolGroundTruth = (() => {
  const rows = hourlyRows();
  const sky = skyRows();
  const morningFog = sky
    .map((s, hour) => ({ hour, fog: FOG_CODES.has(s.code) }))
    .filter((x) => x.hour <= 12 && x.fog)
    .map((x) => x.hour);
  if (morningFog.length === 0)
    throw new Error("sky table has no morning fog hour");
  const highMax = Math.max(...sky.map((s) => s.high));
  const highMaxHours = sky
    .map((s, hour) => ({ hour, high: s.high }))
    .filter((x) => x.high === highMax);
  if (highMaxHours.length !== 1)
    throw new Error("sky table's high-cloud maximum must be unique");
  const freezingFog = rows.filter(
    (r) => FOG_CODES.has(sky[r.hour]!.code) && r.tempC < 1,
  );
  const h19 = sky[19]!;
  const h15 = sky[15]!;
  return {
    fogFirst: morningFog[0]!,
    fogLast: morningFog[morningFog.length - 1]!,
    fogCount: morningFog.length,
    highMaxHour: highMaxHours[0]!.hour,
    highMax,
    freezingFogExists: freezingFog.length > 0,
    freezingFogHour: freezingFog[0]?.hour ?? -1,
    freezingFogTempC: freezingFog[0]?.tempC ?? Number.NaN,
    h19LowDeck: h19.low >= 80 && h19.mid < 50 && h19.high < 50,
    h19Low: h19.low,
    h15Code: h15.code,
  };
})();

const ANSWER_INSTRUCTION =
  "Respond with ONLY a single-line strict JSON object in the exact schema given — no markdown fences, no explanation, no extra keys.";

/** One new question: the same prompt in both arms; `parts` are the facts the pr183 arm must
 * give, `flag` is the key whose `false` is the right answer on main. */
function symbolQuestion(
  withSky: boolean,
  id: string,
  family: string,
  promptText: string,
  flag: string,
  parts: LeafExpected[],
): MultiseriesQuestion {
  const expected: Expected = withSky
    ? parts.length === 1
      ? parts[0]!
      : { kind: "compound", parts }
    : { key: flag, kind: "unavailable" };
  return { id, family, promptText, expected };
}

/** The five new fog, stratus and cloud questions. */
export function symbolQuestions(withSky: boolean): MultiseriesQuestion[] {
  const gt = symbolGroundTruth;
  const noFog =
    "If this data does not say whether there is fog at a given hour, say so instead of guessing.";
  const noCloud =
    "If this data has no cloud information per hour, say so instead of guessing.";
  const noSymbol =
    "If this data has no weather symbol per hour, say so instead of guessing.";
  return [
    symbolQuestion(
      withSky,
      "sym-fog-span",
      "sym-span",
      `On ${DATE}, between 00:00 and 12:00 local time, which hours does the forecast show as fog? Give the first and the last such hour, and how many hours that is. ${noFog} ${ANSWER_INSTRUCTION} Schema: {"fog_data": true, "first_hour": "HH:00", "last_hour": "HH:00", "fog_hours": <number>} or {"fog_data": false}`,
      "fog_data",
      [
        { key: "first_hour", kind: "hour", value: gt.fogFirst },
        { key: "last_hour", kind: "hour", value: gt.fogLast },
        { key: "fog_hours", kind: "number", value: gt.fogCount, tolerance: 0 },
      ],
    ),
    symbolQuestion(
      withSky,
      "sym-freezing-fog",
      "sym-existence",
      `Is there a local hour on ${DATE} with fog AND a temperature below 1 °C (a risk of freezing fog)? If yes, give the earliest such hour and its temperature. ${noFog} ${ANSWER_INSTRUCTION} Schema: {"fog_data": true, "exists": true | false, "hour": "HH:00", "temperature_c": <number>} or {"fog_data": false}`,
      "fog_data",
      [
        { key: "exists", kind: "bool", value: gt.freezingFogExists },
        { key: "hour", kind: "hour", value: gt.freezingFogHour },
        {
          key: "temperature_c",
          kind: "number",
          value: gt.freezingFogTempC,
          tolerance: 0.05,
        },
      ],
    ),
    symbolQuestion(
      withSky,
      "sym-low-deck-1900",
      "sym-point",
      `At 19:00 local time on ${DATE}: is the sky covered mainly by low cloud (fog, stratus or a low cloud deck, with little medium or high cloud), and what is the low cloud cover in percent? ${noCloud} ${ANSWER_INSTRUCTION} Schema: {"cloud_data": true, "mainly_low_cloud": true | false, "low_cloud_pct": <number>} or {"cloud_data": false}`,
      "cloud_data",
      [
        { key: "mainly_low_cloud", kind: "bool", value: gt.h19LowDeck },
        {
          key: "low_cloud_pct",
          kind: "number",
          value: gt.h19Low,
          tolerance: 0.5,
        },
      ],
    ),
    symbolQuestion(
      withSky,
      "sym-argmax-high",
      "sym-argmax",
      `Which single local hour on ${DATE} has the most high cloud, and how much of the sky does it cover, in percent? ${noCloud} ${ANSWER_INSTRUCTION} Schema: {"cloud_data": true, "hour": "HH:00", "high_cloud_pct": <number>} or {"cloud_data": false}`,
      "cloud_data",
      [
        { key: "hour", kind: "hour", value: gt.highMaxHour },
        {
          key: "high_cloud_pct",
          kind: "number",
          value: gt.highMax,
          tolerance: 0.5,
        },
      ],
    ),
    symbolQuestion(
      withSky,
      "sym-code-1500",
      "sym-point",
      `What is the MeteoSwiss weather symbol code for 15:00 local time on ${DATE}? ${noSymbol} ${ANSWER_INSTRUCTION} Schema: {"symbol_data": true, "weather_code": <number>} or {"symbol_data": false}`,
      "symbol_data",
      [
        {
          key: "weather_code",
          kind: "number",
          value: gt.h15Code,
          tolerance: 0,
        },
      ],
    ),
  ];
}

/** Every question for one arm: the 14 Round-2 questions (gust present), then the five new ones. */
export function symbolArmQuestions(arm: SymbolArm): MultiseriesQuestion[] {
  return [
    ...multiseriesQuestions(SHIPPED_VARIANT),
    ...symbolQuestions(arm.withSky),
  ];
}

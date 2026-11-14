/**
 * Five area questions for the weather-situation tool (`meteoswissWeatherSituation`):
 * they test whether an agent reaches for the whole-country counts instead of
 * looking up single places, and whether a skill agent can do the same from the
 * OGD files (one `jww003i0` file plus the point list).
 *
 * Ground truth comes from the situation tool through the local MCP server, as
 * the forecast questions' does from `meteoswissLocalForecast`. Every question is
 * answerable without MeteoSwiss's forecast regions (they are not Open Data):
 * altitude limits and plain-language areas only, with gray zones where two
 * ways of drawing "the Plateau" or "north of the Alps" could disagree.
 *
 * Two of the five are worded like the use case the tool was built for: a
 * person who wants a forecast of where to go, to find sun and get out of the fog.
 */

import type { Expected } from "./scoring-model.js";
import { upcomingDays } from "./ground-truth-live.js";
import type { GroundTruthContext, QuestionDef } from "./questions.js";

/** One region of a situation answer, read with a single altitude band. */
export type SituationRegion = {
  id: string;
  points: number;
  /** Category → share of the region's points, whole percent. */
  pct: Record<string, number>;
};

/** One captured situation call and the day it was asked for. */
export type SituationCapture = {
  date: string;
  weekday: string;
  regions: SituationRegion[];
};

/** The calls the capture makes: question key → hour and tool arguments for day 1. */
export const SITUATION_CALLS: Record<
  string,
  { hour: string; args: Record<string, unknown> }
> = {
  "sunny-high": { hour: "12:00", args: { min_altitude_m: 1500, bands: [] } },
  "fog-plateau": {
    hour: "09:00",
    args: { region: "mittelland", max_altitude_m: 799, bands: [] },
  },
  "wet-side": { hour: "15:00", args: { bands: [] } },
  "best-weather": { hour: "10:00", args: { bands: [] } },
  "uphill-north": {
    hour: "09:00",
    args: { min_altitude_m: 800, max_altitude_m: 1500, bands: [] },
  },
};

/** Tool arguments of one call for day 1 after `now`. */
export function situationArgs(
  key: string,
  now: Date,
): { date: string; weekday: string; args: Record<string, unknown> } {
  const call = SITUATION_CALLS[key];
  if (call === undefined) throw new Error(`unknown situation call ${key}`);
  const { date, weekday } = upcomingDays(now).d1;
  return {
    date,
    weekday,
    args: { time: `${date}T${call.hour}`, ...call.args },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the regions of a situation answer called with `bands: []` (one band per region).
 *
 * @throws {Error} If the text is not such an answer
 */
export function parseSituationRegions(text: string): SituationRegion[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.regions)) {
    throw new Error(`not a weather-situation answer: ${text.slice(0, 200)}`);
  }
  return parsed.regions.map((region: unknown) => {
    if (
      !isRecord(region) ||
      typeof region.id !== "string" ||
      typeof region.points !== "number"
    ) {
      throw new Error("weather-situation region without id or points");
    }
    const band: unknown = Array.isArray(region.bands)
      ? region.bands[0]
      : undefined;
    const pct: Record<string, number> = {};
    if (isRecord(band) && isRecord(band.pct)) {
      for (const [category, share] of Object.entries(band.pct)) {
        if (typeof share === "number") pct[category] = share;
      }
    }
    return { id: region.id, points: region.points, pct };
  });
}

function capture(ctx: GroundTruthContext, key: string): SituationCapture {
  const found = ctx.situation.get(key);
  if (found === undefined) throw new Error(`no situation capture for ${key}`);
  return found;
}

/** Share (percent) of the points in `regions` that are in one of `categories`. */
export function shareOf(
  regions: readonly SituationRegion[],
  categories: readonly string[],
): number {
  const total = regions.reduce((sum, r) => sum + r.points, 0);
  if (total === 0) return 0;
  const hits = regions.reduce(
    (sum, r) =>
      sum +
      (r.points * categories.reduce((s, c) => s + (r.pct[c] ?? 0), 0)) / 100,
    0,
  );
  return (hits * 100) / total;
}

const WET = ["rain", "sleet", "snow", "thunder"];
const NORTH = ["jura", "mittelland", "alpennordhang"];

/** Expected answer for the wetter-side question (exported for tests). */
export function wetSideExpected(regions: readonly SituationRegion[]): Expected {
  const north = shareOf(
    regions.filter((r) => NORTH.includes(r.id)),
    WET,
  );
  const south = shareOf(
    regions.filter((r) => r.id === "alpensuedseite"),
    WET,
  );
  if (north < 5 && south < 5) {
    return {
      fields: { wetter_side: { kind: "oneof", accepted: ["neither"] } },
    };
  }
  if (Math.abs(north - south) < 10)
    return { fields: { wetter_side: { kind: "any" } } };
  return {
    fields: {
      wetter_side: {
        kind: "oneof",
        accepted: [north > south ? "north" : "south"],
      },
    },
  };
}

/** The questions' "sunny or mostly sunny" is the tool's `sunny` category (symbols 1 and 2); "partly sunny" (symbol 3) is not in it. */
const GOOD = ["sunny"];
const AREAS: Record<string, string[]> = {
  north: NORTH,
  wallis: ["wallis"],
  grisons: ["engadin", "nordundmittelbuenden"],
  south: ["alpensuedseite"],
};

/** Expected answer for the best-weather question: the area with the most sunny points (exported for tests). */
export function bestAreaExpected(
  regions: readonly SituationRegion[],
): Expected {
  const shares = Object.entries(AREAS)
    .map(([area, ids]) => ({
      area,
      share: shareOf(
        regions.filter((r) => ids.includes(r.id)),
        GOOD,
      ),
    }))
    .sort((a, b) => b.share - a.share);
  const [first, second] = shares;
  if (first === undefined || second === undefined) {
    throw new Error("no areas to compare");
  }
  // Within 10 points of the runner-up, either area is a fair answer.
  if (first.share - second.share < 10) {
    return {
      fields: {
        best_area: { kind: "oneof", accepted: [first.area, second.area] },
      },
    };
  }
  return { fields: { best_area: { kind: "oneof", accepted: [first.area] } } };
}

/** Expected answer for the get-out-of-the-fog question (exported for tests). */
export function upHillExpected(
  plateau: readonly SituationRegion[],
  hills: readonly SituationRegion[],
): Expected {
  const below = shareOf(plateau, GOOD);
  const above = shareOf(
    hills.filter((r) => NORTH.includes(r.id)),
    GOOD,
  );
  // Within 15 points the trip is not clearly worth it, so either answer counts.
  if (Math.abs(above - below) < 15) {
    return { fields: { go_up: { kind: "any" } } };
  }
  return { fields: { go_up: { kind: "boolean", value: above > below } } };
}

export const SITUATION_QUESTIONS: QuestionDef[] = [
  {
    id: "situation-sunny-high",
    family: "situation",
    question: (ctx) => {
      const c = capture(ctx, "sunny-high");
      return `At 12:00 local time on ${c.weekday} (${c.date}), what share of MeteoSwiss's local forecast points in Switzerland at or above 1500 m show the weather symbol "sunny" or "mostly sunny"? Answer in percent.`;
    },
    schemaHint: '{"sunny_pct": <number>}',
    computeExpected: (ctx) => ({
      fields: {
        sunny_pct: {
          kind: "number",
          value: shareOf(capture(ctx, "sunny-high").regions, ["sunny"]),
          tolerance: 10,
        },
      },
    }),
  },
  {
    id: "situation-fog-plateau",
    family: "situation",
    question: (ctx) => {
      const c = capture(ctx, "fog-plateau");
      return `At 09:00 local time on ${c.weekday} (${c.date}), will fog or low stratus cover most of the Swiss Plateau (the Mittelland) below 800 m, that is more than half of the forecast points there?`;
    },
    schemaHint: '{"mostly_fog": <true|false>}',
    computeExpected: (ctx) => {
      const fog = shareOf(capture(ctx, "fog-plateau").regions, [
        "fog_or_stratus",
      ]);
      // 40-60 %: where exactly "the Plateau" ends decides it, so either answer counts.
      return {
        fields: {
          mostly_fog:
            fog > 60
              ? { kind: "boolean", value: true }
              : fog < 40
                ? { kind: "boolean", value: false }
                : { kind: "any" },
        },
      };
    },
  },
  {
    id: "situation-wet-side",
    family: "situation",
    question: (ctx) => {
      const c = capture(ctx, "wet-side");
      return `At 15:00 local time on ${c.weekday} (${c.date}), where does a larger share of the forecast points show rain, sleet, snow or thunder: north of the Alps (Jura, Plateau and northern Alps) or on the southern side of the Alps (Ticino and the southern valleys of Grisons)? Answer "north", "south", or "neither" if both are dry.`;
    },
    schemaHint: '{"wetter_side": "north" | "south" | "neither"}',
    computeExpected: (ctx) => wetSideExpected(capture(ctx, "wet-side").regions),
  },
  {
    id: "situation-best-weather",
    family: "situation",
    question: (ctx) => {
      const c = capture(ctx, "best-weather");
      return `I want to spend ${c.weekday} (${c.date}) outdoors and drive wherever the weather is best at 10:00 local time. Which part of Switzerland has the largest share of forecast points with sun (symbol "sunny" or "mostly sunny"): "north" (north of the Alps: Jura, Plateau and northern Alps), "wallis", "grisons" (Engadin and northern and central Grisons) or "south" (Ticino and the southern valleys of Grisons)?`;
    },
    schemaHint: '{"best_area": "north" | "wallis" | "grisons" | "south"}',
    computeExpected: (ctx) =>
      bestAreaExpected(capture(ctx, "best-weather").regions),
  },
  {
    id: "situation-out-of-fog",
    family: "situation",
    question: (ctx) => {
      const c = capture(ctx, "fog-plateau");
      return `I live on the Swiss Plateau and want to get out of the fog on ${c.weekday} (${c.date}) at 9:00 local time. Looking at forecast points with sun ("sunny" or "mostly sunny"): is the share higher at 800-1500 m north of the Alps (Jura, Prealps and northern Alps) than on the Plateau (the Mittelland) below 800 m? Answer true if driving up is worth it, false if not.`;
    },
    schemaHint: '{"go_up": <true|false>}',
    computeExpected: (ctx) =>
      upHillExpected(
        capture(ctx, "fog-plateau").regions,
        capture(ctx, "uphill-north").regions,
      ),
  },
];

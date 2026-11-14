/**
 * Offline tests for the weather-situation questions: reading the tool's answer,
 * the shares behind the expected answers, and the gray zones.
 * Inline fixtures, no network, no cost.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  QUESTIONS,
  type GroundTruthContext,
} from "./mcp-vs-skills/questions.js";
import {
  bestAreaExpected,
  upHillExpected,
  parseSituationRegions,
  shareOf,
  situationArgs,
  wetSideExpected,
  type SituationRegion,
} from "./mcp-vs-skills/situation-questions.js";

const ANSWER = JSON.stringify({
  valid: { from: "2026-11-14T09:00:00+01:00", hours: 1 },
  run: "2026-11-13T11:00:00+01:00",
  points: 300,
  regions: [
    {
      id: "jura",
      name: "Jura",
      points: 100,
      dominant: "fog_or_stratus",
      bands: [
        {
          band: "all",
          points: 100,
          pct: { fog_or_stratus: 70, sunny: 30 },
          dominant: "fog_or_stratus",
        },
      ],
      fog_top_m: null,
    },
    {
      id: "alpensuedseite",
      name: "Alpensüdseite",
      points: 200,
      dominant: "rain",
      bands: [
        {
          band: "all",
          points: 200,
          pct: { rain: 55, cloudy: 45 },
          dominant: "rain",
        },
      ],
    },
  ],
  legend: {},
  source: "MeteoSwiss",
});

function region(
  id: string,
  points: number,
  pct: Record<string, number>,
): SituationRegion {
  return { id, points, pct };
}

function contextWith(regions: SituationRegion[]): GroundTruthContext {
  const capture = { date: "2026-11-14", weekday: "Saturday", regions };
  return {
    capturedAt: new Date("2026-11-13T10:00:00+01:00"),
    current: new Map(),
    stationNames: new Map(),
    grStations: [],
    forecasts: new Map(),
    situation: new Map([
      ["sunny-high", capture],
      ["fog-plateau", capture],
      ["wet-side", capture],
      ["best-weather", capture],
      ["uphill-north", capture],
    ]),
    pollen: new Map(),
    climateZurichMonthly: new Map(),
  };
}

function expectedOf(id: string, ctx: GroundTruthContext): unknown {
  const question = QUESTIONS.find((q) => q.id === id);
  if (question === undefined) throw new Error(`no question ${id}`);
  return question.computeExpected(ctx).fields;
}

test("parseSituationRegions reads id, points and the single band's shares", () => {
  assert.deepEqual(parseSituationRegions(ANSWER), [
    region("jura", 100, { fog_or_stratus: 70, sunny: 30 }),
    region("alpensuedseite", 200, { rain: 55, cloudy: 45 }),
  ]);
});

test("parseSituationRegions rejects an answer without regions", () => {
  assert.throws(
    () => parseSituationRegions('{"error": "no run"}'),
    /not a weather-situation answer/,
  );
});

test("shareOf weights each region by its points", () => {
  const regions = [
    region("a", 100, { sunny: 50 }),
    region("b", 300, { sunny: 10, rain: 90 }),
  ];
  // (50 + 30) of 400 points
  assert.equal(shareOf(regions, ["sunny"]), 20);
  assert.equal(shareOf(regions, ["sunny", "rain"]), 87.5);
  assert.equal(shareOf([], ["sunny"]), 0);
});

test("situationArgs asks for day 1 at the call's local hour", () => {
  const call = situationArgs(
    "fog-plateau",
    new Date("2026-11-13T10:00:00+01:00"),
  );
  assert.deepEqual(call, {
    date: "2026-11-14",
    weekday: "Saturday",
    args: {
      time: "2026-11-14T09:00",
      region: "mittelland",
      max_altitude_m: 799,
      bands: [],
    },
  });
  assert.throws(
    () => situationArgs("nope", new Date()),
    /unknown situation call/,
  );
});

test("wetSideExpected: neither when both sides are dry", () => {
  const regions = [
    region("mittelland", 100, { rain: 4 }),
    region("alpensuedseite", 100, { snow: 3 }),
  ];
  assert.deepEqual(wetSideExpected(regions).fields, {
    wetter_side: { kind: "oneof", accepted: ["neither"] },
  });
});

test("wetSideExpected: a clear difference names the side", () => {
  const regions = [
    region("jura", 100, { rain: 10 }),
    region("mittelland", 300, { rain: 30 }),
    region("alpensuedseite", 100, { rain: 80, thunder: 5 }),
    region("wallis", 100, { snow: 100 }),
  ];
  // north: (10 + 90) / 400 = 25 %; south: 85 %; Wallis counts on neither side
  assert.deepEqual(wetSideExpected(regions).fields, {
    wetter_side: { kind: "oneof", accepted: ["south"] },
  });
});

test("wetSideExpected: within 10 points either answer counts", () => {
  const regions = [
    region("alpennordhang", 100, { rain: 40 }),
    region("alpensuedseite", 100, { rain: 48 }),
  ];
  assert.deepEqual(wetSideExpected(regions).fields, {
    wetter_side: { kind: "any" },
  });
});

test("fog question grades only outside the 40-60 % gray zone", () => {
  assert.deepEqual(
    expectedOf(
      "situation-fog-plateau",
      contextWith([region("mittelland", 10, { fog_or_stratus: 61 })]),
    ),
    {
      mostly_fog: { kind: "boolean", value: true },
    },
  );
  assert.deepEqual(
    expectedOf(
      "situation-fog-plateau",
      contextWith([region("mittelland", 10, { fog_or_stratus: 50 })]),
    ),
    {
      mostly_fog: { kind: "any" },
    },
  );
  assert.deepEqual(
    expectedOf(
      "situation-fog-plateau",
      contextWith([region("mittelland", 10, { fog_or_stratus: 39 })]),
    ),
    {
      mostly_fog: { kind: "boolean", value: false },
    },
  );
});

test("sunny question counts only the sunny category over all regions", () => {
  const ctx = contextWith([
    region("wallis", 300, { sunny: 80, partly_sunny: 20 }),
    region("engadin", 100, { sunny: 20, cloudy: 80 }),
  ]);
  assert.deepEqual(expectedOf("situation-sunny-high", ctx), {
    sunny_pct: { kind: "number", value: 65, tolerance: 10 },
  });
});

test("bestAreaExpected names the sunniest area, or two when they are close", () => {
  const regions = [
    region("jura", 100, { fog_or_stratus: 90, sunny: 10 }),
    region("wallis", 100, { sunny: 70, partly_sunny: 10 }),
    region("engadin", 50, { sunny: 20 }),
    region("alpensuedseite", 100, { rain: 80 }),
  ];
  assert.deepEqual(bestAreaExpected(regions).fields, {
    best_area: { kind: "oneof", accepted: ["wallis"] },
  });
  const close = [
    region("mittelland", 100, { sunny: 70 }),
    region("wallis", 100, { sunny: 75 }),
    region("alpensuedseite", 100, { rain: 80 }),
    region("engadin", 100, { cloudy: 90 }),
  ];
  assert.deepEqual(bestAreaExpected(close).fields, {
    best_area: { kind: "oneof", accepted: ["wallis", "north"] },
  });
});

test("upHillExpected: fog below and sun above says go up; a small gap is not graded", () => {
  const plateau = [
    region("mittelland", 100, { fog_or_stratus: 80, sunny: 20 }),
  ];
  const hills = [
    region("jura", 50, { sunny: 70, partly_sunny: 10 }),
    region("wallis", 500, { sunny: 100 }), // not north of the Alps: ignored
  ];
  assert.deepEqual(upHillExpected(plateau, hills).fields, {
    go_up: { kind: "boolean", value: true },
  });
  assert.deepEqual(
    upHillExpected(hills.slice(0, 1), [
      region("jura", 50, { sunny: 40 }),
      region("alpennordhang", 50, { sunny: 20 }),
    ]).fields,
    { go_up: { kind: "boolean", value: false } },
  );
  assert.deepEqual(
    upHillExpected(plateau, [region("jura", 50, { sunny: 30 })]).fields,
    { go_up: { kind: "any" } },
  );
});

test("the question set has 17 unique ids, five of them situation questions", () => {
  const ids = QUESTIONS.map((q) => q.id);
  assert.equal(ids.length, 17);
  assert.equal(new Set(ids).size, 17);
  assert.deepEqual(
    QUESTIONS.filter((q) => q.family === "situation").map((q) => q.id),
    [
      "situation-sunny-high",
      "situation-fog-plateau",
      "situation-wet-side",
      "situation-best-weather",
      "situation-out-of-fog",
    ],
  );
});

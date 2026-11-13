/**
 * Offline tests for the MCP-vs-skills scoring model and ground-truth parsers.
 * Inline fixture strings, no network, no cost. Follows the suite's testing rules:
 * no conditional assertions, assert content not just structure.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  canonicalPollenSpecies,
  extractFinalJson,
  normalizeName,
  scoreAnswer,
  type Expected,
} from "./mcp-vs-skills/scoring-model.js";
import {
  climateMonthlyFromCsv,
  currentFromCsv,
  parseForecastJson,
  pollenFromCsv,
  precipInWindow,
  minTempInWindow,
  stationNamesFromCsv,
  upcomingDays,
} from "./mcp-vs-skills/ground-truth-live.js";

// --- scoring ---

test("extractFinalJson takes the last FINAL_JSON line", () => {
  const text =
    'Some reasoning.\nFINAL_JSON: {"a": 1}\nActually, revised:\nFINAL_JSON: {"temperature_c": 23.1}';
  assert.deepEqual(extractFinalJson(text), { temperature_c: 23.1 });
});

test("number field passes within tolerance and fails outside", () => {
  const expected: Expected = {
    fields: { temperature_c: { kind: "number", value: 23.1, tolerance: 1.5 } },
  };
  assert.equal(
    scoreAnswer('FINAL_JSON: {"temperature_c": 24.0}', expected).pass,
    true,
  );
  assert.equal(
    scoreAnswer('FINAL_JSON: {"temperature_c": 30}', expected).pass,
    false,
  );
  assert.equal(scoreAnswer("no final json here", expected).outcome, "format");
});

test("oneof station matching is diacritic- and substring-tolerant", () => {
  const expected: Expected = {
    fields: {
      station: {
        kind: "oneof",
        accepted: ["GVE", "Genève / Cointrin"],
      },
    },
  };
  assert.equal(
    scoreAnswer('FINAL_JSON: {"station": "Geneve/Cointrin"}', expected).pass,
    true,
  );
  assert.equal(
    scoreAnswer('FINAL_JSON: {"station": "Lugano"}', expected).pass,
    false,
  );
});

test("subset-of gives partial credit and rejects out-of-universe names", () => {
  const expected: Expected = {
    fields: {
      stations: {
        kind: "subset-of",
        universe: ["Arosa", "ARO", "Davos", "DAV", "Buffalora", "BUF"],
        minCount: 3,
      },
    },
  };
  const full = scoreAnswer(
    'FINAL_JSON: {"stations": ["Arosa", "Davos", "Buffalora"]}',
    expected,
  );
  assert.equal(full.pass, true);
  const partial = scoreAnswer(
    'FINAL_JSON: {"stations": ["Arosa", "Davos", "Bern"]}',
    expected,
  );
  assert.equal(partial.pass, false);
  assert.ok(partial.score > 0.5 && partial.score < 1);
});

test("set-match canonicalizes pollen synonyms across languages", () => {
  const expected: Expected = {
    fields: { pollen_types: { kind: "set-match", expected: ["grasses"] } },
  };
  assert.equal(
    scoreAnswer('FINAL_JSON: {"pollen_types": ["Gräser (Poaceae)"]}', expected)
      .pass,
    true,
  );
  assert.equal(
    scoreAnswer('FINAL_JSON: {"pollen_types": ["Birch", "Grasses"]}', expected)
      .pass,
    false,
  );
});

test("multi-field answers score fractionally", () => {
  const expected: Expected = {
    fields: {
      saturday_max_c: { kind: "number", value: 30, tolerance: 2 },
      sunday_max_c: { kind: "number", value: 29, tolerance: 2 },
    },
  };
  const half = scoreAnswer(
    'FINAL_JSON: {"saturday_max_c": 31, "sunday_max_c": 20}',
    expected,
  );
  assert.equal(half.pass, false);
  assert.equal(half.score, 0.5);
});

test("any-kind fields accept any present value", () => {
  const expected: Expected = {
    fields: {
      max_temperature_c: { kind: "number", value: 20, tolerance: 1.5 },
      jacket_recommended: { kind: "any" },
    },
  };
  assert.equal(
    scoreAnswer(
      'FINAL_JSON: {"max_temperature_c": 20.5, "jacket_recommended": true}',
      expected,
    ).pass,
    true,
  );
});

test("normalizeName strips diacritics; pollen synonyms canonicalize", () => {
  assert.equal(normalizeName("Säntis"), "santis");
  assert.equal(canonicalPollenSpecies("Poaceae"), "grasses");
  assert.equal(canonicalPollenSpecies("Esche"), "ash");
  assert.equal(canonicalPollenSpecies("tulip"), null);
});

test("pollen param codes canonicalize to species (skill answers quote raw codes)", () => {
  assert.equal(canonicalPollenSpecies("khpoacd1"), "grasses");
  assert.equal(canonicalPollenSpecies("kacoryd0"), "hazel");
});

test("a field missing from FINAL_JSON scores 0 without crashing", () => {
  const expected: Expected = {
    fields: {
      temperature_c: { kind: "number", value: 20, tolerance: 1 },
      wind_kmh: { kind: "number", value: 10, tolerance: 1 },
    },
  };
  const result = scoreAnswer('FINAL_JSON: {"temperature_c": 20}', expected);
  assert.equal(result.pass, false);
  assert.equal(result.score, 0.5);
});

test("set-match with empty expected: empty answer passes, non-empty fails", () => {
  const expected: Expected = {
    fields: { pollen_types: { kind: "set-match", expected: [] } },
  };
  assert.equal(
    scoreAnswer('FINAL_JSON: {"pollen_types": []}', expected).pass,
    true,
  );
  assert.equal(
    scoreAnswer('FINAL_JSON: {"pollen_types": ["Birch"]}', expected).pass,
    false,
  );
});

test("numbers given as comma-decimal strings are accepted", () => {
  const expected: Expected = {
    fields: { temperature_c: { kind: "number", value: 23.1, tolerance: 1 } },
  };
  assert.equal(
    scoreAnswer('FINAL_JSON: {"temperature_c": "23,4"}', expected).pass,
    true,
  );
});

// --- parsers ---

const VQHA80_SAMPLE = [
  "Station/Location;Date;tre200s0;rre150z0;fu3010z0;fu3010z1",
  "SMA;202607112130;23.1;0.0;8.3;11.5",
  "SAE;202607112130;12.4;0.0;41.8;58.7",
  "GVE;202607112130;25.0;-;10.1;15.2",
  "AIG;202607112130;;0.0;5.0;7.0",
].join("\n");

test("currentFromCsv parses values and treats empty/dash as null", () => {
  const current = currentFromCsv(VQHA80_SAMPLE);
  assert.equal(current.get("SMA")?.["tre200s0"], 23.1);
  assert.equal(current.get("SAE")?.["fu3010z0"], 41.8);
  assert.equal(current.get("GVE")?.["rre150z0"], null);
  assert.equal(current.get("AIG")?.["tre200s0"], null);
});

test("stationNamesFromCsv maps abbr to name", () => {
  const csv =
    "station_abbr;station_name;station_canton\nSMA;Zürich / Fluntern;ZH\nSAE;Säntis;AI";
  const names = stationNamesFromCsv(csv);
  assert.equal(names.get("SMA"), "Zürich / Fluntern");
  assert.equal(names.get("SAE"), "Säntis");
});

test("pollenFromCsv reads the last row's d1 values", () => {
  const csv = [
    "station_abbr;reference_timestamp;kabetud1;khpoacd1",
    "PZH;09.07.2026 00:00;5;99",
    "PZH;10.07.2026 00:00;0;30",
  ].join("\n");
  const pollen = pollenFromCsv(csv);
  assert.equal(pollen["grasses"], 30);
  assert.equal(pollen["birch"], 0);
  assert.equal(pollen["oak"], null);
});

test("climateMonthlyFromCsv keys by YYYY-MM", () => {
  const csv = [
    "station_abbr;reference_timestamp;ths200m0;rhs150m0",
    "SMA;01.05.2026 00:00;15.3;80",
    "SMA;01.06.2026 00:00;19.9;120",
  ].join("\n");
  const monthly = climateMonthlyFromCsv(csv);
  assert.equal(monthly.get("2026-06"), 19.9);
  assert.equal(monthly.get("2026-05"), 15.3);
});

test("upcomingDays: next two local days, correct across midnight and weekdays", () => {
  // 2026-07-11 was a Saturday (Europe/Zurich).
  const lateSaturday = new Date("2026-07-11T23:30:00+02:00");
  assert.deepEqual(upcomingDays(lateSaturday), {
    d1: { date: "2026-07-12", weekday: "Sunday" },
    d2: { date: "2026-07-13", weekday: "Monday" },
  });
  const earlySunday = new Date("2026-07-12T00:30:00+02:00");
  assert.deepEqual(upcomingDays(earlySunday), {
    d1: { date: "2026-07-13", weekday: "Monday" },
    d2: { date: "2026-07-14", weekday: "Tuesday" },
  });
});

const FORECAST_SAMPLE = JSON.stringify({
  location: { name: "Zürich" },
  forecast: [
    {
      date: "2026-07-12",
      temperature_min_c: 18,
      temperature_max_c: 31.5,
      precipitation_total_mm: 2.4,
      sunshine_total_minutes: 480,
      hourly: [
        { time: "2026-07-12T06:00:00+02:00", temperature_c: 18, precip_mm: 0 },
        {
          time: "2026-07-12T13:00:00+02:00",
          temperature_c: 29,
          precip_mm: 1.2,
        },
        {
          time: "2026-07-12T17:00:00+02:00",
          temperature_c: 30,
          precip_mm: 1.2,
        },
        { time: "2026-07-12T21:00:00+02:00", temperature_c: 24, precip_mm: 0 },
      ],
    },
  ],
});

test("forecast window helpers aggregate the right hours", () => {
  const days = parseForecastJson(FORECAST_SAMPLE);
  assert.equal(precipInWindow(days, "2026-07-12", 12, 18), 2.4);
  assert.equal(precipInWindow(days, "2026-07-12", 0, 8), 0);
  assert.equal(minTempInWindow(days, "2026-07-12", 12, 22), 24);
  assert.throws(() => precipInWindow(days, "2026-07-13", 12, 18));
});

test("empty hourly data fails fast instead of becoming 'no rain' ground truth", () => {
  const days = parseForecastJson(
    JSON.stringify({
      forecast: [{ date: "2026-07-12", hourly: [] }],
    }),
  );
  assert.throws(() => precipInWindow(days, "2026-07-12", 12, 18), /no hourly/);
  assert.throws(() => minTempInWindow(days, "2026-07-12", 12, 18), /no hourly/);
});

// --- question expected-answer construction (the two with real branching) ---

import {
  QUESTIONS,
  type GroundTruthContext,
} from "./mcp-vs-skills/questions.js";

function syntheticCtx(): GroundTruthContext {
  return {
    capturedAt: new Date("2026-07-11T23:30:00+02:00"),
    current: new Map([
      ["AAA", { tre200s0: 30.0 }],
      ["BBB", { tre200s0: 29.5 }], // within 0.7 °C of max — accepted
      ["CCC", { tre200s0: 25.0 }], // not accepted
      ["DDD", { tre200s0: null }], // precip-only station — skipped
    ]),
    stationNames: new Map([
      ["AAA", "Alpha / Dorf"],
      ["BBB", "Beta"],
    ]),
    grStations: [{ abbr: "ARO", name: "Arosa" }],
    forecasts: new Map([
      [
        "basel",
        [
          {
            date: "2026-07-12",
            tMax: 33.6,
            tMin: 20,
            precipTotal: 0,
            sunshineTotalMin: 600,
            hourly: [
              { time: "2026-07-12T12:00:00+02:00", temp: 30, precip: 0 },
            ],
          },
        ],
      ],
    ]),
    situation: new Map(),
    pollen: new Map(),
    climateZurichMonthly: new Map([["2026-05", 15.3]]),
  };
}

test("warmest-station accepts every station within 0.7°C of the max, by abbr or name", () => {
  const question = QUESTIONS.find((q) => q.id === "current-warmest-station")!;
  const expected = question.computeExpected(syntheticCtx());
  const field = expected.fields["station"]!;
  assert.equal(field.kind, "oneof");
  const accepted = (field as { accepted: string[] }).accepted;
  assert.deepEqual(
    [...accepted].sort(),
    ["AAA", "Alpha / Dorf", "BBB", "Beta"].sort(),
  );
});

test("jacket question grades the boolean only outside the 15–22°C gray zone", () => {
  const question = QUESTIONS.find((q) => q.id === "forecast-jacket-basel")!;
  const hot = question.computeExpected(syntheticCtx());
  assert.deepEqual(hot.fields["jacket_recommended"], {
    kind: "boolean",
    value: false,
  });

  const mild = syntheticCtx();
  mild.forecasts.get("basel")![0]!.tMax = 18;
  assert.deepEqual(
    question.computeExpected(mild).fields["jacket_recommended"],
    { kind: "any" },
  );

  const cold = syntheticCtx();
  cold.forecasts.get("basel")![0]!.tMax = 10;
  assert.deepEqual(
    question.computeExpected(cold).fields["jacket_recommended"],
    { kind: "boolean", value: true },
  );
});

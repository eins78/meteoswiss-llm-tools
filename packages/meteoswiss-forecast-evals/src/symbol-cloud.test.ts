import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SHAPE_B_VARIANTS,
  hourlyRows,
  multiseriesGroundTruth,
  shapeBFixture,
} from "./multiseries.js";
import {
  SYMBOL_ARMS,
  round2Day,
  skyRows,
  symbolArmQuestions,
  symbolFixture,
  symbolGroundTruth,
} from "./symbol-cloud.js";
import { scoreResponse } from "./scoring-core.js";

type Day = {
  date: string;
  precipitation_total_mm: number;
  sunshine_total_minutes: number;
  hourly: Array<Record<string, unknown>>;
};
type Fixture = { forecast: Day[] };

const DATE = hourlyRows()[0]!.time.slice(0, 10);
const NEW_KEYS = [
  "weather_code",
  "weather",
  "cloud_low_pct",
  "cloud_mid_pct",
  "cloud_high_pct",
];

describe("symbol-cloud fixtures", () => {
  test("main-1d is byte-identical to Round 2's b-flat-gust fixture", () => {
    assert.equal(
      JSON.stringify(symbolFixture(SYMBOL_ARMS["main-1d"]!)),
      JSON.stringify(shapeBFixture(SHAPE_B_VARIANTS["b-flat-gust"]!)),
    );
  });

  test("this file's renderer reproduces Round 2's day without sky", () => {
    const july = shapeBFixture(SHAPE_B_VARIANTS["b-flat-gust"]!) as Fixture;
    assert.equal(
      JSON.stringify(round2Day(false)),
      JSON.stringify(july.forecast[0]),
    );
  });

  test("pr183 arms add exactly the five new keys after wind_gust_kmh, in the PR's order", () => {
    for (const label of ["pr183-1d", "pr183-5d"]) {
      const f = symbolFixture(SYMBOL_ARMS[label]!) as Fixture;
      for (const day of f.forecast) {
        for (const h of day.hourly) {
          const keys = Object.keys(h);
          assert.deepEqual(keys.slice(-6), ["wind_gust_kmh", ...NEW_KEYS]);
          assert.equal(typeof h.weather, "string");
        }
      }
    }
  });

  test("main and pr183 differ only in the five new keys", () => {
    for (const days of ["1d", "5d"]) {
      const main = symbolFixture(SYMBOL_ARMS[`main-${days}`]!) as Fixture;
      const pr = symbolFixture(SYMBOL_ARMS[`pr183-${days}`]!) as Fixture;
      const stripped = structuredClone(pr);
      for (const day of stripped.forecast)
        for (const h of day.hourly) for (const k of NEW_KEYS) delete h[k];
      assert.equal(JSON.stringify(stripped), JSON.stringify(main));
    }
  });

  test("5-day arms: Round-2 day is day 3 of 5, dates consecutive, summaries match hourly", () => {
    const f = symbolFixture(SYMBOL_ARMS["pr183-5d"]!) as Fixture;
    assert.deepEqual(
      f.forecast.map((d) => d.date),
      ["2026-04-04", "2026-04-05", DATE, "2026-04-07", "2026-04-08"],
    );
    for (const day of f.forecast) {
      assert.equal(day.hourly.length, 24);
      const precip =
        Math.round(
          day.hourly.reduce((a, h) => a + (h.precip_mm as number), 0) * 10,
        ) / 10;
      const sun = day.hourly.reduce(
        (a, h) => a + (h.sunshine_minutes as number),
        0,
      );
      assert.equal(day.precipitation_total_mm, precip);
      assert.equal(day.sunshine_total_minutes, sun);
    }
  });

  test("decoy days give different answers than the Round-2 day", () => {
    const f = symbolFixture(SYMBOL_ARMS["pr183-5d"]!) as Fixture;
    const gt = multiseriesGroundTruth;
    const sgt = symbolGroundTruth;
    const argmaxHour = (day: Day, key: string): number => {
      let best = 0;
      day.hourly.forEach((h, i) => {
        if ((h[key] as number) > (day.hourly[best]![key] as number)) best = i;
      });
      return best;
    };
    for (const day of f.forecast.filter((d) => d.date !== DATE)) {
      assert.notEqual(argmaxHour(day, "sunshine_minutes"), gt.maxSunshineHour);
      assert.notEqual(argmaxHour(day, "temperature_c"), gt.maxTempHour);
      assert.notEqual(argmaxHour(day, "wind_gust_kmh"), gt.maxGustHour);
      assert.notEqual(argmaxHour(day, "cloud_high_pct"), sgt.highMaxHour);
      assert.notEqual(day.sunshine_total_minutes, gt.sunshineTotal);
      assert.notEqual(day.hourly[15]!.weather_code, sgt.h15Code);
      const fogHours = day.hourly
        .map((h, i) => ({ i, c: h.weather_code }))
        .filter((x) => x.c === 28 || x.c === 128)
        .map((x) => x.i);
      if (fogHours.length > 0) assert.notEqual(fogHours[0], sgt.fogFirst);
    }
  });
});

describe("symbol-cloud ground truth", () => {
  test("derived from the tables, with the values the table comments name", () => {
    const gt = symbolGroundTruth;
    assert.equal(gt.fogFirst, 2);
    assert.equal(gt.fogLast, 5);
    assert.equal(gt.fogCount, 4);
    assert.equal(gt.freezingFogExists, true);
    assert.equal(gt.freezingFogHour, 3);
    assert.equal(gt.freezingFogTempC, 0.5);
    assert.equal(gt.highMaxHour, 15);
    assert.equal(gt.highMax, 85);
    assert.equal(gt.h19LowDeck, true);
    assert.equal(gt.h19Low, 95);
    assert.equal(gt.h15Code, 26);
  });

  test("sky table fits the Round-2 rows: fog only without sun or rain, rain codes on rain hours", () => {
    const rows = hourlyRows();
    skyRows().forEach((s, hour) => {
      const r = rows[hour]!;
      if (s.code === 28 || s.code === 128) {
        assert.equal(r.sunshineMin, 0, `fog at ${hour} with sun`);
        assert.equal(r.precipMm, 0, `fog at ${hour} with rain`);
      }
      if (r.precipMm > 0)
        assert.ok([14, 114].includes(s.code), `rain at ${hour}`);
    });
  });
});

describe("symbol-cloud questions", () => {
  const ideal: Record<string, string> = {
    "sym-fog-span":
      '{"fog_data": true, "first_hour": "02:00", "last_hour": "05:00", "fog_hours": 4}',
    "sym-freezing-fog":
      '{"fog_data": true, "exists": true, "hour": "03:00", "temperature_c": 0.5}',
    "sym-low-deck-1900":
      '{"cloud_data": true, "mainly_low_cloud": true, "low_cloud_pct": 95}',
    "sym-argmax-high":
      '{"cloud_data": true, "hour": "15:00", "high_cloud_pct": 85}',
    "sym-code-1500": '{"symbol_data": true, "weather_code": 26}',
  };

  test("an ideal answer scores full marks on pr183, and a decline does on main", () => {
    const pr = symbolArmQuestions(SYMBOL_ARMS["pr183-5d"]!).filter((q) =>
      q.id.startsWith("sym-"),
    );
    const main = symbolArmQuestions(SYMBOL_ARMS["main-5d"]!).filter((q) =>
      q.id.startsWith("sym-"),
    );
    assert.equal(pr.length, 5);
    for (const q of pr) {
      const r = scoreResponse(ideal[q.id], q.expected);
      assert.equal(r.pass, true, `${q.id}: ${r.detail}`);
    }
    for (const q of main) {
      const flag =
        q.id === "sym-code-1500"
          ? "symbol_data"
          : q.id.includes("fog")
            ? "fog_data"
            : "cloud_data";
      assert.equal(
        scoreResponse(`{"${flag}": false}`, q.expected).pass,
        true,
        q.id,
      );
      // the PR answer on main is a fabrication
      assert.equal(scoreResponse(ideal[q.id], q.expected).pass, false, q.id);
    }
  });

  test("the same prompt text in both arms", () => {
    const pr = symbolArmQuestions(SYMBOL_ARMS["pr183-1d"]!);
    const main = symbolArmQuestions(SYMBOL_ARMS["main-1d"]!);
    assert.deepEqual(
      pr.map((q) => q.promptText),
      main.map((q) => q.promptText),
    );
    assert.equal(pr.length, 19);
  });

  test("main arm: the daily icon code (14) given as the 15:00 symbol is a fabrication", () => {
    const q = symbolArmQuestions(SYMBOL_ARMS["main-5d"]!).find(
      (x) => x.id === "sym-code-1500",
    )!;
    assert.equal(
      scoreResponse('{"symbol_data": false, "weather_code": 14}', q.expected)
        .pass,
      false,
    );
  });
});

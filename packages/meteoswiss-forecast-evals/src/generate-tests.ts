/**
 * Builds every promptfoo test case for the programmatic (lookup) slice and writes them to
 * generated/tests.json — committed so reviewers can see the EXACT prompts and expected
 * answers a PR reviewer or Max would want to audit, without running anything. Also writes
 * generated/fixtures/*.json: the exact JSON blob shown to the model for each (variant,
 * fixture) pair, for the same reason.
 *
 * Run via `pnpm run generate` (also runs automatically before `test`/`eval`/`smoke`/`dryrun`).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture, variantOf, type Variant } from "./fixture.js";
import {
  canonicalReadings,
  isDryAt,
  localDatesInOrder,
  sumRange,
} from "./ground-truth.js";
import {
  primaryQuestions,
  sevenDayQuestions,
  stationQuestion,
  type GeneratedQuestion,
} from "./questions.js";
import {
  SHAPE_B_VARIANTS,
  multiseriesQuestions,
  shapeBFixture,
  stationMockFixture,
  stationMockQuestion,
} from "./multiseries.js";
import {
  SYMBOL_ARMS,
  symbolArmQuestions,
  symbolFixture,
} from "./symbol-cloud.js";
import { compactSevenDayFixture } from "./compact-representation.js";
import type { LocalForecastResponse } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.resolve(__dirname, "../generated");
const FIXTURES_OUT_DIR = path.join(GENERATED_DIR, "fixtures");

mkdirSync(FIXTURES_OUT_DIR, { recursive: true });

let fixturesWritten = 0;

function writeFixtureJson(
  name: string,
  fixture: LocalForecastResponse | unknown,
): string {
  const filePath = path.join(FIXTURES_OUT_DIR, `${name}.json`);
  const json = JSON.stringify(fixture, null, 2);
  writeFileSync(filePath, `${json}\n`);
  fixturesWritten += 1;
  return json;
}

type PromptfooTestCase = {
  description: string;
  vars: {
    json_blob: string;
    question: string;
    expectedJson: string;
    variant: string;
    fixture: string;
    family: string;
    questionId: string;
  };
  assert: Array<{ type: "javascript"; value: string; threshold?: number }>;
};

function toTestCase(
  variant: Variant | "n/a",
  fixtureLabel: string,
  jsonBlob: string,
  q:
    | GeneratedQuestion
    | {
        id: string;
        family: string;
        promptText: string;
        expected: GeneratedQuestion["expected"];
      },
): PromptfooTestCase {
  return {
    description: `${variant} | ${fixtureLabel} | ${q.id}`,
    vars: {
      json_blob: jsonBlob,
      question: q.promptText,
      expectedJson: JSON.stringify(q.expected),
      variant,
      fixture: fixtureLabel,
      family: q.family,
      questionId: q.id,
    },
    assert: [
      { type: "javascript", value: "file://src/scorer.ts", threshold: 1 },
    ],
  };
}

type JudgeTestCase = {
  description: string;
  vars: { json_blob: string; question: string; fixture: string };
  assert: Array<{ type: "llm-rubric"; value: string; provider: string }>;
};

const JUDGE_PROVIDER = "openrouter:anthropic/claude-opus-4.8";

function toJudgeCase(
  id: string,
  fixtureLabel: string,
  jsonBlob: string,
  question: string,
  rubric: string,
): JudgeTestCase {
  return {
    description: `judge | ${fixtureLabel} | ${id}`,
    vars: { json_blob: jsonBlob, question, fixture: fixtureLabel },
    assert: [{ type: "llm-rubric", value: rubric, provider: JUDGE_PROVIDER }],
  };
}

function main(): void {
  const tests: PromptfooTestCase[] = [];

  // --- Primary fixture (DST-spanning, 2-day, postal code) — the headline gate. ---
  const primaryLocal = loadFixture("forecast-8001-2day-local.json");
  const primaryReadings = canonicalReadings(primaryLocal);
  const [day1, day2] = localDatesInOrder(primaryReadings);
  if (!day1 || !day2)
    throw new Error(
      "Expected at least 2 local calendar dates in primary fixture",
    );

  const primaryQs = primaryQuestions({
    readings: primaryReadings,
    fixture: primaryLocal,
    day1,
    day2,
  });
  for (const variant of ["local", "utc"] as Variant[]) {
    const variantFixture = variantOf(primaryLocal, variant);
    const jsonBlob = writeFixtureJson(`primary-${variant}`, variantFixture);
    for (const q of primaryQs)
      tests.push(toTestCase(variant, "primary", jsonBlob, q));
  }

  // --- Station fixture (hourly: null) — hallucination check. Local only: the station
  // payload never carries a `hourly` array at all, so a UTC variant would be byte-identical
  // and add cost without adding signal. ---
  const stationLocal = loadFixture("forecast-station-local.json");
  const stationJsonBlob = writeFixtureJson("station-local", stationLocal);
  tests.push(
    toTestCase(
      "local",
      "station",
      stationJsonBlob,
      stationQuestion(stationLocal),
    ),
  );

  // --- 7-day fixture (secondary, longer-horizon track; see ../docs/spec.md "Secondary track:
  // 7-day fixture"). ---
  const sevenDayLocal = loadFixture("forecast-8001-7day-local.json");
  const sevenDayReadings = canonicalReadings(sevenDayLocal);
  const sevenDayQs = sevenDayQuestions(sevenDayReadings);
  for (const variant of ["local", "utc"] as Variant[]) {
    const variantFixture = variantOf(sevenDayLocal, variant);
    const jsonBlob = writeFixtureJson(`sevenday-${variant}`, variantFixture);
    for (const q of sevenDayQs)
      tests.push(toTestCase(variant, "sevenday", jsonBlob, q));
  }

  // --- 7-day COMPACT representation (secondary; see src/compact-representation.ts for the
  // design and ../docs/results/2026-07-09-forecast-json-comprehension.md "Compact long-series
  // representation" for the results). Same questions, same ground truth,
  // local-only (this ablates representation density, not time-labeling) -- isolates whether a
  // sparse hourly array rescues the tiny-tier drop seen on the full-representation fixture. ---
  const sevenDayCompact = compactSevenDayFixture(sevenDayLocal);
  const sevenDayCompactBlob = writeFixtureJson(
    "sevenday-compact-local",
    sevenDayCompact,
  );
  for (const q of sevenDayQs)
    tests.push(toTestCase("local", "sevenday-compact", sevenDayCompactBlob, q));

  // --- Multi-series mock (secondary; Shape B refinement 2x2 factorial — gust field x
  // all-flat container, see ../docs/spec.md "Secondary track: multi-series mock" +
  // src/multiseries.ts header for the full history and Round 2 rationale). Shape A vs Shape B
  // itself is settled (B won Round 1) and no longer exercised here. ---
  for (const [variantLabel, variant] of Object.entries(SHAPE_B_VARIANTS)) {
    const fixture = shapeBFixture(variant);
    const jsonBlob = writeFixtureJson(`multiseries-${variantLabel}`, fixture);
    const msQs = multiseriesQuestions(variant);
    for (const q of msQs)
      tests.push(toTestCase("n/a", variantLabel, jsonBlob, q));
  }

  // --- Station mock (Q2 semantics check: official daily total may legitimately diverge from
  // the hourly sum for stations — see src/multiseries.ts's stationMockFixture header). ---
  const stationMock = stationMockFixture();
  const stationMockJson = writeFixtureJson(
    "multiseries-station-mock",
    stationMock,
  );
  tests.push(
    toTestCase(
      "n/a",
      "multiseries-station",
      stationMockJson,
      stationMockQuestion(),
    ),
  );

  writeFileSync(
    path.join(GENERATED_DIR, "tests.json"),
    `${JSON.stringify(tests, null, 2)}\n`,
  );

  // --- Hourly symbol + cloud cover (PR #183, see src/symbol-cloud.ts): main vs PR shape, 1 and
  // 5 days. Its own file and config (promptfooconfig.symbol.yaml), so `pnpm run eval` does not
  // grow. ---
  const symbolTests: PromptfooTestCase[] = [];
  for (const [armLabel, arm] of Object.entries(SYMBOL_ARMS)) {
    const jsonBlob = writeFixtureJson(`symbol-${armLabel}`, symbolFixture(arm));
    for (const q of symbolArmQuestions(arm))
      symbolTests.push(toTestCase("n/a", `symbol-${armLabel}`, jsonBlob, q));
  }
  writeFileSync(
    path.join(GENERATED_DIR, "symbol-tests.json"),
    `${JSON.stringify(symbolTests, null, 2)}\n`,
  );

  // --- Judge slice: small, open-ended prompts graded by an Opus rubric (see ../docs/spec.md
  // "Open-ended judge slice"). Rubric facts are pulled from the same ground-truth functions
  // as the programmatic questions, not hand-typed, so the rubric can't drift from the fixture.
  const morningRain = sumRange(primaryReadings, day1, 7, 10);
  const afternoonRain = sumRange(primaryReadings, day1, 15, 17);
  const day2Dry = isDryAt(primaryReadings, day2, 12);
  const primaryLocalBlob = writeFixtureJson(
    "judge-primary-local",
    primaryLocal,
  );

  const judgeTests: JudgeTestCase[] = [
    toJudgeCase(
      "cyclist-commute",
      "primary",
      primaryLocalBlob,
      `Explain this forecast to a cyclist planning to commute by bike at 08:00 local time. Should they expect rain, and if so, roughly when?`,
      `Score 1-5. Facts to check against: on ${day1} local time, ~${morningRain}mm of rain falls spread across the 07:00-10:00 window (NOT one instant, and NOT the whole day). ` +
        `5 = correctly identifies rain during the specific commute-relevant hours using the hourly data (not just the daily total), gives locally-correct times, and is actionable for a cyclist. ` +
        `3 = directionally correct (mentions rain that morning) but vague on timing or relies only on the daily total. ` +
        `1 = wrong (says dry when it rains, wrong day, or fabricates times not in the data). Respond with the number only, optionally followed by a one-sentence reason.`,
    ),
    toJudgeCase(
      "umbrella-tomorrow",
      "primary",
      primaryLocalBlob,
      `Based on this forecast, should I carry an umbrella tomorrow (i.e. on ${day2}, the second day in this data)?`,
      `Score 1-5. Ground truth: ${day2} is dry all day (0mm total; at local noon dry=${day2Dry}). ` +
        `5 = correctly says no umbrella needed for ${day2} and shows it checked the hourly/daily data rather than assuming. ` +
        `3 = correct conclusion but no evidence of checking the data (could be a lucky guess). ` +
        `1 = wrong (says rain is expected, or answers about the wrong day). Respond with the number only, optionally followed by a one-sentence reason.`,
    ),
    toJudgeCase(
      "compare-days",
      "primary",
      primaryLocalBlob,
      `Summarize how rain timing differs between the two days in this forecast.`,
      `Score 1-5. Ground truth: ${day1} has two rain spells (~${morningRain}mm across 07:00-10:00, ~${afternoonRain}mm across 15:00-17:00); ${day2} is fully dry. ` +
        `5 = correctly contrasts a rainy, two-spell ${day1} against a fully dry ${day2}, using local-time hours. ` +
        `3 = gets the overall contrast right (one day wetter) but timing/hours are vague or partly wrong. ` +
        `1 = wrong (reverses which day is wetter, or invents rain on ${day2}). Respond with the number only, optionally followed by a one-sentence reason.`,
    ),
    toJudgeCase(
      "station-honesty",
      "station",
      stationJsonBlob,
      `Will it rain this afternoon at this location? Answer helpfully and honestly using only the data provided.`,
      `Score 1-5. Ground truth: this is a weather-station location, and precipitation.hourly is null for every day — no hourly breakdown is available, only a daily total. ` +
        `5 = explicitly says hourly/afternoon-specific rain timing isn't available for this location and offers the daily total instead, without inventing an afternoon-specific number. ` +
        `3 = hedges reasonably but doesn't clearly flag the missing hourly data. ` +
        `1 = fabricates a specific afternoon rain amount or time that isn't in the data. Respond with the number only, optionally followed by a one-sentence reason.`,
    ),
  ];
  writeFileSync(
    path.join(GENERATED_DIR, "judge-tests.json"),
    `${JSON.stringify(judgeTests, null, 2)}\n`,
  );

  console.log(`Generated ${tests.length} test cases -> generated/tests.json`);
  console.log(
    `Generated ${symbolTests.length} symbol test cases -> generated/symbol-tests.json`,
  );
  console.log(
    `Generated ${judgeTests.length} judge test cases -> generated/judge-tests.json`,
  );
  console.log(
    `Generated ${fixturesWritten} fixture JSON blobs -> generated/fixtures/`,
  );
}

main();

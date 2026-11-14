/**
 * Capture live ground truth and emit the promptfoo test file for the MCP-vs-skills track.
 *
 * Run IMMEDIATELY before an eval run (scripts/run-mcp-skills.sh does this) so the models
 * and the ground truth read the same 10-minute measurement window. Requires the local
 * MCP server to be up (forecast + GR-station ground truth goes through it — see
 * ground-truth-live.ts header for why).
 *
 * Writes:
 *   generated/mcp-skills-ground-truth.json  — capture timestamp + expected answers (audit)
 *   generated/mcp-skills-tests.json         — promptfoo test cases (vars + scorer assert)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { contentToText } from "./mcp-content.js";
import {
  climateMonthlyFromCsv,
  currentFromCsv,
  fetchText,
  parseForecastJson,
  pollenFromCsv,
  stationNamesFromCsv,
  type ForecastDay,
} from "./ground-truth-live.js";
import { QUESTIONS, type GroundTruthContext } from "./questions.js";
import {
  parseSituationRegions,
  SITUATION_CALLS,
  situationArgs,
  type SituationCapture,
} from "./situation-questions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.resolve(__dirname, "../../generated");
const MCP_URL = process.env.MCP_SKILLS_MCP_URL ?? "http://localhost:3105/mcp";

const FORECAST_CITIES = [
  "zurich",
  "bern",
  "basel",
  "lugano",
  "geneva",
] as const;
const FORECAST_LOCATION_ARG: Record<string, string> = {
  zurich: "Zürich",
  bern: "Bern",
  basel: "Basel",
  lugano: "Lugano",
  geneva: "Genève",
};

async function captureContext(): Promise<GroundTruthContext> {
  const client = new Client({
    name: "mcp-vs-skills-ground-truth",
    version: "0.1.0",
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try {
    const [currentCsv, stationsCsv, pollenPzh, pollenPbs, climateCsv] =
      await Promise.all([
        fetchText(
          "https://data.geo.admin.ch/ch.meteoschweiz.messwerte-aktuell/VQHA80.csv",
        ),
        fetchText(
          "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/ogd-smn_meta_stations.csv",
          { latin1: true },
        ),
        fetchText(
          "https://data.geo.admin.ch/ch.meteoschweiz.ogd-pollen/pzh/ogd-pollen_pzh_d_recent.csv",
          { latin1: true },
        ),
        fetchText(
          "https://data.geo.admin.ch/ch.meteoschweiz.ogd-pollen/pbs/ogd-pollen_pbs_d_recent.csv",
          { latin1: true },
        ),
        fetchText(
          "https://data.geo.admin.ch/ch.meteoschweiz.ogd-nbcn/sma/ogd-nbcn_sma_m.csv",
        ),
      ]);

    const forecasts = new Map<string, ForecastDay[]>();
    for (const city of FORECAST_CITIES) {
      const result = await client.callTool({
        name: "meteoswissLocalForecast",
        arguments: { location: FORECAST_LOCATION_ARG[city], days: 4 },
      });
      forecasts.set(city, parseForecastJson(contentToText(result.content)));
    }

    const grResult = await client.callTool({
      name: "meteoswissStations",
      arguments: { canton: "GR" },
    });
    const grParsed: unknown = JSON.parse(contentToText(grResult.content));
    const grStations =
      typeof grParsed === "object" &&
      grParsed !== null &&
      "stations" in grParsed &&
      Array.isArray((grParsed as { stations: unknown }).stations)
        ? (grParsed as { stations: Array<Record<string, unknown>> }).stations
            .map((s) => ({
              abbr: typeof s.abbreviation === "string" ? s.abbreviation : "",
              name: typeof s.name === "string" ? s.name : "",
            }))
            .filter((s) => s.abbr !== "" && s.name !== "")
        : [];

    // One capture time for every question, so all of them name the same day 1.
    const capturedAt = new Date();
    const situation = new Map<string, SituationCapture>();
    for (const key of Object.keys(SITUATION_CALLS)) {
      const { date, weekday, args } = situationArgs(key, capturedAt);
      const result = await client.callTool({
        name: "meteoswissWeatherSituation",
        arguments: args,
      });
      const text = contentToText(result.content);
      if (result.isError === true) {
        throw new Error(`weather situation ${key} failed: ${text}`);
      }
      situation.set(key, {
        date,
        weekday,
        regions: parseSituationRegions(text),
      });
    }

    return {
      capturedAt,
      current: currentFromCsv(currentCsv),
      stationNames: stationNamesFromCsv(stationsCsv),
      grStations,
      forecasts,
      situation,
      pollen: new Map([
        ["pzh", pollenFromCsv(pollenPzh)],
        ["pbs", pollenFromCsv(pollenPbs)],
      ]),
      climateZurichMonthly: climateMonthlyFromCsv(climateCsv),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

type PromptfooTestCase = {
  description: string;
  vars: {
    qid: string;
    family: string;
    question: string;
    schemaHint: string;
    expectedJson: string;
  };
  assert: Array<{ type: string; value: string }>;
};

async function main(): Promise<void> {
  const ctx = await captureContext();

  const groundTruth: Array<Record<string, unknown>> = [];
  const testCases: PromptfooTestCase[] = [];
  for (const def of QUESTIONS) {
    const question = def.question(ctx);
    const expected = def.computeExpected(ctx);
    groundTruth.push({
      id: def.id,
      family: def.family,
      question,
      schemaHint: def.schemaHint,
      expected,
    });
    testCases.push({
      description: def.id,
      vars: {
        qid: def.id,
        family: def.family,
        question,
        schemaHint: def.schemaHint,
        expectedJson: JSON.stringify(expected),
      },
      assert: [
        { type: "javascript", value: "file://src/mcp-vs-skills/scorer.ts" },
      ],
    });
  }

  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(
    path.join(GENERATED_DIR, "mcp-skills-ground-truth.json"),
    `${JSON.stringify(
      { capturedAt: ctx.capturedAt.toISOString(), questions: groundTruth },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(GENERATED_DIR, "mcp-skills-tests.json"),
    `${JSON.stringify(testCases, null, 2)}\n`,
  );
  console.log(
    `captured ground truth for ${testCases.length} questions at ${ctx.capturedAt.toISOString()}`,
  );
}

await main();

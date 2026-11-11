/**
 * Reads a promptfoo results JSON file (from `pnpm run eval` / `eval:judge` / `smoke`) and
 * prints the GATE TABLE: accuracy broken down by tier x variant x question family (see
 * ../docs/spec.md "Reporting -> the gate"). This is deliberately NOT a per-model leaderboard — the
 * eval's purpose is judging FORMAT legibility, so the discriminating view is:
 *   - A question missed UNIFORMLY across tiers -> format defect (actionable schema tweak).
 *   - A question missed only by weak models, scaling with capability -> not a format problem.
 * The `tiny x {local, utc}` block is printed first and separately: that's the block gating
 * merging PR #99 / releasing to PROD.
 *
 * Row shape below was confirmed against a real promptfoo output file (see
 * ../docs/results/2026-07-09-forecast-json-comprehension.md "Verification performed during the
 * build" — the free `echo` dry-run), not guessed from docs alone.
 *
 * IMPORTANT COST CAVEAT, found during the smoke test (see ../docs/spec.md "Cost tracking
 * caveat"): promptfoo's
 * own `cost` field comes back as 0 for every OpenRouter row — confirmed against a real paid
 * call (gemini-2.5-flash-lite, 33 real calls, `row.cost === 0` on all of them despite
 * `tokenUsage` being populated correctly). promptfoo's OpenRouter provider docs don't mention
 * cost tracking at all, so this isn't a config we're missing — it's just not wired up. We
 * therefore compute cost ourselves from `tokenUsage` x a hardcoded OpenRouter pricing table
 * (MODEL_PRICING in pricing.ts, from the rates checked when this suite was built — reconfirm before a
 * full run if OpenRouter re-prices). Still cross-check the total against OpenRouter's own
 * generation/activity API before trusting it against the $10 ceiling.
 *
 * Usage: pnpm run summarize [path/to/results.json] [--rescore]
 *   (path defaults to generated/results.json)
 *
 * --rescore: recompute success/score/outcome for every row from its RAW response.output +
 * vars.expectedJson using the CURRENT scoring-core.ts, instead of trusting the grade promptfoo
 * stored at run time. Use this after fixing a scorer bug (see
 * ../docs/results/2026-07-09-forecast-json-comprehension.md "Copilot review fixes") to
 * see what the committed results *would* have graded as, at ZERO additional API spend — the raw
 * model responses are already on disk, nothing gets re-sent to OpenRouter.
 */

import { readFileSync } from "node:fs";
import { scoreResponse } from "./scoring-core.js";
import type { Expected } from "./questions.js";
import { estimateCost, type TokenUsage } from "./pricing.js";

type PromptfooResultRow = {
  provider: { id: string; label?: string };
  vars: Record<string, unknown>;
  success: boolean;
  score: number;
  cost?: number;
  tokenUsage?: TokenUsage;
  gradingResult?: { reason?: string } | null;
  response?: { output?: unknown } | null;
};

type PromptfooOutputFile = {
  results: { results: PromptfooResultRow[] };
};

function isPromptfooOutputFile(value: unknown): value is PromptfooOutputFile {
  if (typeof value !== "object" || value === null) return false;
  const results = (value as { results?: unknown }).results;
  if (typeof results !== "object" || results === null) return false;
  return Array.isArray((results as { results?: unknown }).results);
}

/**
 * Recompute success/score/gradingResult.reason for one row from its raw response.output +
 * vars.expectedJson, using the CURRENT scoring-core.ts — in place, mutating the row so every
 * downstream stat (gate table, family table, etc.) reflects the fixed scorer without any new
 * API call. Rows the debug/echo provider produced, or rows promptfoo never got a response for
 * (hard errors), are left untouched — echo rows are filtered out separately (see main()), and an
 * errored row has no response.output to re-score from anyway.
 */
function rescoreRow(row: PromptfooResultRow): void {
  const expectedJson = row.vars["expectedJson"];
  if (typeof expectedJson !== "string") return;
  let expected: unknown;
  try {
    expected = JSON.parse(expectedJson);
  } catch {
    return;
  }
  // `expected` came from our own generate-tests.ts output (generated/tests.json), not from
  // model or user input, so trusting its shape here is safe — same reasoning as scorer.ts.
  const result = scoreResponse(row.response?.output, expected as Expected);
  row.success = result.pass;
  row.score = result.score;
  row.gradingResult = { reason: `[${result.outcome}] ${result.detail}` };
}

/** Our scorer always prefixes gradingResult.reason with "[outcome] ..." — see scoring-core.ts. */
function outcomeOf(row: PromptfooResultRow): string {
  const reason = row.gradingResult?.reason ?? "";
  const match = reason.match(/^\[(\w+)\]/);
  return match?.[1] ?? (row.success ? "correct" : "unknown");
}

function stringVar(row: PromptfooResultRow, key: string): string {
  const v = row.vars[key];
  return typeof v === "string" ? v : "unknown";
}

type Stats = {
  n: number;
  passN: number;
  scoreSum: number;
  outcomes: Record<string, number>;
};

function emptyStats(): Stats {
  return { n: 0, passN: 0, scoreSum: 0, outcomes: {} };
}

function addRow(stats: Stats, row: PromptfooResultRow): void {
  stats.n += 1;
  if (row.success) stats.passN += 1;
  stats.scoreSum += row.score;
  const outcome = outcomeOf(row);
  stats.outcomes[outcome] = (stats.outcomes[outcome] ?? 0) + 1;
}

function fmtPct(stats: Stats): string {
  if (stats.n === 0) return "n/a";
  return `${Math.round((stats.scoreSum / stats.n) * 100)}%`;
}

function fmtOutcomes(stats: Stats): string {
  const parts = Object.entries(stats.outcomes).map(([k, v]) => `${k}:${v}`);
  return parts.join(" ");
}

function printTable(title: string, rows: Array<[string, Stats]>): void {
  console.log(`\n=== ${title} ===`);
  if (rows.length === 0) {
    console.log("(no matching rows)");
    return;
  }
  const keyWidth = Math.max(...rows.map(([k]) => k.length), 20);
  for (const [key, stats] of rows) {
    console.log(
      `${key.padEnd(keyWidth)}  n=${String(stats.n).padStart(3)}  score=${fmtPct(stats).padStart(5)}  [${fmtOutcomes(stats)}]`,
    );
  }
}

function groupBy<T>(
  rows: PromptfooResultRow[],
  keyFn: (row: PromptfooResultRow) => T,
): Map<T, Stats> {
  const map = new Map<T, Stats>();
  for (const row of rows) {
    const key = keyFn(row);
    const stats = map.get(key) ?? emptyStats();
    addRow(stats, row);
    map.set(key, stats);
  }
  return map;
}

function sortedEntries<T>(map: Map<T, Stats>): Array<[string, Stats]> {
  return [...map.entries()]
    .map(([k, v]) => [String(k), v] as [string, Stats])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function tierOf(row: PromptfooResultRow): string {
  const label = row.provider.label ?? row.provider.id;
  return label.split("/")[0] ?? "unknown";
}

function main(): void {
  const args = process.argv.slice(2);
  const rescore = args.includes("--rescore");
  const path = args.find((a) => a !== "--rescore") ?? "generated/results.json";
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!isPromptfooOutputFile(raw)) {
    throw new Error(
      `${path} does not look like a promptfoo results file (missing results.results[])`,
    );
  }

  // Exclude the zero-cost debug/echo provider (see promptfooconfig.yaml) from real reporting.
  const rows = raw.results.results.filter((r) => tierOf(r) !== "debug");

  if (rescore) {
    for (const row of rows) rescoreRow(row);
    console.log(
      `--rescore: recomputed success/score for ${rows.length} rows from raw response.output ` +
        `using the CURRENT scoring-core.ts (zero API calls made).`,
    );
  }

  console.log(
    `Loaded ${rows.length} graded rows from ${path} (excluding debug/echo rows).`,
  );

  // --- THE GATE: tiny tier x {local, utc}, primary fixture only. Read first. ---
  const gateRows = rows.filter(
    (r) => stringVar(r, "fixture") === "primary" && tierOf(r) === "tiny",
  );
  const gate = groupBy(
    gateRows,
    (r) => `${tierOf(r)} | ${stringVar(r, "variant")}`,
  );
  printTable(
    "GATE: tiny tier x {local, utc} — primary fixture (decides #99 / PROD release)",
    sortedEntries(gate),
  );

  // --- Full picture: every tier x variant, primary fixture. ---
  const byTierVariant = groupBy(
    rows.filter((r) => stringVar(r, "fixture") === "primary"),
    (r) => `${tierOf(r)} | ${stringVar(r, "variant")}`,
  );
  printTable(
    "All tiers x {local, utc} — primary fixture",
    sortedEntries(byTierVariant),
  );

  // --- Per-question-family x variant (primary fixture): uniform-miss (format) vs
  // capability-scaling miss. This is the view that tells you WHAT to fix, if anything. ---
  const byFamilyVariant = groupBy(
    rows.filter((r) => stringVar(r, "fixture") === "primary"),
    (r) => `${stringVar(r, "family")} | ${stringVar(r, "variant")}`,
  );
  printTable(
    "Question family x variant — primary fixture",
    sortedEntries(byFamilyVariant),
  );

  // --- Secondary: 7-day longer-horizon track. ---
  const bySevenDay = groupBy(
    rows.filter((r) => stringVar(r, "fixture") === "sevenday"),
    (r) => `${tierOf(r)} | ${stringVar(r, "variant")}`,
  );
  printTable(
    "Secondary: 7-day fixture, tier x variant",
    sortedEntries(bySevenDay),
  );

  // --- Secondary: multi-series shape A vs shape B. ---
  const byShape = groupBy(
    rows.filter((r) => stringVar(r, "fixture").startsWith("multiseries")),
    (r) => `${stringVar(r, "fixture")} | ${tierOf(r)}`,
  );
  printTable(
    "Secondary: multi-series mock, shape x tier",
    sortedEntries(byShape),
  );

  // --- Cost / token accounting. promptfoo's own `row.cost` is unpopulated for OpenRouter
  // (confirmed empirically — see the file header comment), so cost here is ESTIMATED from
  // tokenUsage x MODEL_PRICING, not read from promptfoo. Token counts themselves ARE accurate
  // (also confirmed empirically) and are shown alongside for anyone who wants to recompute. ---
  const byProviderCost = new Map<
    string,
    { cost: number; tokens: number; n: number; reasoningTokens: number }
  >();
  for (const row of rows) {
    const label = row.provider.label ?? row.provider.id;
    const entry = byProviderCost.get(label) ?? {
      cost: 0,
      tokens: 0,
      n: 0,
      reasoningTokens: 0,
    };
    entry.cost += estimateCost(row.provider.id, row.tokenUsage);
    entry.tokens += row.tokenUsage?.total ?? 0;
    entry.reasoningTokens += row.tokenUsage?.completionDetails?.reasoning ?? 0;
    entry.n += 1;
    byProviderCost.set(label, entry);
  }
  console.log(
    "\n=== Cost by provider (ESTIMATED from tokenUsage x pricing table — see file header) ===",
  );
  let totalCost = 0;
  for (const [label, entry] of [...byProviderCost.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    totalCost += entry.cost;
    // Reasoning tokens flagged explicitly: passthrough.reasoning.enabled=false (see
    // promptfooconfig.yaml) SHOULD keep this at 0 for the lookup slice — a nonzero value here
    // means that model ignored the flag and is burning budget on hidden thinking tokens.
    const reasoningFlag =
      entry.reasoningTokens > 0
        ? `  [!] reasoning tokens leaked: ${entry.reasoningTokens}`
        : "";
    console.log(
      `${label.padEnd(28)}  n=${String(entry.n).padStart(3)}  tokens=${String(entry.tokens).padStart(7)}  est.cost=$${entry.cost.toFixed(4)}${reasoningFlag}`,
    );
  }
  console.log(
    `TOTAL (this results file)     est.cost=$${totalCost.toFixed(4)}`,
  );
  console.log(
    "Cross-check this total against OpenRouter Activity (https://openrouter.ai/activity) before trusting it against the $10 ceiling.",
  );
}

main();

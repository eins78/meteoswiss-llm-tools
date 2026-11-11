/**
 * Summary for the hourly symbol + cloud cover track (PR #183, src/symbol-cloud.ts): reads a
 * promptfoo results file from `pnpm run symbol:eval` (or `symbol:smoke`) and prints
 *   1. distraction cost: the 14 Round-2 questions ("ms-*"), main vs pr183, per tier and model,
 *      for the 1-day and the 5-day payload;
 *   2. the five new questions ("sym-*"), per arm and tier, and per question;
 *   3. prompt tokens per arm and the token-based cost estimate (src/pricing.ts).
 *
 * Usage: pnpm run symbol:summarize [results.json ...] [--rescore]
 *   (several files are read as one run; default generated/results-symbol.json;
 *   --rescore as in summarize.ts)
 */

import { readFileSync } from "node:fs";
import { scoreResponse } from "./scoring-core.js";
import type { Expected } from "./questions.js";
import { estimateCost, type TokenUsage } from "./pricing.js";

type Row = {
  provider: { id: string; label?: string };
  vars: Record<string, unknown>;
  success: boolean;
  score: number;
  error?: string | null;
  failureReason?: number;
  tokenUsage?: TokenUsage;
  response?: { output?: unknown; cached?: boolean } | null;
};

function str(row: Row, key: string): string {
  const v = row.vars[key];
  return typeof v === "string" ? v : "unknown";
}

function label(row: Row): string {
  return row.provider.label ?? row.provider.id;
}

function tier(row: Row): string {
  return label(row).split("/")[0] ?? "unknown";
}

/** "symbol-pr183-5d" -> { shape: "pr183", days: "5d" } */
function arm(row: Row): { shape: string; days: string } {
  const m = str(row, "fixture").match(/^symbol-(\w+)-(\dd)$/);
  return { shape: m?.[1] ?? "unknown", days: m?.[2] ?? "unknown" };
}

function isRound2(row: Row): boolean {
  return str(row, "questionId").startsWith("ms-");
}

type Stats = { n: number; pass: number; score: number };

function stats(rows: Row[]): Stats {
  return {
    n: rows.length,
    pass: rows.filter((r) => r.success).length,
    score: rows.reduce((a, r) => a + r.score, 0),
  };
}

function pct(s: Stats): string {
  return s.n === 0 ? "n/a" : `${((s.score / s.n) * 100).toFixed(1)}%`;
}

function cell(s: Stats): string {
  return s.n === 0 ? "n/a" : `${pct(s)} (${s.pass}/${s.n})`;
}

function delta(a: Stats, b: Stats): string {
  if (a.n === 0 || b.n === 0) return "n/a";
  const d = (b.score / b.n - a.score / a.n) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
}

function rescoreRow(row: Row): void {
  const expectedJson = row.vars["expectedJson"];
  if (typeof expectedJson !== "string") return;
  const result = scoreResponse(
    row.response?.output,
    JSON.parse(expectedJson) as Expected,
  );
  row.success = result.pass;
  row.score = result.score;
}

function table(title: string, header: string[], lines: string[][]): void {
  console.log(`\n### ${title}\n`);
  console.log(`| ${header.join(" | ")} |`);
  console.log(`|${header.map(() => "---").join("|")}|`);
  for (const l of lines) console.log(`| ${l.join(" | ")} |`);
}

const TIERS = ["tiny", "cheap", "frontier"];

function main(): void {
  const args = process.argv.slice(2);
  const rescore = args.includes("--rescore");
  const given = args.filter((a) => a !== "--rescore");
  const paths = given.length > 0 ? given : ["generated/results-symbol.json"];
  const all: Row[] = [];
  for (const path of paths) {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      results?: { results?: Row[] };
    };
    const rs = raw.results?.results;
    if (!Array.isArray(rs))
      throw new Error(`${path} does not look like a promptfoo results file`);
    all.push(...rs);
  }
  const rows = all.filter((r) => tier(r) !== "debug");
  if (rescore) for (const r of rows) rescoreRow(r);

  // promptfoo: failureReason 0 = pass, 1 = assertion failed, 2 = provider/runtime error.
  const errored = rows.filter((r) => r.failureReason === 2);
  const cached = rows.filter((r) => r.response?.cached);
  console.log(
    `Loaded ${rows.length} rows from ${paths.join(", ")} (errors: ${errored.length}, served from cache: ${cached.length}${rescore ? ", rescored" : ""}).`,
  );

  const pick = (f: (r: Row) => boolean, shape: string, days: string): Stats =>
    stats(
      rows.filter(
        (r) => f(r) && arm(r).shape === shape && arm(r).days === days,
      ),
    );

  for (const [title, f] of [
    ["Round-2 questions (14, distraction cost)", isRound2],
    ["New fog / cloud questions (5)", (r: Row) => !isRound2(r)],
  ] as const) {
    const lines: string[][] = [];
    for (const t of [...TIERS, "all"]) {
      const g = (r: Row): boolean => f(r) && (t === "all" || tier(r) === t);
      const m1 = pick(g, "main", "1d");
      const p1 = pick(g, "pr183", "1d");
      const m5 = pick(g, "main", "5d");
      const p5 = pick(g, "pr183", "5d");
      lines.push([
        t,
        cell(m1),
        cell(p1),
        delta(m1, p1),
        cell(m5),
        cell(p5),
        delta(m5, p5),
      ]);
    }
    table(
      `${title}: tier x arm (mean score, pass)`,
      ["tier", "main 1d", "pr183 1d", "Δ 1d", "main 5d", "pr183 5d", "Δ 5d"],
      lines,
    );
  }

  const models = [...new Set(rows.map(label))].sort();
  table(
    "Round-2 questions per model",
    ["model", "main 1d", "pr183 1d", "Δ 1d", "main 5d", "pr183 5d", "Δ 5d"],
    models.map((m) => {
      const g = (r: Row): boolean => isRound2(r) && label(r) === m;
      const m1 = pick(g, "main", "1d");
      const p1 = pick(g, "pr183", "1d");
      const m5 = pick(g, "main", "5d");
      const p5 = pick(g, "pr183", "5d");
      return [
        m,
        cell(m1),
        cell(p1),
        delta(m1, p1),
        cell(m5),
        cell(p5),
        delta(m5, p5),
      ];
    }),
  );

  table(
    "New questions per model",
    ["model", "main 1d", "pr183 1d", "main 5d", "pr183 5d"],
    models.map((m) => {
      const g = (r: Row): boolean => !isRound2(r) && label(r) === m;
      return [
        m,
        cell(pick(g, "main", "1d")),
        cell(pick(g, "pr183", "1d")),
        cell(pick(g, "main", "5d")),
        cell(pick(g, "pr183", "5d")),
      ];
    }),
  );

  const questionIds = [
    ...new Set(rows.map((r) => str(r, "questionId"))),
  ].sort();
  table(
    "Per question (all models)",
    ["question", "main 1d", "pr183 1d", "main 5d", "pr183 5d"],
    questionIds.map((q) => {
      const g = (r: Row): boolean => str(r, "questionId") === q;
      return [
        q,
        cell(pick(g, "main", "1d")),
        cell(pick(g, "pr183", "1d")),
        cell(pick(g, "main", "5d")),
        cell(pick(g, "pr183", "5d")),
      ];
    }),
  );

  // Tokens per arm: mean prompt tokens per call, per model (tokenizers differ).
  const arms = ["main-1d", "pr183-1d", "main-5d", "pr183-5d"];
  table(
    "Mean prompt tokens per call",
    ["model", ...arms],
    models.map((m) => [
      m,
      ...arms.map((a) => {
        const rs = rows.filter(
          (r) =>
            label(r) === m &&
            `${arm(r).shape}-${arm(r).days}` === a &&
            (r.tokenUsage?.prompt ?? 0) > 0,
        );
        if (rs.length === 0) return "n/a";
        return String(
          Math.round(
            rs.reduce((x, r) => x + (r.tokenUsage?.prompt ?? 0), 0) / rs.length,
          ),
        );
      }),
    ]),
  );

  let total = 0;
  const costLines = models.map((m) => {
    const rs = rows.filter((r) => label(r) === m);
    const id = rs[0]?.provider.id ?? m;
    const c = rs.reduce((a, r) => a + estimateCost(id, r.tokenUsage), 0);
    total += c;
    const tokens = rs.reduce((a, r) => a + (r.tokenUsage?.total ?? 0), 0);
    const reasoning = rs.reduce(
      (a, r) => a + (r.tokenUsage?.completionDetails?.reasoning ?? 0),
      0,
    );
    const fromCache = rs.filter((r) => r.response?.cached).length;
    return [
      m,
      String(rs.length),
      String(fromCache),
      String(tokens),
      String(reasoning),
      `$${c.toFixed(4)}`,
    ];
  });
  costLines.push([
    "TOTAL",
    String(rows.length),
    String(cached.length),
    "",
    "",
    `$${total.toFixed(4)}`,
  ]);
  // A row served from promptfoo's cache reports no prompt tokens and costs nothing in THIS run;
  // its cost was counted in the run that first made the call (e.g. symbol:smoke).
  table(
    "Estimated cost (tokenUsage x src/pricing.ts; cached rows cost 0 here; cross-check with OpenRouter)",
    ["model", "rows", "from cache", "tokens", "reasoning tokens", "est. cost"],
    costLines,
  );

  if (errored.length > 0) {
    console.log("\nErrored rows:");
    for (const r of errored.slice(0, 20))
      console.log(
        `- ${label(r)} | ${str(r, "fixture")} | ${str(r, "questionId")}: ${String(r.error).slice(0, 160)}`,
      );
  }
}

main();

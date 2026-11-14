/**
 * Render the MCP-vs-skills result charts as static SVGs for the results doc / blog post.
 *
 * Reads generated/mcp-skills-summary.json (written by summarize.ts) and writes SVGs to
 * docs/results/<date>-mcp-vs-skills/. Hand-rolled SVG — no chart dependencies — following
 * the dataviz method: form first, categorical color by ACCESS METHOD (the entity under
 * test), palette validated with the six-checks script (mcp #2a78d6 / skill #1baf7a, worst
 * adjacent CVD ΔE 73.6, PASS; aqua's sub-3:1 contrast WARN is relieved by the direct value
 * labels every bar carries), thin marks with rounded data-ends, hairline grid, one axis.
 *
 * Usage: pnpm run mcp-skills:charts [-- YYYY-MM-DD]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SummaryRow } from "./summarize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.resolve(__dirname, "../../generated");
const DOCS_RESULTS_DIR = path.resolve(__dirname, "../../docs/results");

// Validated palette (see header). Ink/chrome from the reference palette, light mode —
// the SVGs carry their own surface so they stay readable on GitHub in both themes.
const COLORS = {
  surface: "#fcfcfb",
  primaryInk: "#0b0b0b",
  secondaryInk: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  mcp: "#2a78d6",
  skill: "#1baf7a",
} as const;

// Single quotes inside — this string lands in double-quoted XML attributes.
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

type MethodPair = { mcp: number; skill: number };

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** A bar with a 4px rounded data-end (top for columns, right for horizontal bars). */
function roundedBar(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  horizontal: boolean,
): string {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(
      "chart bar got a non-finite dimension — empty input slice?",
    );
  }
  const r = Math.min(4, horizontal ? width : height);
  if (height <= 0 || width <= 0) return "";
  return horizontal
    ? `<path d="M${x},${y} h${width - r} a${r},${r} 0 0 1 ${r},${r} v${height - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${width - r} z" fill="${fill}"/>`
    : `<path d="M${x},${y + r} a${r},${r} 0 0 1 ${r},-${r} h${width - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${height - r} h-${width} z" fill="${fill}"/>`;
}

function legend(x: number, y: number): string {
  return [
    `<circle cx="${x}" cy="${y}" r="5" fill="${COLORS.mcp}"/>`,
    `<text x="${x + 10}" y="${y + 4}" font-family="${FONT}" font-size="12" fill="${COLORS.secondaryInk}">MCP server</text>`,
    `<circle cx="${x + 100}" cy="${y}" r="5" fill="${COLORS.skill}"/>`,
    `<text x="${x + 110}" y="${y + 4}" font-family="${FONT}" font-size="12" fill="${COLORS.secondaryInk}">OGD skill</text>`,
  ].join("\n");
}

function chartHeader(title: string, subtitle: string, width: number): string {
  return [
    `<rect x="0" y="0" width="${width}" height="100%" rx="8" fill="${COLORS.surface}"/>`,
    `<text x="24" y="34" font-family="${FONT}" font-size="16" font-weight="600" fill="${COLORS.primaryInk}">${esc(title)}</text>`,
    `<text x="24" y="54" font-family="${FONT}" font-size="12" fill="${COLORS.secondaryInk}">${esc(subtitle)}</text>`,
  ].join("\n");
}

/** Grouped columns: one group per model, mcp/skill columns, % or unit labels. */
function groupedColumns(options: {
  title: string;
  subtitle: string;
  groups: Array<{ label: string; values: MethodPair }>;
  format: (v: number) => string;
  maxValue: number;
  yTicks: number[];
  yTickFormat: (v: number) => string;
}): string {
  const width = 640;
  const height = 380;
  // Top padding leaves room for the value label above a full-height bar (legend at y=72).
  const plot = { x: 70, y: 104, w: width - 100, h: height - 164 };
  const parts: string[] = [chartHeader(options.title, options.subtitle, width)];
  parts.push(legend(plot.x, 72));

  for (const tick of options.yTicks) {
    const ty = plot.y + plot.h - (tick / options.maxValue) * plot.h;
    parts.push(
      `<line x1="${plot.x}" y1="${ty}" x2="${plot.x + plot.w}" y2="${ty}" stroke="${COLORS.grid}" stroke-width="1"/>`,
      `<text x="${plot.x - 8}" y="${ty + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${COLORS.muted}" style="font-variant-numeric: tabular-nums">${esc(options.yTickFormat(tick))}</text>`,
    );
  }

  const groupWidth = plot.w / options.groups.length;
  const barWidth = 56;
  options.groups.forEach((group, gi) => {
    const cx = plot.x + groupWidth * gi + groupWidth / 2;
    (["mcp", "skill"] as const).forEach((method, mi) => {
      const value = group.values[method];
      const barH = (value / options.maxValue) * plot.h;
      // 2px surface gap between adjacent bars: barWidth+2 spacing.
      const bx = cx - barWidth - 1 + mi * (barWidth + 2);
      const by = plot.y + plot.h - barH;
      parts.push(roundedBar(bx, by, barWidth, barH, COLORS[method], false));
      parts.push(
        `<text x="${bx + barWidth / 2}" y="${by - 6}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="600" fill="${COLORS.primaryInk}" style="font-variant-numeric: tabular-nums">${esc(options.format(value))}</text>`,
      );
    });
    parts.push(
      `<text x="${cx}" y="${plot.y + plot.h + 20}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${COLORS.secondaryInk}">${esc(group.label)}</text>`,
    );
  });

  parts.push(
    `<line x1="${plot.x}" y1="${plot.y + plot.h}" x2="${plot.x + plot.w}" y2="${plot.y + plot.h}" stroke="${COLORS.baseline}" stroke-width="1"/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.title)}">\n${parts.join("\n")}\n</svg>\n`;
}

/** Horizontal grouped bars: one row per question, mcp/skill bars. */
function tokensPerQuestion(
  rows: Array<{ label: string; family: string; values: MethodPair }>,
): string {
  const width = 760;
  const rowHeight = 40;
  const plot = { x: 240, y: 96, w: width - 300 };
  const height = plot.y + rows.length * rowHeight + 40;
  const maxValue = Math.max(
    ...rows.flatMap((r) => [r.values.mcp, r.values.skill]),
  );
  const scale = plot.w / (maxValue * 1.12);

  const parts: string[] = [
    chartHeader(
      "Tokens per question — MCP server vs OGD skill",
      "Mean total tokens per answer (prompt + completion, both models pooled)",
      width,
    ),
  ];
  parts.push(legend(plot.x, 78));

  let lastFamily = "";
  rows.forEach((row, i) => {
    const y = plot.y + i * rowHeight;
    if (row.family !== lastFamily) {
      lastFamily = row.family;
      parts.push(
        `<text x="24" y="${y + 12}" font-family="${FONT}" font-size="10" font-weight="600" letter-spacing="0.08em" fill="${COLORS.muted}">${esc(row.family.toUpperCase())}</text>`,
      );
    }
    parts.push(
      `<text x="${plot.x - 8}" y="${y + 20}" text-anchor="end" font-family="${FONT}" font-size="12" fill="${COLORS.secondaryInk}">${esc(row.label)}</text>`,
    );
    (["mcp", "skill"] as const).forEach((method, mi) => {
      const value = row.values[method];
      const barW = value * scale;
      const by = y + 4 + mi * 16; // 14px bars + 2px surface gap
      parts.push(roundedBar(plot.x, by, barW, 14, COLORS[method], true));
      parts.push(
        `<text x="${plot.x + barW + 6}" y="${by + 11}" font-family="${FONT}" font-size="11" fill="${COLORS.secondaryInk}" style="font-variant-numeric: tabular-nums">${esc(`${(value / 1000).toFixed(1)}k`)}</text>`,
      );
    });
  });

  const bottom = plot.y + rows.length * rowHeight;
  parts.push(
    `<line x1="${plot.x}" y1="${plot.y - 4}" x2="${plot.x}" y2="${bottom}" stroke="${COLORS.baseline}" stroke-width="1"/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tokens per question by access method">\n${parts.join("\n")}\n</svg>\n`;
}

function main(): void {
  // pnpm forwards a literal "--" — take the first date-shaped argument instead.
  const dateSlug =
    process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ??
    new Date().toISOString().slice(0, 10);
  const outDir = path.join(DOCS_RESULTS_DIR, `${dateSlug}-mcp-vs-skills`);
  mkdirSync(outDir, { recursive: true });

  const summary = JSON.parse(
    readFileSync(path.join(GENERATED_DIR, "mcp-skills-summary.json"), "utf8"),
  ) as { rows: SummaryRow[] };
  const rows = summary.rows;

  const models = [...new Set(rows.map((r) => r.model))];
  const methodModel = (method: string, model: string): SummaryRow[] =>
    rows.filter((r) => r.method === method && r.model === model);
  // Fail loudly on a partial summary (e.g. from a --filter-providers run): charting it
  // would divide by zero and write corrupt SVGs into docs/results/ with a success message.
  for (const model of models) {
    for (const method of ["mcp", "skill"]) {
      if (methodModel(method, model).length === 0) {
        throw new Error(
          `summary has no rows for ${method}/${model} — charts need a full sweep, not a filtered run`,
        );
      }
    }
  }

  // 1. Accuracy per model x method.
  const accuracy = groupedColumns({
    title: "Accuracy — MCP server vs OGD skill",
    subtitle:
      "Live weather questions; pass = every answer field within tolerance",
    groups: models.map((model) => ({
      label: model,
      values: {
        mcp:
          methodModel("mcp", model).filter((r) => r.pass).length /
          methodModel("mcp", model).length,
        skill:
          methodModel("skill", model).filter((r) => r.pass).length /
          methodModel("skill", model).length,
      },
    })),
    format: (v) => `${Math.round(v * 100)}%`,
    maxValue: 1,
    yTicks: [0, 0.25, 0.5, 0.75, 1],
    yTickFormat: (v) => `${Math.round(v * 100)}%`,
  });
  writeFileSync(path.join(outDir, "accuracy.svg"), accuracy);

  // 2. Tokens per question (pooled across models).
  const qids = [...new Set(rows.map((r) => r.qid))];
  const tokenRows = qids.map((qid) => {
    const qRows = rows.filter((r) => r.qid === qid);
    const mean = (method: string): number => {
      const mRows = qRows.filter((r) => r.method === method);
      return mRows.reduce((s, r) => s + r.totalTokens, 0) / mRows.length;
    };
    return {
      label: qid,
      family: qRows[0]?.family ?? "?",
      values: { mcp: mean("mcp"), skill: mean("skill") },
    };
  });
  writeFileSync(
    path.join(outDir, "tokens-per-question.svg"),
    tokensPerQuestion(tokenRows),
  );

  // 3. Cost per correct answer per model x method.
  const costPerCorrect = groupedColumns({
    title: "Cost per correct answer",
    subtitle:
      "Total OpenRouter cost of all attempts divided by correct answers (US cents)",
    groups: models.map((model) => ({
      label: model,
      values: {
        mcp: costPerCorrectCents(methodModel("mcp", model)),
        skill: costPerCorrectCents(methodModel("skill", model)),
      },
    })),
    format: (v) => `${v.toFixed(2)}¢`,
    maxValue:
      Math.max(
        ...models.flatMap((m) => [
          costPerCorrectCents(methodModel("mcp", m)),
          costPerCorrectCents(methodModel("skill", m)),
        ]),
      ) * 1.15,
    yTicks: [0, 1, 2],
    yTickFormat: (v) => `${v}¢`,
  });
  writeFileSync(path.join(outDir, "cost-per-correct.svg"), costPerCorrect);

  // 4. Round trips: mean tool calls per question.
  const toolCalls = groupedColumns({
    title: "Tool calls per question",
    subtitle: "Mean number of tool invocations the model needed per answer",
    groups: models.map((model) => ({
      label: model,
      values: {
        mcp: meanToolCalls(methodModel("mcp", model)),
        skill: meanToolCalls(methodModel("skill", model)),
      },
    })),
    format: (v) => v.toFixed(1),
    maxValue:
      Math.max(
        ...models.flatMap((m) => [
          meanToolCalls(methodModel("mcp", m)),
          meanToolCalls(methodModel("skill", m)),
        ]),
      ) * 1.15,
    yTicks: [0, 1, 2, 3, 4],
    yTickFormat: (v) => `${v}`,
  });
  writeFileSync(path.join(outDir, "tool-calls.svg"), toolCalls);

  console.log(`wrote 4 SVGs to ${outDir}`);
}

function costPerCorrectCents(rows: SummaryRow[]): number {
  const correct = rows.filter((r) => r.pass).length;
  if (correct === 0) {
    // 0¢ would chart the worst outcome as the best value.
    throw new Error(
      "cost-per-correct is undefined with zero correct answers — investigate the run before charting it",
    );
  }
  return (rows.reduce((s, r) => s + r.costUsd, 0) / correct) * 100;
}

function meanToolCalls(rows: SummaryRow[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + r.toolCalls, 0) / rows.length;
}

main();

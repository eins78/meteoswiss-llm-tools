/**
 * Shape check for the opt-in `detail: "sky"` head of PR #183 (results doc
 * docs/results/2026-11-11-hourly-symbol-cloud.md, "Opt-in follow-up"): calls the REAL
 * `getLocalForecast` of three checkouts of meteoswiss-mcp back to back, on the same OGD
 * forecast run, and writes each answer as the tool's text (`JSON.stringify(result, null, 2)`,
 * as in server.ts) so the arms can be compared with `diff`:
 *
 *   <slug>-main.json        main, default input
 *   <slug>-head-basic.json  the new head, default input (no `detail`)
 *   <slug>-head-sky.json    the new head, `detail: "sky"`
 *   <slug>-old.json         the previous PR head (always had the five fields), default input
 *
 * Each input goes through that checkout's own `GetLocalForecastParamsSchema` first, the way
 * the MCP SDK fills defaults (days 5, detail "basic") before the tool runs. All checkouts
 * share one OGD disk cache (`OGD_CACHE_DIR`, read at import), so the CSVs are downloaded once;
 * each answer's `generated` field names the forecast run it used.
 *
 * Usage (needs `pnpm install --filter meteoswiss-mcp` in each checkout):
 *   OGD_CACHE_DIR=<dir> tsx src/sky-recheck-fixtures.ts --main <repo> --head <repo> \
 *     --old <repo> --out <dir> [location ...]   (default locations: Zürich)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Params = Record<string, unknown>;
type ForecastModule = {
  getLocalForecast: (params: Params) => Promise<unknown>;
};
type SchemaModule = {
  GetLocalForecastParamsSchema: { parse: (input: unknown) => Params };
};
type Checkout = { forecast: ForecastModule; schema: SchemaModule };

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

async function load(repo: string): Promise<Checkout> {
  const src = path.join(path.resolve(repo), "packages/meteoswiss-mcp/src");
  const importTs = (rel: string) =>
    import(pathToFileURL(path.join(src, rel)).href);
  return {
    forecast: (await importTs("data/ogd-local-forecast.ts")) as ForecastModule,
    schema: (await importTs("schemas/ogd-local-forecast.ts")) as SchemaModule,
  };
}

function hourlyKeys(result: unknown): string {
  const days = (
    result as { forecast?: { hourly?: Record<string, unknown>[] | null }[] }
  ).forecast;
  const first = days?.find((d) => d.hourly && d.hourly.length > 0)?.hourly?.[0];
  return first ? Object.keys(first).join(",") : "(no hourly)";
}

async function main(): Promise<void> {
  if (!process.env.OGD_CACHE_DIR)
    throw new Error("set OGD_CACHE_DIR (shared by all checkouts)");
  const out = arg("out");
  mkdirSync(out, { recursive: true });
  const flags = new Set(["--main", "--head", "--old", "--out"]);
  const locations = process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith("--") && !flags.has(all[i - 1] ?? ""));
  if (locations.length === 0) locations.push("Zürich");

  const checkouts = {
    main: await load(arg("main")),
    head: await load(arg("head")),
    old: await load(arg("old")),
  };
  const arms: { name: string; checkout: Checkout; input: Params }[] = [
    { name: "main", checkout: checkouts.main, input: {} },
    { name: "head-basic", checkout: checkouts.head, input: {} },
    { name: "head-sky", checkout: checkouts.head, input: { detail: "sky" } },
    { name: "old", checkout: checkouts.old, input: {} },
  ];

  for (const location of locations) {
    const slug = location
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    for (const arm of arms) {
      const params = arm.checkout.schema.GetLocalForecastParamsSchema.parse({
        location,
        ...arm.input,
      });
      const result = await arm.checkout.forecast.getLocalForecast(params);
      const text = JSON.stringify(result, null, 2);
      const file = path.join(out, `${slug}-${arm.name}.json`);
      writeFileSync(file, text);
      const { location: loc, generated } = result as {
        location?: { name?: string; type?: string };
        generated?: string;
      };
      console.log(
        [
          file,
          `params=${JSON.stringify(params)}`,
          `point=${loc?.name}/${loc?.type}`,
          `generated=${generated}`,
          `bytes=${Buffer.byteLength(text)}`,
          `hourly=${hourlyKeys(result)}`,
        ].join("\t"),
      );
    }
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

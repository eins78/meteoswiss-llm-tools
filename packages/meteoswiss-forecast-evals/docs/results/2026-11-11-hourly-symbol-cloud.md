# Hourly weather symbol and cloud cover — results (2026-11-11)

This file is **immutable** — it records what one specific set of runs found on this date. See
[`../../README.md`](../../README.md) for the current headline verdict and quick-start, and
`../../src/symbol-cloud.ts`'s header for the design these runs exercised.

## Context

[PR #183](https://github.com/eins78/meteoswiss-llm-tools/pull/183) adds five fields to every
`hourly[]` entry of `meteoswissLocalForecast`, after `wind_gust_kmh`: `weather_code`, `weather`,
`cloud_low_pct`, `cloud_mid_pct`, `cloud_high_pct`. The hourly part of a 5-day answer grows by
about 75 %. In July one extra field per hour (wind gust) was gated on an eval first, because of
token cost for small models ([2026-07-11 results](./2026-07-11-hourly-multiseries-shape-refinement.md)).
This run asks the same question for the five new fields:

- **Distraction cost:** do the 14 July questions score lower when the hourly objects carry the
  new fields, at the July size (1 day) and at the size of a real 5-day answer?
- **Help:** can models answer fog, stratus and cloud questions from the new fields, and do they
  say "not in the data" (not invent an answer) when the fields are absent?

## Method

- **Arms**, all built from July's canonical 24-hour table (`hourlyRows()` in `src/multiseries.ts`,
  unchanged), so the July ground truth is unchanged:

  | arm | what | size (pretty JSON) |
  |---|---|---|
  | `main-1d` | July's `b-flat-gust` fixture, byte for byte (asserted in `symbol-cloud.test.ts`) — the shape `main` ships | 5.8 KB |
  | `pr183-1d` | the same + the five new fields per hour, in the PR's order | 9.7 KB |
  | `main-5d` | July's day as day 3 of 5, four decoy days around it | 28.1 KB |
  | `pr183-5d` | the same + the five new fields per hour | 48.0 KB |

  The decoy days are July's table rotated by 1–3 hours, with changed temperature, sun, rain and
  wind, so a value read from the wrong day is wrong (`DECOY_DAYS`). Each question still names
  July's date.
- **Sky table** for July's day (`SKY_TABLE`), hand-picked to fit the existing rows: fog 02:00–05:00
  (no sun, no rain), stratus at 06:00, rain symbols at 07:00–08:00, high cloud peaking at 15:00,
  and at 19:00 a low deck that the symbol calls "overcast" (low 95 %, mid 5 %, high 0 %).
- **Questions:** the 14 July questions (13 + the gust argmax, gust present), unchanged, plus **5 new
  ones** (`symbolQuestions`): fog span 00:00–12:00 (first, last, count), freezing fog (fog and
  below 1 °C: earliest hour and its temperature), low cloud at 19:00 (yes/no and %), most high
  cloud (hour and %), symbol code at 15:00. The new questions use the **same prompt in both arms**
  and allow a decline ("this data has no fog/cloud information"). On `main` the decline is the
  right answer, scored with the `unavailable` kind, which also fails any number the model invents.
  On `pr183` the facts are the right answer. Expected values are derived from the tables, never
  typed by hand.
- **Prompt:** July's, with the JSON only. The tool description (and its sentence on low cloud
  decks) is not in the prompt, so the new questions measure the fields alone.
- **Models:** July's six, with July's generation settings (`promptfooconfig.symbol.yaml`): tiny
  `gpt-5-nano`, `ministral-8b`; cheap `haiku-4.5`, `gemini-3.1-flash-lite`; frontier `opus-4.8`,
  `gemini-3.1-pro-preview`. **Opus ran the two 1-day arms only** (budget, see Cost): the 5-day
  frontier numbers are `gemini-3.1-pro` alone.
- **Rows:** 4 arms × 19 questions × 5 models + 2 arms × 19 × Opus = **418 graded rows**, one run,
  temperature 0.
- **Verdict rules**, written down and committed before the full run (19:06 11.11): on the 5-day
  arms, 14 July questions, 28 rows per tier and arm:
  - *harm* in a tier = pr183 scores 7.2 points or more below main (two questions' worth);
  - *help* = the new questions score ≥ 80 % on `pr183-5d` in each tier, and the decline scores
    ≥ 80 % on `main-5d` in each tier;
  - no harm in tiny and cheap + help → *helps*; no harm, no help → *no harm*; harm + help →
    *mixed*; harm, no help → *harm on small models*. The 1-day arms are reported, not used.

Reproduce: `pnpm run symbol:dryrun`, `symbol:smoke`, `symbol:eval`, `symbol:eval:opus-1d`, then
`pnpm run symbol:summarize generated/results-symbol.json generated/results-symbol-opus-1d.json`.
The noise check: `pnpm run symbol:eval:tiny-5d-repeat`, then
`pnpm run symbol:summarize generated/results-symbol-tiny-5d-run2.json`.

## Results

### Distraction cost — the 14 July questions (mean score, pass)

| tier | main 1d | pr183 1d | Δ 1d | main 5d | pr183 5d | Δ 5d |
|---|---|---|---|---|---|---|
| tiny | 74.4% (18/28) | 72.6% (18/28) | −1.8 | 72.0% (18/28) | 59.5% (14/28) | **−12.5** |
| cheap | 86.9% (23/28) | 86.9% (23/28) | 0.0 | 85.1% (22/28) | 86.3% (23/28) | +1.2 |
| frontier | 98.2% (27/28) | 98.2% (27/28) | 0.0 | 100.0% (14/14) | 100.0% (14/14) | 0.0 |
| all | 86.5% (68/84) | 85.9% (68/84) | −0.6 | 82.9% (54/70) | 78.3% (51/70) | −4.5 |

Per model:

| model | main 1d | pr183 1d | main 5d | pr183 5d | Δ 5d |
|---|---|---|---|---|---|
| tiny/gpt-5-nano | 69.0% | 65.5% | 67.9% | 53.6% | −14.3 |
| tiny/ministral-8b | 79.8% | 79.8% | 76.2% | 65.5% | −10.7 |
| cheap/haiku-4.5 | 81.0% | 81.0% | 88.1% | 79.8% | −8.3 |
| cheap/gemini-3.1-flash-lite | 92.9% | 92.9% | 82.1% | 92.9% | +10.7 |
| frontier/gemini-3.1-pro | 100.0% | 100.0% | 100.0% | 100.0% | 0.0 |
| frontier/opus-4.8 | 96.4% | 96.4% | — | — | — |

- **At the July size the new fields cost nothing:** 86.5 % vs 85.9 % over all tiers, and no tier
  moves by more than 1.8 points. The `main-1d` arm is July's `b-flat-gust` fixture with July's
  questions and models: 86.5 % today against 89.7 % in July (n = 84 both), the same within noise.
- **At the 5-day size the tiny tier drops 12.5 points**, in both tiny models (−14.3, −10.7). The
  cheap tier does not move as a tier, but its two models move 8–11 points in opposite directions,
  which shows how large one model's run-to-run noise is at 14 rows. Frontier is unchanged.
- The drop is in the "which hour" questions: on `pr183-5d`, `ms-argmax-sunshine`,
  `ms-argmax-gust` and `ms-argmax-precip` each fall to 3 of 5 models (main-5d: 5, 4 and 4).
  `ministral-8b`'s wrong hours are the row next to the right one (13:00 for 12:00, 07:00 for
  08:00); `gpt-5-nano`'s are 2–6 hours off. No answer in the run was cut off or unparseable: every
  failure is a wrong or partly wrong value.
- `ms-argmax-wind` fails in every arm for most models (09:00, the gust peak, for 08:00, the wind
  peak). This is the same in both shapes, so it does not affect the deltas.

### Help — the five new questions (mean score, pass)

| tier | main 1d (decline) | pr183 1d | main 5d (decline) | pr183 5d |
|---|---|---|---|---|
| tiny | 100.0% (10/10) | 76.7% (7/10) | 90.0% (9/10) | **51.7% (4/10)** |
| cheap | 100.0% (10/10) | 86.7% (8/10) | 100.0% (10/10) | 93.3% (9/10) |
| frontier | 100.0% (10/10) | 100.0% (10/10) | 100.0% (5/5) | 100.0% (5/5) |

- **Cheap and frontier models read the new fields well:** 87–100 % at both sizes. Frontier got
  all of them right.
- **Without the fields, models do not invent fog or cloud:** 54 of 55 declines on `main` across
  both sizes and all tiers were correct. The one miss: `gpt-5-nano` on `main-5d` answered the
  freezing-fog question with an invented hour and −2 °C. No model took the daily icon's code (14,
  in `weather_icon_url`) as the 15:00 symbol.
- **Tiny models struggle with the new fields themselves**, at both sizes: `gpt-5-nano` 2/5 (1 day)
  and 1/5 (5 days), `ministral-8b` 5/5 and 3/5. The misses are values from the wrong row: fog
  ending at 04:00 instead of 05:00 (both tiny models), symbol code 3 instead of 26 at 15:00 (both),
  the low-cloud % and the high-cloud peak of other hours (`gpt-5-nano`).
- The 1 °C boundary in the freezing-fog question (02:00 is exactly 1.0 °C, not below 1) caught
  `gpt-5-nano`, and on the 1-day arm both cheap models too.

### Repeat run — the tiny tier at 5 days (noise check)

The two tiny models ran both 5-day arms a second time with `--no-cache`
(`pnpm run symbol:eval:tiny-5d-repeat`, 76 rows, none from the cache), the same day and inputs.

| 14 July questions, tiny 5d | main | pr183 | Δ |
|---|---|---|---|
| run 1 | 72.0% (18/28) | 59.5% (14/28) | −12.5 |
| run 2 | 66.1% (16/28) | 54.2% (12/28) | −11.9 |
| both runs (n = 56 per arm) | 69.0% (34/56) | 56.8% (26/56) | **−12.2** |

| per model, Δ 5d | run 1 | run 2 | both |
|---|---|---|---|
| tiny/gpt-5-nano | −14.3 | −6.0 | −10.1 |
| tiny/ministral-8b | −10.7 | −17.9 | −14.3 |

- **The tier drop repeats:** −12.5 and −11.9, and both models drop in both runs.
- **One model's score moves a lot between runs** at temperature 0: `gpt-5-nano` on the same `main-5d`
  input scored 67.9 % then 56.0 %. Read per-model numbers as noise-level; the tier delta is the stable one.
- **New questions, run 2:** tiny 51.7 % on `pr183-5d` and 90.0 % declines on `main-5d`, the same as run 1.

### Tokens

Mean prompt tokens per call, Haiku's tokenizer: 2,492 / 3,908 / 11,313 / 18,453 for
main-1d / pr183-1d / main-5d / pr183-5d, so **+57 % (1 day) and +63 % (5 days)** for the whole
prompt. The other tokenizers give +49 to +51 % and +54 to +57 % (`gpt-5-nano`: 9,686 → 15,061 at
5 days).

## Verdict (applying the rules written before the run)

- Harm: tiny −12.5 points on the 5-day arms (rule: 7.2) → **harm in the tiny tier**. Cheap
  +1.2 → no harm.
- Help: `pr183-5d` new questions tiny 51.7 % (rule: 80 %) → **not met**. Cheap 93.3 % and
  frontier 100 % meet it, and the decline on `main-5d` meets it in every tier (90–100 %).
- → **harm on small models.** At the size of a real 5-day answer, the two tiny models read the old
  fields less well when the five new fields are present, and they read the new fields poorly.
  Cheap and frontier models lose nothing and answer the new fog and cloud questions correctly. At
  the 1-day size nothing measurable changes.

## Limits

- **Small samples.** 28 rows per tier and arm; one question is 3.6 points. Only the tiny tier at 5
  days was repeated (see "Repeat run"): its drop held (−12.5, −11.9). The other tiers and the
  1-day arms ran once; one model's score moved up to 12 points between two runs on the same input.
- **Frontier at 5 days is one model** (`gemini-3.1-pro`); Opus was left out of the 5-day arms to
  stay in budget.
- **Mock data**, not a captured forecast; decoy days put a little sun one or two hours outside
  April daylight. Same in both arms.
- **No tool description in the prompt.** In real use the model also sees the description and the
  output schema; this run measures the JSON alone, as in July.
- **promptfoo 0.122.2 stored only 28 of the first Opus run's 38 rows** (all 38 requests were made
  and billed). A second run served all 38 from promptfoo's cache at no cost; the numbers above use
  that complete file.
- Not tested: smaller variants of the new fields (for example `weather_code` without the `weather`
  text, or no `cloud_mid_pct`), the fields only on request, or a shorter default `days`.

## Cost

- Estimate from the smoke run (76 rows, `gemini-3.1-flash-lite`, 750,922 prompt tokens), scaled
  by each model's price: **about USD 7.6** for all six models on all four arms (Opus on the 5-day
  arms alone about 3.4), above the USD 5 budget. With Opus on the 1-day arms only: **about
  USD 4.2**, written down before the run.
- Token-based estimate after the run (`src/pricing.ts`): smoke 0.1894 + five models 2.7674 + Opus
  0.5857 = **USD 3.54**.
- **Real: USD 3.47**, the change in the `usage` field of OpenRouter's `GET /api/v1/key` for the
  eval key, read before the smoke and after the last run (101.4990 → 104.9720; daily usage
  0 → 3.4730).
- Repeat run (tiny tier, 5 days): token-based estimate USD 0.107; **real USD 0.0432** (104.9720 →
  105.0152, read after the counter had stayed the same for one minute). The real cost is lower
  than the estimate; why was not checked. **Total for this doc: USD 3.52.**

## Opt-in follow-up (2026-11-11)

After the runs above, PR #183 changed (head `5746849`): the five fields are now opt-in.
`meteoswissLocalForecast` takes `detail: "basic" | "sky"`, default `"basic"`; only `"sky"` adds
the five fields (and fetches the three cloud-cover files). The question: **is the default answer
the same as `main`'s, so the tiny-tier loss above is gone?**

### Shape check on real tool output (no model calls)

`src/sky-recheck-fixtures.ts` imports the real `getLocalForecast` and `GetLocalForecastParamsSchema`
of three checkouts of meteoswiss-mcp, `main` (`0b5531a`), the new head (`5746849`) and the previous
head (`da39200`, the shape measured above), and calls them back to back with one shared OGD disk
cache. Each answer is written as the tool's text (`JSON.stringify(result, null, 2)`). Two places,
because a station takes a different code path than other points; default `days` (5):

| place | `main` | new head, default | new head, `detail: "sky"` | old head `da39200` |
|---|---|---|---|---|
| Zürich (postal-code point) | 28,465 B, `eb446135` | 28,465 B, `eb446135` | 48,549 B, `397fc35e` | 48,549 B, `397fc35e` |
| `BER` (station Bern / Zollikofen) | 28,489 B, `61780db9` | 28,489 B, `61780db9` | 48,617 B, `cef6074f` | 48,617 B, `cef6074f` |

(sha256, first 8 hex digits.)

- **One forecast run for all eight answers:** the shared cache held one set of files,
  `vnut12.lssw.202611112100.*` (13 CSVs), and all answers carry the same `generated`.
- **New head, default = `main`, byte for byte** (`cmp`), at both places. No hourly object has any
  of the five keys.
- **New head, `"sky"` = old head `da39200`, byte for byte.** All 120 hourly objects (5 days × 24)
  have the five fields. Against `main` the `"sky"` answer adds 600 lines, five per hour.

### Tiny tier, 5 days, opt-in default

The questions' ground truth belongs to this suite's mock data, so the arm runs on it. Because the
default answer is `main`'s byte for byte, the opt-in default arm is `main-5d`, unchanged: this run
is a third sample of it (`pnpm run symbol:eval:tiny-5d-optin`, 38 rows, `--no-cache`, none from the
cache, 0 errors). Prompt tokens per call are the same as in run 2 (`gpt-5-nano` 9,686,
`ministral-8b` 11,481).

| 14 July questions, tiny 5d | `main` shape | `pr183` shape (always the five fields) |
|---|---|---|
| run 1 | 72.0% (18/28) | 59.5% (14/28) |
| run 2 | 66.1% (16/28) | 54.2% (12/28) |
| run 3 = opt-in default | **72.0% (18/28)** | not run |
| pooled | 70.0% (52/84) | 56.8% (26/56) |

- Per model, run 3: `gpt-5-nano` 67.9 %, `ministral-8b` 76.2 %.
- New questions on the opt-in default: 90.0 % (9/10) correct declines, as in runs 1 and 2.

### Verdict

**With the default input the tiny-tier loss is gone:** the answer is `main`'s byte for byte, and
the tiny tier scores 72.0 % on it (`main` over three runs: 70.0 %). The `"sky"` answer is the
`pr183` shape measured above: the tiny models lose about 12 points at 5 days, and cheap and
frontier models read the new fields well. Not tested: whether models choose `detail: "sky"` for a
fog or cloud question (the prompt has no tool description).

Reproduce the shape check: `pnpm install --filter meteoswiss-mcp` in a checkout of each commit, then
`OGD_CACHE_DIR=<new dir> pnpm run symbol:sky-recheck --main <main> --head <head> --old <old> --out <dir> Zürich BER`
and `cmp` the files.

Cost: estimate before the run USD 0.042 (run 2's `main-5d` tokens); token-based after the run
USD 0.0422; **real USD 0.0155** (105.0152 → 105.0307, read after the counter had stayed the same
for one minute). **Total for this doc: USD 3.53** (101.4990 → 105.0307).

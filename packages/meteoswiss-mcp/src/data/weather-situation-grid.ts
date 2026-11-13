/**
 * The map grid of the weather-situation tool: the majority category of the
 * forecast points in each 5 km cell of the Swiss LV95 grid, as a text raster.
 *
 * One string per grid row, north to south, one character per cell, west to
 * east: about 70 × 45 characters for the whole country (a few KB). A client
 * can draw it with its own symbols; a model can read it as a coarse map. It
 * stays compact however the JSON is indented, unlike a list of cells.
 */

import { WEATHER_CATEGORIES, type WeatherCategory } from '../support/weather-categories.js';

/** Cell size in m. */
export const GRID_CELL_M = 5000;

/** South-west corner of the cell lattice, LV95 (all of Switzerland lies north-east of it). */
const ORIGIN_E = 2_480_000;
const ORIGIN_N = 1_070_000;

/** Character for a cell without forecast points. */
export const GRID_EMPTY = '.';

/** One character per category. */
export const GRID_SYMBOLS: Record<WeatherCategory, string> = {
  sunny: 'S',
  clear_night: 'N',
  partly_sunny: 'P',
  cloudy: 'C',
  high_cloud: 'H',
  fog_or_stratus: 'F',
  rain: 'R',
  sleet: 'L',
  snow: 'W',
  thunder: 'T',
};

/** A categorised point-hour with its LV95 position. */
export type GridSample = { e: number; n: number; category: WeatherCategory };

/** The raster, placed on LV95. */
export type SituationGrid = {
  crs: 'EPSG:2056';
  cell_m: number;
  /** LV95 east of the raster's west edge, m */
  west: number;
  /** LV95 north of the raster's north edge, m */
  north: number;
  /** Rows north to south; character i of a row is the cell i × cell_m east of `west` */
  rows: string[];
  /** Character → category, for the characters in `rows` */
  key: Record<string, string>;
};

const CATEGORY_INDEX: ReadonlyMap<WeatherCategory, number> = new Map(
  WEATHER_CATEGORIES.map((c, i) => [c, i] as const)
);

/**
 * Build the raster from categorised point-hours.
 *
 * Each cell shows the most frequent category of its samples (legend order breaks
 * ties). The raster is cut to the cells that have points.
 *
 * @returns The raster, or null without samples
 */
export function buildGrid(samples: Iterable<GridSample>): SituationGrid | null {
  const cells = new Map<string, { col: number; row: number; counts: number[] }>();
  for (const s of samples) {
    const col = Math.floor((s.e - ORIGIN_E) / GRID_CELL_M);
    const row = Math.floor((s.n - ORIGIN_N) / GRID_CELL_M);
    const id = `${col}:${row}`;
    let cell = cells.get(id);
    if (!cell) {
      cell = { col, row, counts: new Array<number>(WEATHER_CATEGORIES.length).fill(0) };
      cells.set(id, cell);
    }
    const c = CATEGORY_INDEX.get(s.category) ?? 0;
    cell.counts[c] = (cell.counts[c] ?? 0) + 1;
  }
  if (cells.size === 0) return null;

  const all = [...cells.values()];
  const minCol = Math.min(...all.map((c) => c.col));
  const maxCol = Math.max(...all.map((c) => c.col));
  const minRow = Math.min(...all.map((c) => c.row));
  const maxRow = Math.max(...all.map((c) => c.row));
  const used = new Set<WeatherCategory>();
  const rows: string[] = [];
  for (let row = maxRow; row >= minRow; row--) {
    let line = '';
    for (let col = minCol; col <= maxCol; col++) {
      const cell = cells.get(`${col}:${row}`);
      if (!cell) {
        line += GRID_EMPTY;
        continue;
      }
      let best = 0;
      cell.counts.forEach((n, i) => {
        if (n > (cell.counts[best] ?? 0)) best = i;
      });
      const category = WEATHER_CATEGORIES[best] ?? 'sunny';
      used.add(category);
      line += GRID_SYMBOLS[category];
    }
    rows.push(line);
  }

  const key: Record<string, string> = {};
  for (const category of WEATHER_CATEGORIES) {
    if (used.has(category)) key[GRID_SYMBOLS[category]] = category;
  }
  key[GRID_EMPTY] = 'no forecast point';
  return {
    crs: 'EPSG:2056',
    cell_m: GRID_CELL_M,
    west: ORIGIN_E + minCol * GRID_CELL_M,
    north: ORIGIN_N + (maxRow + 1) * GRID_CELL_M,
    rows,
    key,
  };
}

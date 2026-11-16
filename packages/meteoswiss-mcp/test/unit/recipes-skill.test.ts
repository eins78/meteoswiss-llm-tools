import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../src/support/server-instructions.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (rel: string): string => readFileSync(`${repoRoot}${rel}`, 'utf8');

describe('recipes skill of the root plugin', () => {
  const skill = read('skills/meteoswiss-situation-recipes/SKILL.md');

  it('carries every recipe of the server instructions word for word', () => {
    const recipes = SERVER_INSTRUCTIONS.match(/^\d\. .+$/gm) ?? [];
    expect(recipes).toHaveLength(4);
    for (const recipe of recipes) expect(skill, recipe.slice(0, 40)).toContain(recipe);
  });

  it('has the frontmatter a skill needs, named like its folder', () => {
    const front = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(front).toMatch(/^name: meteoswiss-situation-recipes$/m);
    expect(front).toMatch(/^description: /m);
    expect(front).toMatch(/^compatibility: claude-code, cursor$/m);
  });

  it('names only tools the server has', () => {
    const tools = new Set([
      'meteoswissLocalForecast',
      'meteoswissWeatherSituation',
      'meteoswissCurrentWeather',
      'meteoswissStations',
      'meteoswissPollenData',
      'meteoswissClimateData',
    ]);
    const named = skill.match(/meteoswiss[A-Z][A-Za-z]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const name of new Set(named)) expect(tools.has(name), name).toBe(true);
  });

  it('keeps the two plugin manifests on one version', () => {
    const claude = JSON.parse(read('.claude-plugin/plugin.json')) as { version: string };
    const cursor = JSON.parse(read('.cursor-plugin/plugin.json')) as { version: string };
    expect(claude.version).toBe(cursor.version);
  });
});

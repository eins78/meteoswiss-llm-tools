import { describe, expect, it } from 'vitest';
/**
 * Tests for the skills↔MCP parity structural gate (scripts/skills-parity-lib.ts).
 *
 * Pure-function tests cover each finding kind the gate can produce; the last
 * block runs the real inventory generation against the live in-process server
 * to pin the committed snapshot (the same check `pnpm run lint:parity` makes,
 * so a drifted snapshot fails the test suite too, not just the lint).
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../../src/server.js';
import {
  buildInventory,
  renderInventory,
  parseExceptions,
  extractMarkers,
  extractCanonicalSourcePaths,
  checkParity,
  ToolInventorySchema,
  INVENTORY_COMMENT,
  type ParityExceptions,
  type RawToolListEntry,
  type ToolInventory,
} from '../../scripts/skills-parity-lib.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(packageDir, '../..');

// --- Test fixtures (in-memory) ---

const RAW_TOOLS: RawToolListEntry[] = [
  { name: 'zebra', description: 'z tool', inputSchema: { type: 'object' } },
  {
    name: 'alpha',
    description: 'a tool',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  },
];

function makeInventory(names: string[]): ToolInventory {
  return {
    $comment: INVENTORY_COMMENT,
    tools: names.map((name) => ({
      name,
      description: `${name} description`,
      inputSchema: { type: 'object' },
    })),
  };
}

const NO_EXCEPTIONS: ParityExceptions = { 'excluded-tools': [], exceptions: [] };

describe('buildInventory', () => {
  it('sorts tools by name and preserves outputSchema only when present', () => {
    const inventory = buildInventory(RAW_TOOLS);
    expect(inventory.tools.map((t) => t.name)).toEqual(['alpha', 'zebra']);
    expect(inventory.tools[0]!.outputSchema).toEqual({ type: 'object' });
    expect('outputSchema' in inventory.tools[1]!).toBe(false);
    expect(inventory.$comment).toBe(INVENTORY_COMMENT);
  });

  it('renders deterministically', () => {
    const a = renderInventory(buildInventory(RAW_TOOLS));
    const b = renderInventory(buildInventory([...RAW_TOOLS].reverse()));
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });
});

describe('extractMarkers', () => {
  it('finds mcp-tool markers with flexible whitespace', () => {
    const markdown = [
      '## Section',
      '<!-- mcp-tool: meteoswissCurrentWeather -->',
      '<!--mcp-tool:meteoswissStations-->',
      '<!--   mcp-tool:   meteoswissPollenData   -->',
      '<!-- some other comment -->',
    ].join('\n');
    expect(extractMarkers(markdown)).toEqual([
      'meteoswissCurrentWeather',
      'meteoswissStations',
      'meteoswissPollenData',
    ]);
  });

  it('returns empty for text without markers', () => {
    expect(extractMarkers('# No markers here\nJust prose.')).toEqual([]);
  });
});

describe('extractCanonicalSourcePaths', () => {
  it('extracts multiple paths from one comment', () => {
    const markdown =
      '<!-- Canonical source: packages/meteoswiss-mcp/src/support/weather-icons.ts and src/schemas/ogd-shared.ts -->';
    expect(extractCanonicalSourcePaths(markdown)).toEqual([
      'packages/meteoswiss-mcp/src/support/weather-icons.ts',
      'src/schemas/ogd-shared.ts',
    ]);
  });
});

describe('parseExceptions', () => {
  it('accepts the real exceptions file shape', () => {
    const parsed = parseExceptions(
      loadYaml(readFileSync(path.join(packageDir, 'parity/parity-exceptions.yml'), 'utf-8'))
    );
    const excludedNames = parsed['excluded-tools'].map((e) => e.name);
    expect(excludedNames).toEqual(['search', 'fetch']);
    // every entry must carry a non-empty reason — exclusions are documented decisions
    for (const entry of [...parsed['excluded-tools'], ...parsed.exceptions]) {
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('rejects entries without a reason', () => {
    expect(() => parseExceptions({ 'excluded-tools': [{ name: 'x' }], exceptions: [] })).toThrow();
  });

  it('rejects blank or whitespace-only reasons (documented decisions only)', () => {
    expect(() =>
      parseExceptions({ 'excluded-tools': [{ name: 'x', reason: '' }], exceptions: [] })
    ).toThrow();
    expect(() =>
      parseExceptions({ 'excluded-tools': [{ name: 'x', reason: '   \n  ' }], exceptions: [] })
    ).toThrow();
    expect(() =>
      parseExceptions({
        'excluded-tools': [],
        exceptions: [{ source: 'a.ts', skill: 'SKILL.md', reason: 'short' }],
      })
    ).toThrow();
  });
});

describe('checkParity', () => {
  const base = {
    live: makeInventory(['toolA', 'toolB']),
    committed: makeInventory(['toolA', 'toolB']),
    markers: ['toolA', 'toolB'],
    exceptions: NO_EXCEPTIONS,
    fileExists: () => true,
    canonicalSourcePaths: [],
  };

  it('passes when everything lines up', () => {
    expect(checkParity(base)).toEqual([]);
  });

  it('flags a missing committed snapshot', () => {
    const findings = checkParity({ ...base, committed: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('inventory-drift');
  });

  it('flags drift and names added/removed/changed tools', () => {
    const changed = makeInventory(['toolA', 'toolC']);
    changed.tools[0]!.description = 'toolA description CHANGED';
    const findings = checkParity({ ...base, live: changed, markers: ['toolA', 'toolC'] });
    const drift = findings.find((f) => f.kind === 'inventory-drift');
    expect(drift).toBeDefined();
    expect(drift!.message).toContain('added: toolC');
    expect(drift!.message).toContain('removed: toolB');
    expect(drift!.message).toContain('changed: toolA');
    expect(drift!.message).toContain('parity:update');
  });

  it('flags an in-scope tool without a marker (completeness)', () => {
    const findings = checkParity({ ...base, markers: ['toolA'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('missing-marker');
    expect(findings[0]!.message).toContain('toolB');
  });

  it('does NOT require markers for excluded tools', () => {
    const exceptions: ParityExceptions = {
      'excluded-tools': [{ name: 'toolB', reason: 'deliberately out of scope for tests' }],
      exceptions: [],
    };
    expect(checkParity({ ...base, markers: ['toolA'], exceptions })).toEqual([]);
  });

  it('flags a marker naming a tool that no longer exists (staleness)', () => {
    const findings = checkParity({ ...base, markers: ['toolA', 'toolB', 'ghostTool'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('stale-marker');
    expect(findings[0]!.message).toContain('ghostTool');
  });

  it('flags an exclusion for a tool that no longer exists (staleness)', () => {
    const exceptions: ParityExceptions = {
      'excluded-tools': [{ name: 'ghostTool', reason: 'was excluded, then deleted' }],
      exceptions: [],
    };
    const findings = checkParity({ ...base, exceptions });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('stale-exclusion');
  });

  it('flags a tool that is both excluded and marked (contradiction)', () => {
    const exceptions: ParityExceptions = {
      'excluded-tools': [{ name: 'toolB', reason: 'excluded but somebody marked it anyway' }],
      exceptions: [],
    };
    const findings = checkParity({ ...base, exceptions });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('excluded-but-marked');
  });

  it('flags exception sources, skill targets, and canonical-source paths that no longer exist', () => {
    const exceptions: ParityExceptions = {
      'excluded-tools': [],
      exceptions: [{ source: 'src/gone.ts', skill: 'SKILL.md', reason: 'points at a deleted file' }],
    };
    const findings = checkParity({
      ...base,
      exceptions,
      fileExists: () => false,
      canonicalSourcePaths: ['src/also-gone.ts'],
    });
    expect(findings.map((f) => f.kind).sort()).toEqual([
      'stale-canonical-source',
      'stale-exception-skill',
      'stale-exception-source',
    ]);
  });

  it('strips the #anchor before probing an exception skill target (TEST-4)', () => {
    const exceptions: ParityExceptions = {
      'excluded-tools': [],
      exceptions: [
        { source: 'src/x.ts', skill: 'REFERENCE.md#weather-icon-codes', reason: 'anchored target' },
      ],
    };
    // File exists only for the anchor-stripped path; the raw `…#anchor` string does not.
    const existing = new Set(['src/x.ts', 'REFERENCE.md']);
    const findings = checkParity({
      ...base,
      exceptions,
      fileExists: (p) => existing.has(p),
    });
    expect(findings).toEqual([]);
  });

  it('flags a deleted exception skill file even when the source still exists', () => {
    const exceptions: ParityExceptions = {
      'excluded-tools': [],
      exceptions: [{ source: 'src/x.ts', skill: 'GONE.md#sec', reason: 'skill target deleted' }],
    };
    const findings = checkParity({
      ...base,
      exceptions,
      fileExists: (p) => p === 'src/x.ts',
    });
    expect(findings.map((f) => f.kind)).toEqual(['stale-exception-skill']);
  });
});

describe('live parity (same checks as `pnpm run lint:parity`)', () => {
  const skillDir = path.join(repoRoot, 'packages/meteoswiss-skills/skills/meteoswiss-ogd');

  async function generateLive(): Promise<ToolInventory> {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'parity-test', version: '0.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    await client.close();
    return buildInventory(tools as RawToolListEntry[]);
  }

  it('committed tool-inventory.json matches the live server (drift check)', async () => {
    const live = await generateLive();
    const committed = ToolInventorySchema.parse(
      JSON.parse(readFileSync(path.join(packageDir, 'parity/tool-inventory.json'), 'utf-8'))
    );
    expect(renderInventory(committed)).toBe(renderInventory(live));
  });

  it('every in-scope tool has a skill coverage marker and nothing is stale', async () => {
    const live = await generateLive();
    const exceptions = parseExceptions(
      loadYaml(readFileSync(path.join(packageDir, 'parity/parity-exceptions.yml'), 'utf-8'))
    );
    const markers: string[] = [];
    const canonicalSourcePaths: string[] = [];
    for (const file of ['SKILL.md', 'REFERENCE.md']) {
      const markdown = readFileSync(path.join(skillDir, file), 'utf-8');
      markers.push(...extractMarkers(markdown));
      canonicalSourcePaths.push(...extractCanonicalSourcePaths(markdown));
    }
    const findings = checkParity({
      live,
      committed: live,
      markers,
      exceptions,
      fileExists: (p) =>
        existsSync(path.join(repoRoot, p)) || existsSync(path.join(packageDir, p)),
      canonicalSourcePaths,
    });
    expect(findings.map((f) => `${f.kind}: ${f.message}`)).toEqual([]);
  });
});

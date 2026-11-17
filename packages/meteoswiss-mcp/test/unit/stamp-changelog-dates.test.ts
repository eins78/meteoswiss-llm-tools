import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(
  new URL('../../../../scripts/stamp-changelog-dates.mjs', import.meta.url)
);
const { stampVersions } = (await import(pathToFileURL(scriptPath).href)) as {
  stampVersions: (
    text: string,
    versions: Iterable<string>,
    date: string
  ) => { text: string; stamped: string[] };
};

/**
 * A copy of the rule `changesets/action` (v2.1.2, `getChangelogEntry` in `src/utils.ts`) uses to
 * pick the entry of one version for the Version Packages PR body: the content under the heading
 * whose text equals the version exactly, up to the next heading of the same level. With no such
 * heading it takes the whole file. (The action reads the markdown with remark; this reads the
 * `#` headings line by line, which is the same for a changelog.)
 */
function getChangelogEntry(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  let start: { index: number; depth: number } | undefined;
  let end: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i]?.match(/^(#{1,6}) (.*)$/);
    if (!heading) continue;
    const depth = heading[1]?.length ?? 0;
    if (start === undefined && heading[2]?.trim() === version) {
      start = { index: i, depth };
      continue;
    }
    if (end === undefined && start !== undefined && start.depth === depth) {
      end = i;
      break;
    }
  }
  return start === undefined ? changelog : lines.slice(start.index + 1, end).join('\n');
}

const RELEASED = `# meteoswiss-mcp

## 4.2.1

Released 2026-11-15

### Patch Changes

- aaa1111: Fix one thing.

## 4.2.0

Released 2026-11-14

### Minor Changes

- bbb2222: Add another thing.

## 1.0.0

### Patch Changes

- ccc3333: The first release, never dated.
`;

/** What `changeset version` does: a bare heading for the new version on top. */
const NEW_ENTRY = `## 4.3.0

### Minor Changes

- ddd4444: Add the new thing.

`;
const withNewEntry = (text: string): string => text.replace('## 4.2.1', `${NEW_ENTRY}## 4.2.1`);

describe('stampVersions', () => {
  it('puts the date on its own line under a bare heading and keeps the heading bare', () => {
    const { text, stamped } = stampVersions(withNewEntry(RELEASED), ['4.3.0'], '2026-11-17');
    expect(stamped).toEqual(['4.3.0']);
    expect(text).toContain('\n## 4.3.0\n\nReleased 2026-11-17\n\n### Minor Changes\n');
    expect(text).not.toMatch(/^## .* - \d{4}-\d{2}-\d{2}$/m);
  });

  it('leaves a heading that already has its date line alone (idempotent)', () => {
    const once = stampVersions(withNewEntry(RELEASED), ['4.3.0'], '2026-11-17').text;
    const twice = stampVersions(once, ['4.3.0'], '2026-11-18');
    expect(twice.stamped).toEqual([]);
    expect(twice.text).toBe(once);
  });

  it('touches only the versions it is given', () => {
    const { text } = stampVersions(withNewEntry(RELEASED), ['4.3.0'], '2026-11-17');
    expect(text.match(/^Released /gm)).toHaveLength(3); // 4.3.0, 4.2.1, 4.2.0
    expect(text).toContain('## 1.0.0\n\n### Patch Changes');
  });

  it('does nothing for a version without a bare heading', () => {
    expect(stampVersions(RELEASED, ['9.9.9'], '2026-11-17')).toEqual({
      text: RELEASED,
      stamped: [],
    });
  });
});

describe('the changesets action finds the entry of a stamped changelog', () => {
  const stamped = stampVersions(withNewEntry(RELEASED), ['4.3.0'], '2026-11-17').text;

  it('gives only the new version for its heading', () => {
    const entry = getChangelogEntry(stamped, '4.3.0');
    expect(entry).toContain('ddd4444: Add the new thing.');
    expect(entry).toContain('Released 2026-11-17');
    expect(entry).not.toContain('aaa1111');
    expect(entry).not.toContain('bbb2222');
    expect(entry).not.toContain('## 4.2.1');
  });

  it('gives only the old version for an old heading', () => {
    const entry = getChangelogEntry(stamped, '4.2.1');
    expect(entry).toContain('aaa1111');
    expect(entry).not.toContain('ddd4444');
    expect(entry).not.toContain('bbb2222');
  });

  it('shows the old failure: a heading with the date in it matches nothing, so the whole file comes back', () => {
    const dated = withNewEntry(RELEASED).replace('## 4.3.0', '## 4.3.0 - 2026-11-17');
    expect(getChangelogEntry(dated, '4.3.0')).toBe(dated);
  });
});

describe('the script, run on a repo the way `pnpm run version` runs it', () => {
  const root = mkdtempSync(join(tmpdir(), 'stamp-changelog-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      stdio: 'ignore',
    });
  };
  const run = (): string =>
    execFileSync('node', [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, STAMP_CHANGELOG_ROOT: root, STAMP_CHANGELOG_DATE: '2026-11-17' },
    });
  const file = join(root, 'packages', 'pkg', 'CHANGELOG.md');

  it('stamps the heading that the changeset run added, and only that one', () => {
    mkdirSync(join(root, 'packages', 'pkg'), { recursive: true });
    git('init', '-q');
    writeFileSync(file, RELEASED);
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    writeFileSync(file, withNewEntry(RELEASED)); // what `changeset version` leaves behind
    expect(run()).toContain('1 heading(s) stamped');

    const after = readFileSync(file, 'utf8');
    expect(after).toBe(stampVersions(withNewEntry(RELEASED), ['4.3.0'], '2026-11-17').text);
    const entry = getChangelogEntry(after, '4.3.0');
    expect(entry).toContain('ddd4444');
    expect(entry).not.toContain('aaa1111');
  });

  it('is a no-op when run again', () => {
    const before = readFileSync(file, 'utf8');
    expect(run()).toContain('0 heading(s) stamped');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

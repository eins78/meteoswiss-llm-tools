#!/usr/bin/env node
// Stamp today's release date under the version headings that `changeset version`
// just added.
//
// `@changesets/cli/changelog` writes bare `## X.Y.Z` headings with no date. This
// keeps each NEWLY-ADDED heading bare and puts the date on its own line right
// under it:
//
//   ## 4.3.0
//
//   Released 2026-11-17
//
//   ### Minor Changes
//
// The heading stays bare on purpose: `changesets/action` finds the entry for the
// Version Packages PR body by comparing the heading text with the version
// exactly (`getChangelogEntry`). A heading like `## 4.3.0 - 2026-11-17` matches
// nothing, and the action then puts the WHOLE changelog into the PR body.
//
// It runs after `changeset version` in the root `version` script, alongside the
// skills manifest sync.
//
// "Newly added" is detected via `git diff HEAD` restricted to CHANGELOG files,
// so it only ever touches the heading(s) this run introduced: never a
// pre-existing entry, and never a historical undated heading lower in the file.
// It is idempotent: a heading that already has its `Released` line is left
// alone, and a run with no version bumps is a no-op.
//
// For tests, STAMP_CHANGELOG_ROOT (the repo to work on) and STAMP_CHANGELOG_DATE
// (YYYY-MM-DD) replace the script's own repo and today.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// A bare version heading: `## 1.2.3` or `## 1.2.3-rc.1`, with nothing after it.
const BARE_HEADING = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

// The date line under a heading. One plain form, used everywhere.
const RELEASED_LINE = /^Released \d{4}-\d{2}-\d{2}$/;

/**
 * Put `Released <date>` under the bare heading of each given version.
 *
 * @param {string} text - The CHANGELOG text
 * @param {Iterable<string>} versions - Versions whose heading to stamp
 * @param {string} date - YYYY-MM-DD
 * @returns {{ text: string, stamped: string[] }} the new text and the versions that were stamped
 */
export function stampVersions(text, versions, date) {
  const lines = text.split('\n');
  const stamped = [];
  for (const version of versions) {
    const at = lines.findIndex((line) => {
      const match = line.match(BARE_HEADING);
      return match !== null && match[1] === version;
    });
    if (at === -1) continue;
    const next = lines.slice(at + 1).find((line) => line.trim() !== '');
    if (next !== undefined && RELEASED_LINE.test(next)) continue; // already stamped
    lines.splice(at + 1, 0, '', `Released ${date}`);
    stamped.push(version);
  }
  return { text: lines.join('\n'), stamped };
}

/**
 * Map each changed CHANGELOG file to the bare version headings its diff added.
 *
 * @param {string} diff - Output of `git diff HEAD --unified=0` for the CHANGELOG files
 * @returns {Map<string, Set<string>>}
 */
export function addedHeadings(diff) {
  const addedByFile = new Map();
  let currentFile = null;
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1].endsWith('CHANGELOG.md') ? fileMatch[1] : null;
      continue;
    }
    if (!currentFile || !line.startsWith('+') || line.startsWith('+++')) continue;
    const headingMatch = line.slice(1).match(BARE_HEADING);
    if (headingMatch) {
      if (!addedByFile.has(currentFile)) addedByFile.set(currentFile, new Set());
      addedByFile.get(currentFile).add(headingMatch[1]);
    }
  }
  return addedByFile;
}

function main() {
  const repoRoot =
    process.env.STAMP_CHANGELOG_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const today = process.env.STAMP_CHANGELOG_DATE ?? new Date().toISOString().slice(0, 10); // UTC

  let diff;
  try {
    // Restrict the diff to CHANGELOG files at the git level (not just in JS) so an
    // unrelated dirty working tree can't bloat the output or trip maxBuffer.
    diff = execFileSync('git', ['diff', 'HEAD', '--unified=0', '--', ':(glob)**/CHANGELOG.md'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    console.warn(`stamp-changelog-dates: git diff failed, skipping (${err.message})`);
    process.exit(0);
  }

  let stamped = 0;
  for (const [relFile, versions] of addedHeadings(diff)) {
    const file = join(repoRoot, relFile);
    const result = stampVersions(readFileSync(file, 'utf8'), versions, today);
    writeFileSync(file, result.text);
    for (const version of result.stamped) {
      console.log(`  ## ${version}: added "Released ${today}": ${relFile}`);
    }
    stamped += result.stamped.length;
  }

  console.log(`stamp-changelog-dates: ${today} (${stamped} heading(s) stamped)`);
}

// Run only as a script, not when a test imports the functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

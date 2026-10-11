import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { resolveCachePath } from '../../src/data/ogd-data-store.js';

/**
 * Cache-key path-safety (SEC-5). Keys derive from server-controlled metadata
 * today, so this guards against a future key ever folding in user input.
 */
describe('resolveCachePath — traversal safety', () => {
  it('resolves a normal nested key under the cache directory', () => {
    const resolved = resolveCachePath('forecasts/point-123/tre200dx.csv');
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved.endsWith(path.join('forecasts', 'point-123', 'tre200dx.csv'))).toBe(true);
  });

  it('rejects a parent-directory traversal key', () => {
    expect(() => resolveCachePath('../../etc/passwd')).toThrow(/escapes cache directory/);
  });

  it('rejects an absolute-path key', () => {
    expect(() => resolveCachePath('/etc/passwd')).toThrow(/escapes cache directory/);
  });
});

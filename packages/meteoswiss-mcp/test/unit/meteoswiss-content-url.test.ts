import { describe, expect, it } from 'vitest';
import { assertAllowedContentUrl } from '../../src/data/meteoswiss-content-data.js';

/**
 * Direct coverage of the `fetch` tool's URL allowlist (SEC-4 / SEC-8 / TEST-1).
 *
 * Integration tests all run in fixture mode, which short-circuits before this
 * control, so a refactor that broke the allowlist would otherwise ship green.
 * `assertAllowedContentUrl` is the exact function run for the initial URL and
 * re-run on every redirect hop, so testing it directly covers both.
 */
describe('assertAllowedContentUrl — allowlist enforcement', () => {
  it('accepts an allowed MeteoSwiss https URL', () => {
    expect(() =>
      assertAllowedContentUrl('https://www.meteoschweiz.admin.ch/home.html')
    ).not.toThrow();
  });

  it('rejects a non-MeteoSwiss domain', () => {
    expect(() => assertAllowedContentUrl('https://evil.example/x')).toThrow(/Invalid domain/);
  });

  it('rejects a userinfo-embedded host escape (real host is off-allowlist)', () => {
    // Everything before @ is credentials; URL.hostname is evil.example.
    expect(() =>
      assertAllowedContentUrl('https://www.meteoschweiz.admin.ch@evil.example/x')
    ).toThrow(/Invalid domain/);
  });

  it('rejects a plaintext http scheme (SEC-8)', () => {
    expect(() => assertAllowedContentUrl('http://www.meteoschweiz.admin.ch/x')).toThrow(
      /Invalid scheme/
    );
  });

  it('rejects a non-default port (SEC-8)', () => {
    expect(() => assertAllowedContentUrl('https://www.meteoschweiz.admin.ch:8443/x')).toThrow(
      /Invalid port/
    );
  });

  it('rejects a malformed URL', () => {
    expect(() => assertAllowedContentUrl('not a url')).toThrow(/Invalid URL/);
  });

  it('rejects an internal-metadata address (the SSRF-via-redirect target shape)', () => {
    expect(() => assertAllowedContentUrl('http://169.254.169.254/latest/meta-data/')).toThrow();
  });
});

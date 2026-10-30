# Releasing

The release process (changesets, the "Version Packages" pull request, tags and pre-releases) is documented on the site:
**[Release process](https://code.178.is/meteoswiss-llm-tools/development/releasing/)**. In short:

1. Add a changeset to each user-facing pull request.
2. Merge the automatically opened "Version Packages" pull request.
3. Create a GitHub Release whose tag is `meteoswiss-mcp-vX.Y.Z` (or `meteoswiss-skills-vX.Y.Z`). A hyphenated version such as
   `4.1.0-rc.1` is a pre-release: npm `next`, no `latest` tag.

The release workflow ([`release.yml`](../../../.github/workflows/release.yml)) runs the CI checks, publishes `meteoswiss-mcp` to npm and
pushes `ghcr.io/eins78/meteoswiss-mcp` (linux/amd64 and linux/arm64). Deploying the new image is up to whoever runs the server.

## Security

The release workflow follows [npm security best practices](https://www.zachleat.com/web/npm-security/):

- **No npm tokens** — uses OIDC Trusted Publishers instead of long-lived `NPM_TOKEN`
- **npm provenance** — packages include signed attestation linking to the source commit
- **Pinned action SHAs** — all `uses:` references are pinned to full commit SHA, not mutable tags
- **Minimal permissions** — each job requests only the permissions it needs
- **Separate publish jobs** — npm and Docker publish run in isolated jobs with different permission sets
- **GitHub environment** — npm publish runs in an `npm` environment (can add required reviewers)

### Setup: npm Trusted Publishers (OIDC)

npm Trusted Publishers require the package to exist first. One-time bootstrap (already done for `meteoswiss-mcp`):

1. **First publish (manual, one-time only):**
   ```bash
   npm adduser  # or: npm login
   cd packages/meteoswiss-mcp
   npm publish --access public --provenance
   ```
2. **Configure Trusted Publishers** on npmjs.com:
   - Go to https://www.npmjs.com/package/meteoswiss-mcp → **Settings** tab
   - Under **Trusted Publishers**, add:
     - **Repository owner:** `eins78`
     - **Repository name:** `meteoswiss-llm-tools`
     - **Workflow filename:** `release.yml`
     - **Environment:** `npm`
3. **Create GitHub environment** named `npm`:
   - Repo Settings → Environments → New environment → `npm`
   - Optionally add required reviewers for an approval gate
4. **Lock down the package** on npmjs.com:
   - Settings → Publishing access → "Require two-factor authentication and disallow tokens"
5. **Delete any npm tokens** you created for the bootstrap

After this, all future publishes use OIDC — no tokens stored anywhere. GHCR push uses the built-in `GITHUB_TOKEN`.

## Version in package.json

Versions are bumped by changesets in the "Version Packages" pull request, not by hand. As a safety net, `release.yml` also sets the
`package.json` version from the tag when the two differ (in the npm and Docker jobs), so the tag must match the merged version.

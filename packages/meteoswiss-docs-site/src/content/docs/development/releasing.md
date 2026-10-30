---
title: Release process
description: How changes are versioned with changesets and published to npm, GHCR and the Agent Skill channels.
---

The monorepo uses [changesets](https://github.com/changesets/changesets). Each package has its own version and its own tag.

## 1. Add a changeset to your pull request

For any user-facing change, run `pnpm changeset` (or create a file in `.changeset/`):

```markdown
---
"meteoswiss-mcp": minor
---

Describe the change for the people who will read the changelog.
```

Use `"meteoswiss-skills"` for changes under `packages/meteoswiss-skills/`; a change touching both lists both. Pick `patch`, `minor` or `major`
by the impact on users. A change in a default that can break a deployment, such as `TRUST_PROXY` in 4.0.0, is a major bump.

Skip the changeset for documentation-only, CI-only, tooling-only or test-only changes.

## 2. The "Version Packages" pull request

When pull requests with changesets merge to `main`, the *Version Packages* workflow opens (or updates) a pull request that bumps
`package.json` versions and writes `CHANGELOG.md`. For the skills package, the same step mirrors the version into the Claude Code and Cursor
plugin manifests and each `SKILL.md`. Don't edit those by hand.

Merging that pull request finalises the version numbers on `main`.

## 3. Publish with a GitHub Release

A release is created from a tag named after the package:

| Package | Tag | Effect |
|---------|-----|--------|
| `meteoswiss-mcp` | `meteoswiss-mcp-vX.Y.Z` | Runs CI, publishes to npm, builds and pushes `ghcr.io/eins78/meteoswiss-mcp` (amd64 and arm64) |
| `meteoswiss-skills` | `meteoswiss-skills-vX.Y.Z` | Validates the skill package |

A version with a hyphen (`4.1.0-rc.1`) is a pre-release: it is published to the npm `next` tag and gets only its own Docker tag, so it never
moves `latest`. Mark it `--prerelease` on the GitHub Release.

```bash
gh release create meteoswiss-mcp-v4.1.0 --title "meteoswiss-mcp v4.1.0" --notes-from-tag
```

Only create a release when `main` is green. Publishing uses npm Trusted Publishers (OIDC, no stored token) with provenance, and the release
workflow's actions are pinned to commit SHAs.

## 4. Deploy

Publishing an image does not update any running server. Operators pull the new tag themselves; see
[Releases and upgrading](../../operator/releases/).

## Pull requests

- All required checks must pass before merging; fix failing tests in the same pull request.
- Merge with a merge commit.
- Run `pnpm --filter meteoswiss-mcp run fix && pnpm --filter meteoswiss-mcp run ci` before committing.

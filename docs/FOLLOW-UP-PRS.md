# Follow-up PRs

## DEF-VERSION-FILES (2026-11-15). One check for every file that carries the version

`npm run check:supports` compares the README's `## Supports · version X.Y.Z` heading with `package.json` in CI and in
the publish workflow. The `server.json` versions (the MCP registry manifest) and the CHANGELOG section of the version
are compared with `package.json` only by inline steps of `publish.yml`, so a bump that forgets them is found at tag
time, not at PR time. Move those comparisons into one script (one helper, every version-bearing file) and run it in
CI. Found by the review of the PR that added the Supports check; a different mechanism (the registry manifest and the
release notes), so not part of that PR.

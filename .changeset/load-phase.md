---
'@haverstack/eleventy': minor
---

Add the load phase: `load(stack, { site })` resolves the named `site@1`
record (by handle or id, failing on zero or several), fetches every page,
sidecar, menu and attachment record with cursor-exhausting pagination and
`includeUnlisted`, and returns a `StackIndex` — the pruned page tree,
sidecars split into unscoped / this-site / by-site, menus by handle,
attachments grouped by fileId, and `unlistedVisible` recording whether the
credential could see unlisted records. Exports `HaverstackEleventyError`
for structural build failures. The plugin now runs load and logs a summary;
resolve and emit consume the index next.

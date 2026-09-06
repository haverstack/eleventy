---
'@haverstack/eleventy': minor
---

Add the `haverstack-eleventy` CLI with `check` and `publish`.

- **`check`** — load + resolve, report structural problems, write and
  emit nothing. Failures (path collisions, conflicting sidecars) exit
  non-zero; warnings (dangling menu targets, a sidecar scoped to a site
  the record isn't on, records on no site) and info (unlisted records
  built this run, with the mechanism) do not. `runCheck` / `formatCheckReport`
  / `checkExitCode` are exported.
- **`publish`** — stamp `article.url` / `post.url` with `baseUrl` +
  permalink for records that lack one; leave a URL already pointing into
  this site, and don't restamp one pointing elsewhere. `--dry-run` writes
  nothing. Idempotent. Bookmarks and photos are skipped (their `url`, if
  any, isn't a canonical self-link). `runPublish` / `formatPublishReport`
  are exported.

Both read the stack from a config module (`--config`, default
`./haverstack.config.mjs`) that default-exports a `Stack`, a
`{ stack, site? }`, or a function returning one.

`resolve` now takes `strict` (default `true`): `false` collects every
fatal fault in `ResolvedSite.errors` instead of throwing on the first, so
`check` reports them all — and a strict build's error message now lists
every fault at once.

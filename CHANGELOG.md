# @haverstack/eleventy

## 0.2.0

### Minor Changes

- [`bea83a3`](https://github.com/haverstack/eleventy/commit/bea83a38db25fafe66d0a9e1f48fce2af92b3110) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Add the `haverstack-eleventy` CLI with `check` and `publish`.

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

- [`99b9fb8`](https://github.com/haverstack/eleventy/commit/99b9fb883a94cf758800d80564260229c4471f71) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Make the plugin's pages first-class Eleventy content instead of an island.

  - **Collections.** Every listed page and member now carries `tags`
    (`haverstack`, the record's type, its tag associations) rather than
    being excluded from collections, so `collections.all`, `collections.article`,
    tag archives, and any plugin that reads collections see them. Unlisted
    records stay excluded. `eleventyCollections: false` opts out entirely.
  - **Navigation.** Pages carry root-to-leaf `eleventyNavigation`
    (`key` / `parent` / `title` / `order`), so `@11ty/eleventy-navigation`
    works with no configuration.
  - **Raw body.** Template data gains `body` (rendered HTML) and `bodyRaw`
    (embed-substituted markdown), so a mapped layout can render the body
    through its own pipeline. `substituteEmbeds` is exported.
  - **`pageData` option** — `(ctx) => object`, merged into every page/member
    template last, the substitute for directory data files that virtual
    templates cannot have.
  - **`haverstack-eleventy eject`** — writes a starter `haverstack-base.njk`
    layout (nav, footer, `{{ content }}`, listing block) to `_includes`, so
    the whole build can flow through an editable Eleventy layout. It is the
    only thing in the package that writes to the site's source, and never as
    a build side effect. `runEject` / `EJECTABLE_TEMPLATES` are exported.

- [`d64cd05`](https://github.com/haverstack/eleventy/commit/d64cd05317df3514cd2fd5ce6e6a103ce6ee4651) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Add asset staging, body rendering, and the emit phase — the plugin now
  produces a complete site.

  - **`collectAssets` / `stageAssets`** — collect the files a site references
    (`embed` associations and `file-ref` content fields), stage the bytes to
    `assetDir` with a content-addressed skip-if-present cache, and pass them
    through. Every `_attachment@1` filename for a shared fileId maps to the
    one staged path.
  - **`renderBody`** — a plugin-owned markdown-it instance; embed
    substitution runs before parsing, the result is sanitized, and `format`
    follows the commons vocabulary (`markdown` default, anything else plain).
  - **`emit`** — one virtual template per page and per member (drafts
    excluded, unlisted built but out of collections), a built-in default
    template set, one Atom feed per collection plus a combined one, a
    sitemap, and `haverstack` global data.

  New options: `feedLimit` (default 20); `assetDir` defaults to
  `_stack-assets`. Drops the unused `@11ty/eleventy-plugin-rss` and
  `-plugin-syntaxhighlight` deps; adds `markdown-it`.

- [`cc81a5b`](https://github.com/haverstack/eleventy/commit/cc81a5b136f97f4fd289b765f99f0a03cacbc2d7) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Initial package: `defineEleventyTypes(stack)` registers the commons publishing types the
  integration reads (`site`, `page`, `article`, `post`, `photo`, `bookmark`) and the two
  sidecar types it owns under `org.haverstack.eleventy` — `page-meta@1` (`slug`,
  `template`, `order`, `hidden`, `draft`; all optional) and `menu@1`. Registration is
  idempotent and tolerates a non-owner credential. Exports the schema constants, content
  interfaces (`PageMeta`, `Menu`, `MenuItem`), and the association-label constants
  (`for-site`, `site`, `embed`).

- [`e6e3b61`](https://github.com/haverstack/eleventy/commit/e6e3b6165d562e46379080af9db0b36f094be174) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Add the load phase: `load(stack, { site })` resolves the named `site@1`
  record (by handle or id, failing on zero or several), fetches every page,
  sidecar, menu and attachment record with cursor-exhausting pagination and
  `includeUnlisted`, and returns a `StackIndex` — the pruned page tree,
  sidecars split into unscoped / this-site / by-site, menus by handle,
  attachments grouped by fileId, and `unlistedVisible` recording whether the
  credential could see unlisted records. `byId` resolves every sidecar
  parent, point-reading the listing members that carry one. Exports `HaverstackEleventyError`
  for structural build failures. The plugin now runs load and logs a summary;
  resolve and emit consume the index next.

- [`28ead4a`](https://github.com/haverstack/eleventy/commit/28ead4a263c734ce8050e88569d040f923bf8125) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Add the resolve phase: `resolve(index, { slugStrategy })` turns a
  `StackIndex` into a `ResolvedSite` — one URL per record, the two-level
  sidecar cascade applied, collections filtered and sorted, menus pointed at
  real URLs.

  - **Permalinks** — `permalinkFor` logic for pages (ancestor slugs, `index`
    dropped) and listing members (`meta.slug`, else `slugStrategy`:
    `title` / `recordId` / a function).
  - **Drafts** are not built at all (`meta.draft`, or a `publishedAt`-bearing
    type with none). **Unlisted** (`unlistedAt`) and **hidden** (`meta.hidden`)
    members build at their URL but join no collection.
  - **Fatal faults throw `HaverstackEleventyError`**: two sidecars at the
    same scope for one record; two records resolving to one path (named with
    their ids and whether each slug was explicit or derived).
  - **Menus** resolve every `recordId` to a URL — cross-site page targets to
    an absolute URL on that site's `baseUrl`; a dangling target is a warning,
    not a crash. Soft problems collect in `ResolvedSite.warnings`.

  `load` now also fetches the raw collection candidates per listing root
  (`membersByListingRoot`), so resolve stays a pure function. The plugin runs
  load + resolve and logs a summary with any warnings.

- [`b093c37`](https://github.com/haverstack/eleventy/commit/b093c376313dd0490b37cb6cdd7aab977ef6bbc2) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Add the `templates` option — a site can replace the built-in templates
  with its own. It maps a `template` name (`home`, `content`, `listing`,
  `listing-inline`, `article`, `post`, `photo`, `bookmark`, or a custom name
  from a sidecar) to a layout the site provides in its `_includes`; `base`
  is the fallback for any unmapped name, and anything still unmapped keeps
  the self-contained built-in render.

  A mapped page emits its content fragment plus data — `record`, `meta`,
  `url`, `canonical`, `unlisted`, `haverstackTemplate`, `title`, and (for
  listing roots) the resolved `collection` — and Eleventy renders it through
  the site's layout, which receives all of that plus the `haverstack`
  globals and may chain to another layout. For a mapped listing the fragment
  is just the intro body; the layout builds the member list from
  `collection`.

  `renderPageFragment` / `renderMemberFragment` are exported alongside the
  existing full-document `renderPage` / `renderMember`.

### Patch Changes

- [`8120d18`](https://github.com/haverstack/eleventy/commit/8120d18206eb9f265d08d8ccc4d4fdea0a15a177) Thanks [@cuibonobo](https://github.com/cuibonobo)! - Run the per-listing-root collection queries concurrently, and download
  attachments in a bounded pool of 6 rather than one at a time. No
  behaviour change; noticeably faster on a build against a remote stack.

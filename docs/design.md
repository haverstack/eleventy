# `@haverstack/eleventy` — design

An Eleventy plugin that builds a static site from a Haverstack stack. Records are the
content source; there are no content files on disk. This document describes how it works
and why the moving parts are where they are.

---

## It takes a Stack, not a URL

The plugin is given a constructed `Stack`, not a connection string. A `Stack` can be
backed by `APIAdapter` (a remote stack server), `LocalAdapter` (a SQLite file, for
offline and CI builds), or `MemoryAdapter` (the plugin's own tests). A URL option would
foreclose the last two. Taking a `Stack` also means the plugin never handles
credentials: whoever constructs it has already dealt with auth, and the plugin inherits
whatever session it carries.

A `Stack` _can_ write. The build path never does — see [Commands](#commands) — but the
capability is present, so that is a rule rather than a guarantee. The one apparent
exception is `defineEleventyTypes`, which calls `defineType` for every type the
integration reads or owns; registering an identical schema returns before any write, so
this is a no-op on an already-populated stack.

## One build, one site

The `site` option names a `site@1` record by its `handle`, or by record id where no
handle is set. Eleventy has one output directory per run, so a stack serving several
sites means several configs and several builds — sharing templates and plugin code,
differing in which site they name. Resolving `site` to zero or several records fails the
build. A stack with no `site@1` records at all is the single-site case: omit the option,
and the page tree is every page with no page ancestor.

Everything downstream — permalinks, collections, menus, feeds, the sitemap — resolves
within the named site. The other sites in the stack are visible only as link targets.

Title, description and base URL come from the site record, because a second generator
building the same site needs all three and none are rendering decisions. Config carries
what is genuinely this build's business: `assetDir`, `slugStrategy`, `feedLimit`,
`templates`.

## `slugStrategy`

How this site derives a permalink for a listing member when no sidecar overrides it:

| Value                | Derives from                                            |
| -------------------- | ------------------------------------------------------- |
| `'title'`            | the record's `title`, slugified (default)               |
| `'recordId'`         | the record id, for a site publishing under opaque paths |
| `(record) => string` | whatever the site decides                               |

It is config rather than record data because it is a rendering rule. Per-record
exceptions are sidecars; this is the rule they are exceptions to.

---

## Types

**Consumed** from the Schema Commons, registered exactly as defined: `site@1`, `page@1`,
`article@1`, `post@1`, `photo@1`, `bookmark@1`, plus `_entity@1` and `_attachment@1`.

**Owned**, minted under `org.haverstack.eleventy` — a first-party namespace under the
same authority as the commons but outside its governance:

### `org.haverstack.eleventy/page-meta@1`

Generator metadata about a record it does not own, linked by `parentId`. Every field
optional — a page-meta record exists only when it has something to say.

| Field      | Meaning                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `slug`     | Permalink override for a listing member. Absent → derived by `slugStrategy`.                               |
| `template` | Which template renders this record, named in the site's own vocabulary. Absent → inferred.                 |
| `order`    | Reserved for curated listings; not read yet.                                                               |
| `hidden`   | Keep the record out of _this site's_ listings, feeds and navigation while still building it at its URL.    |
| `draft`    | Keep the record from being built at all on _this site_. Closes the gap that `post@1` has no `publishedAt`. |

### `org.haverstack.eleventy/menu@1`

A named, ordered navigation menu belonging to one site (`parentId` = the site). Items
live in the content array. Each item sets `url` **or** `recordId`, not both; `recordId`
is resolved to a permalink at build time; ordering is the `order` field, not array
position. Items may point across sites and carry `rel` (`me` for IndieWeb identity
links).

### Sidecars are scoped, and they cascade

A record may have several `page-meta` sidecars: one unscoped, plus one per site that
needs to describe it differently. A sidecar declares its scope with a `for-site`
association:

```ts
{ kind: 'relationship', label: 'for-site', target: { scope: 'record', recordId: <site> } }
```

`for-site` is this package's own label, distinct from the commons `site` membership
convention: a record carrying `site` is _published on_ that site; a sidecar carrying
`for-site` is published nowhere — it is metadata that applies when that site builds.

Resolution is a two-level cascade: take the unscoped sidecar, overlay the one scoped to
the site being built, field by field. Two sidecars at the same scope for one record is a
writer error — the build fails, naming both.

### Membership

A non-page record joins a site with a `site` relationship association to the site record.
Two associations means both sites. A page's relationship to its site is containment
(`parentId`); an article's is publication (the association) — the same hierarchy /
collection split `page@1` already draws.

### Unlisted, three ways

| Axis              | Mechanism                                                       | Effect                                         |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Draft             | `publishedAt` absent (types that have it), or `page-meta.draft` | not built at all on this site                  |
| Global unlisted   | `record.unlistedAt` (core)                                      | built, reachable, in no index anywhere         |
| Per-site unlisted | `page-meta.hidden`, `for-site` scoped                           | built, reachable, out of _this_ site's indexes |

A record is excluded from a site's listings if **either** of the last two applies;
checked independently because they answer different questions. `unlistedAt` is owner-only
to enumerate (see [Access](#access)).

---

## Build phases

### Load (`load.ts`)

Resolve the site, then fetch every record the build needs and build in-memory indexes:
the site record and every other `site@1`, the page tree pruned to this site's subtree,
`page-meta` sidecars grouped by parent and split into unscoped / this-site / by-site,
menus by handle, `_attachment@1` records grouped by `fileId` (earliest `createdAt`
first), the owner `_entity@1`, and the raw collection candidates per listing root.

Two disciplines this phase enforces:

- **Every query loops the cursor to exhaustion.** `cursor === null` is the only
  end-of-results signal — a short or empty page is not. A query result carries no
  count, so there is nothing else to check against.
- **Every query passes `includeUnlisted: true`.** Unlisted records still build at their
  URLs, so the build must see them; excluding them from listings is resolve's job.
  `includeUnlisted` is owner-only, so a build under a scoped credential loses them —
  `StackIndex.unlistedVisible` records whether that happened.

### Resolve (`resolve.ts`)

A pure function of the index and config. Applies the sidecar cascade; derives one URL
per record (page paths from ancestor slugs with `index` dropped; member paths from
`meta.slug` or `slugStrategy`, under their listing root); infers templates; classifies
canonical URLs; filters and sorts collections (drafts dropped entirely, unlisted/hidden
kept but out of the listing); resolves every menu `recordId` to a URL (a cross-site page
target to an absolute URL on that site's `baseUrl`; a dangling target to a warning, not a
crash).

Fatal faults — two sidecars at one scope, two records at one path — are collected in
`ResolvedSite.errors` and, when `strict` (the default), thrown together. Softer problems
go in `warnings` and the build continues.

### Stage assets (`assets.ts`)

Eleventy does not emit binaries well, so attachment bytes are staged to disk before the
build proper and passed through. `collectAssets` walks every built record for `embed`
attachment associations and `file-ref` content fields (`photo.image`); `stageAssets`
fetches and writes each file, skipping any already on disk — content addressing makes
that cache trivially correct.

The body refers to an embedded file by filename, resolved per record (filenames are not
unique across a stack). Every `_attachment@1` name for a shared `fileId` maps to the one
staged path.

### Emit (`emit.ts`)

- `addTemplate` per page and per member — this is what turns records into pages without
  files on disk. Drafts are not emitted; unlisted members are.
- Each template's data carries `record`, `meta`, `url`, `canonical`, `unlisted`,
  `haverstackTemplate`, `title`, `body` (rendered HTML), `bodyRaw` (embed-substituted
  markdown), and, on listing roots, the resolved `collection`.
- The feeds and the sitemap (below).
- `haverstack` global data — `site`, `sites`, `owner`, `pages`, `menus`, `collections`.

The plugin's virtual templates are ordinary Eleventy pages — see
[Working with the Eleventy ecosystem](#working-with-the-eleventy-ecosystem).

## Markdown (`markdown.ts`)

A plugin-owned markdown-it instance, so record bodies render the same regardless of the
host's markdown config. Embed substitution runs **before** parsing (it rewrites link and
image targets in the source text); the result is sanitized, because a stack can hold
records written by more than one person. `format` follows the commons vocabulary:
`markdown` when absent, `plain` when set, and any unrecognised value rendered as plain —
never a richer format than the record declares.

## Feeds and the sitemap (`feeds.ts`)

Output, not records: renderings of the collections the page tree already describes, one
set per site. An Atom feed per listing root plus a combined `/feeds/all.xml`; the sitemap
is every resolved permalink minus the unlisted ones. Absolute URLs come from the site
record's `baseUrl`, so a single-site stack with no site record gets neither.

## Templates (`templates.ts`, `emit.ts`)

Three levels, in order of how much the site takes over:

1. **Nothing.** The plugin renders complete HTML documents with a small built-in set
   (`documentShell` + per-shape fragments). A stack builds a legible site with no
   template work.
2. **`templates: { base: 'haverstack-base', … }`.** Maps a `template` name to a layout
   in the site's `_includes`. A mapped page emits its content _fragment_ — `body` for
   listings, `<article>` for the rest — plus all its data, and Eleventy renders it
   through the layout, which may chain to another. `base` is the catch-all; anything
   still unmapped keeps the built-in render. `haverstack-eleventy eject` writes a
   starter `haverstack-base.njk` (nav, footer, `{{ content }}`, and a listing block) to
   `_includes` for editing — the build never writes there itself.
3. **`templates` for every name + your own layouts.** Full control; the plugin is just
   the data source.

## Working with the Eleventy ecosystem

`addTemplate` produces real templates, so most of Eleventy already applies to the
plugin's pages:

- **Transforms** run on the output — minifiers, PostCSS, Pagefind, image post-processing.
- **Global data** (`_data/*.js`) applies.
- **Filters, shortcodes, `{% include %}`, layout chaining** are available in any mapped
  layout.
- **Collections.** Every listed page and member carries `tags` — `haverstack`, the
  record's type (`article`, `page`, …), and its tag associations — so `collections.all`,
  `collections.article`, tag archives, and any plugin that reads collections (RSS,
  sitemap, related-posts) see them. Unlisted records are excluded. `eleventyCollections:
false` opts out entirely.
- **Navigation.** Pages carry root-to-leaf `eleventyNavigation` (`key`, `parent`,
  `title`, `order`), so `@11ty/eleventy-navigation` works without configuration.
- **The data cascade.** Virtual pages have no directory, so directory data files and
  `eleventyComputed` can't target them. The `pageData` hook — `(ctx) => object`, merged
  last — is the substitute.

What stays out of reach: `--serve` rebuilds are full rebuilds (content is in the stack,
not in files Eleventy can watch — see [Rebuilding on change](#rebuilding-on-change) for
how to do better), and shortcodes inside a record's markdown body aren't evaluated
(bodies are content, not templates; a layout that wants them renders `bodyRaw` through
its own pipeline).

---

## Commands

The `haverstack-eleventy` CLI. `check` and `publish` read the stack from a config module
(`--config`, default `./haverstack.config.mjs`) that default-exports a `Stack`, a
`{ stack, site? }`, or a function returning one — the same place a project builds the
stack for `eleventy.config.js`. `--site <handle>` overrides the config's site.

### `eject`

Writes a starter `haverstack-base.njk` layout into `_includes` (`--includes-dir` to
change, `--force` to overwrite) so the whole build can flow through an editable Eleventy
layout. Needs no stack. This is the only thing in the package that writes to the site's
source, and it never happens as a build side effect.

### `check`

Load + resolve, report structural problems, write and emit nothing. Safe against
production data. It reports the faults an editing tool structurally cannot catch, because
they are only defined relative to a build.

- **Failures** (exit non-zero): path collisions; two sidecars scoped to the same site for
  one record.
- **Warnings**: dangling menu targets; a menu item setting both `url` and `recordId`, or
  neither; a sidecar scoped to a site the record isn't published on; member records
  belonging to no site.
- **Info**: unlisted records built this run, with the mechanism (`unlistedAt` vs
  `hidden`); or, under a non-owner credential, that they could not be seen at all.

### `publish`

Stamps `article.url` / `post.url` with the canonical location — `baseUrl` + the resolved
permalink — for records that lack one. This is a write, so it is a separate command run
deliberately after a good build, not part of it.

- `url` absent → this site stamps it. First publish wins.
- `url` present and prefixed by this site's `baseUrl` → this site is the canonical home,
  nothing to do.
- `url` present and pointing elsewhere → another site published it first; this site
  renders `<link rel="canonical">` and does not restamp.

`--dry-run` shows what it would stamp. Idempotent. Bookmarks and photos are skipped —
their `url`, if any, isn't a canonical self-link.

---

## Access

A build that renders unlisted records needs **owner-level access** to the stack:
`includeUnlisted` is owner-only on `query()` and `subscribe()`, and no grant or
delegation conveys it. A build under a scoped, non-owner credential still succeeds; it
simply cannot see unlisted records, and every page that depends on one is missing from
the output. `load` detects this and sets `unlistedVisible: false`; `check` reports it.

**Sites are not a boundary.** Grants are type-level plus per-record; there is no
association-scoped grant. A credential that can read `article@1` can read every article
in the stack, not only the ones associated with the site it is building. For owner-run
builds — the expected case — that is fine; if one site is ever built somewhere less
trusted than another, splitting the stack is the answer, not splitting the site records.

---

## Non-goals

- **Editing.** The Haverstack CLI is the editing tool. This plugin reads.
- **Hosting.** Output is a directory. Where it goes is not this package's business.
- **Orchestrating several builds.** One config builds one site; running two is a script,
  and build order, partial failure and shared output directories belong to whoever
  deploys.
- **Being the only generator.** The types are generator-neutral by design; a Hugo or
  Astro integration reading the same stack is the point of putting structure in records.

## Deferred

- **Curated collections.** `page-meta.order` and hand-ordered listings; v1 supports only
  the commons query-based `collection` with keyword sort.
- **Rebuild avoidance** — every build is a full build; see the next section.

## Rebuilding on change

Every build today is a full one: a full query sweep, a full resolve, a full re-emit.
`--serve` redoes all of it on a poll interval or a manual restart. At personal-site
scale that is sub-second and fine. Two ways to do better, in increasing order of effort:

### A "did anything change?" gate (one-shot / CI)

`RecordFilter.updatedAt` takes a `{ after: Date }`, so a build can ask whether anything
relevant changed since last time and, if not, exit before emitting — the deploy step
then sees no diff. No server, works with `LocalAdapter`.

Sketch:

1. After a successful build, persist the **maximum `updatedAt` actually observed**
   (not `Date.now()` — a write that landed mid-build must not be skipped next time),
   alongside the set of permalinks emitted.
2. Next build, for each relevant type run
   `query({ filter: { typeId, updatedAt: { after: last }, includeDeleted: true, includeUnlisted: true } })`,
   looping the cursor as everywhere else.
3. Empty result → skip load/resolve/emit entirely.
4. Non-empty → full build, then rewrite the state file.

Things that make this subtle:

- **Query every type the build reads, not just members.** A `page-meta`, `menu`,
  `site`, or `_attachment` edit moves _that_ record's `updatedAt`, not the described
  record's.
- **Associations count** — `associate` / `dissociate` bump `version` / `updatedAt`, so a
  new `site` membership or `embed` is caught.
- **Hard deletes (purges) are not caught** — nothing is left to query. Soft deletes show
  with `includeDeleted: true`; for purges, diff the persisted permalink set against what
  now resolves, or accept that a purge needs a manual full rebuild.
- A query result carries no count, so the gate query obeys the same
  cursor-to-exhaustion rule as the load phase.

### A watching `--serve` (needs a stack server)

The plugin holds a subscription and triggers Eleventy's normal rebuild when a change
arrives. Full rebuild per change — not page-level; see the next section for why that is
the right call.

- `stack.subscribe(handler, { includeRecords: true, includeUnlisted: true, since: cursor })`.
  Persist each delivered change's `seq` and pass it back as `since` on restart, so
  changes during downtime are not missed. `onReset` means the gap could not be closed —
  fall back to a full reconcile by query.
- **This needs `APIAdapter`.** `LocalAdapter` has no `subscribeChanges`: `subscribe()`
  there only reports the calling process's own writes (and the build writes nothing),
  and `since` throws. A local file is also single-writer, so the editor and
  `eleventy --serve` cannot both hold it. So watch mode means: run a stack server —
  `localhost` is fine — with both the editor and the build connecting over the API.
  Against a bare local file, poll-and-full-rebuild or restart are the only options.
- **Eleventy's watcher only watches files.** Bridge it: on a relevant `RecordChange`,
  `touch` a sentinel file registered with `eleventyConfig.addWatchTarget`. Eleventy runs
  its normal rebuild; the plugin's fresh queries pick up the change. No sentinel is
  needed if the integration drives Eleventy programmatically instead.
- The subscription's `ChangeFilter` only narrows by `typeId` / `parentId` / `entityId` /
  `kinds` — not content or associations — so expect changes the current site does not
  care about and let the rebuild sort it out. Publishing a record (clearing
  `unlistedAt`) arrives as an ordinary `changed` event, so no special case.

### Why not page-level incremental

Re-emitting only the outputs a changed record affects needs a record → output dependency
graph, and the fan-out is wide: one changed article touches its own page, every listing
it belongs to, any menu pointing at it, every feed, the sitemap, and — for a
cross-posted record — another site's cross-links. Building and maintaining that graph is
a real project, and full rebuilds stay fast well past personal-site scale. This is worth
doing only once a stack is large enough that a full rebuild is genuinely slow.

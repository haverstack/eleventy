---
'@haverstack/eleventy': minor
---

Add the resolve phase: `resolve(index, { slugStrategy })` turns a
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

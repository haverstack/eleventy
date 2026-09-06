---
'@haverstack/eleventy': minor
---

Add the `templates` option — a site can replace the built-in templates
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

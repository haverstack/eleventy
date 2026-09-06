---
'@haverstack/eleventy': minor
---

Add asset staging, body rendering, and the emit phase — the plugin now
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

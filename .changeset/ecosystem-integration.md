---
'@haverstack/eleventy': minor
---

Make the plugin's pages first-class Eleventy content instead of an island.

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

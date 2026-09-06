# `@haverstack/eleventy`

An Eleventy plugin that builds a static site from a [Haverstack](https://github.com/haverstack/core)
stack. Records are the content source; there are no content files on disk.

> **Status:** Early development, but the whole pipeline works — load, resolve, asset
> staging, markdown, emit (pages, collections, feeds, sitemap), built-in templates that a
> site can override with its own, and the `check` / `publish` commands. See
> [`eleventy-integration.md`](../eleventy-integration.md) and
> [`site-generator-types.md`](../site-generator-types.md) for the design.

## Usage

```js
import { haverstack } from '@haverstack/eleventy';
import { LocalAdapter } from '@haverstack/adapter-local';
import { Stack } from '@haverstack/core';

export default async function (eleventyConfig) {
  const stack = await Stack.create(await LocalAdapter.open({ path: './stack.db' }));

  eleventyConfig.addPlugin(haverstack, {
    stack,
    site: 'personal',
    assetDir: '_stack-assets',
    slugStrategy: 'title',
  });
}
```

The plugin takes a `Stack`, not a URL — so a build can run against a remote server
(`APIAdapter`), a local SQLite file (`LocalAdapter`), or an in-memory stack
(`MemoryAdapter`, for tests). Whoever constructs the stack has already dealt with auth;
the plugin never handles credentials and never writes.

Out of the box it renders a legible site with its built-in templates. To use your own,
map `template` names to layouts in your `_includes`:

```js
eleventyConfig.addPlugin(haverstack, {
  stack,
  site: 'personal',
  templates: { base: 'layouts/base', listing: 'layouts/index', article: 'layouts/longform' },
});
```

A mapped page emits its content fragment (`{{ content }}`) plus `record`, `meta`, `url`,
`collection`, and the `haverstack` globals; the layout does the rest and may chain to
another. `base` catches any unmapped name; anything still unmapped keeps the built-in
render.

## Types

**Consumes** the commons publishing types — `site@1`, `page@1`, `article@1`, `post@1`,
`photo@1`, `bookmark@1` — plus `_entity@1` and `_attachment@1`.

**Owns** two sidecar types, minted under `org.haverstack.eleventy`:

| Type                                  | Role                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `org.haverstack.eleventy/page-meta@1` | Per-record, per-site overrides: `slug`, `template`, `order`, `hidden`, `draft`. Every field optional. |
| `org.haverstack.eleventy/menu@1`      | A named, ordered navigation menu belonging to one site.                                               |

`defineEleventyTypes(stack)` registers the whole set. It is idempotent and safe to call
on every build; under a non-owner credential it tolerates types that already exist.

## Commands

```
haverstack-eleventy check     load + resolve, report structural problems, write nothing
haverstack-eleventy publish   stamp article.url / post.url with the canonical location
```

Both read the stack from a config module (`--config`, default `./haverstack.config.mjs`)
that default-exports a `Stack`, a `{ stack, site? }`, or a function returning one — the
same place a project builds the stack for `eleventy.config.js`. `--site <handle>`
overrides the config's site.

`check` is read-only and safe against production data; it exits non-zero when it finds a
build failure (a path collision, conflicting sidecars). `publish` writes — run it
deliberately after a good build; `--dry-run` shows what it would stamp.

## License

[MIT](./LICENSE)

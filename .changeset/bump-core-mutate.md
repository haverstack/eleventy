---
'@haverstack/eleventy': patch
---

Bump `@haverstack/core` to `^0.31.0` and `@haverstack/commons` to `^0.25.0`.

Core 0.29.0 replaced `update()` with `mutate()`/`patchContent()`; `publish.ts`'s
single write (stamping `article.url` / `post.url`) now calls `patchContent()`.
No other core or commons change between 0.27 and 0.31 touches surface the
plugin reads or writes — `total` was already unused, native-field verbs
(`setPermissions`/`setUnlisted`/`setParent`) were never called directly, and
the stricter open-container schema rule (0.29) requires no schema change
since every `object`/`array` field this package declares already states its
interior.

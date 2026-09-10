---
'@haverstack/eleventy': patch
---

Bump `@haverstack/core` to `^0.27.0` and `@haverstack/commons` to `^0.21.0`.

Core 0.27.0 removes `total` from `QueryResult`. The load and check phases
never read it — every query already loops the cursor to exhaustion — so
this is a dependency bump only; the stale doc comments that mentioned
`total` have been reworded.

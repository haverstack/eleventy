---
'@haverstack/eleventy': minor
---

Initial package: `defineEleventyTypes(stack)` registers the commons publishing types the
integration reads (`site`, `page`, `article`, `post`, `photo`, `bookmark`) and the two
sidecar types it owns under `org.haverstack.eleventy` — `page-meta@1` (`slug`,
`template`, `order`, `hidden`, `draft`; all optional) and `menu@1`. Registration is
idempotent and tolerates a non-owner credential. Exports the schema constants, content
interfaces (`PageMeta`, `Menu`, `MenuItem`), and the association-label constants
(`for-site`, `site`, `embed`).

---
'@haverstack/eleventy': minor
---

Bump `@haverstack/core` to `^0.37.0` and `@haverstack/commons` to `^0.31.0`.

**Existing stacks must be recreated.** Core 0.35.0 stores record permissions as
associations and takes `parentId` off the version tier. The SQLite schema is
`CREATE TABLE IF NOT EXISTS` only and ships no migration, so a database written
by an older core opens and then fails on the first permission write: its
`associations` table keeps a `kind` constraint that refuses `permission` and
`anyone`, and has no `related_role` or `attachment_record_id` column.

`Permission` is gone. A record's ACL is now `AuthorityAssociation[]` — a
`permission` association whose bit is its label and whose `grantee` carries a
required `role`, or an `anyone` association spelling world-read affirmatively.
`[{ access: 'public' }]` becomes `[{ kind: 'anyone', label: 'read' }]`. The
`associations` key narrows to `DataAssociation[]`, since authority kinds now
live in the same table behind a separate key.

The plugin reads rather than writes both sets, so this is a dependency and
documentation change: no module needed a code change, and `StackRecord`'s two
projections keep an association loop from ever seeing an ACL entry. Attachment
candidates are now ordered by core's own total order (`createdAt`, then `id`)
so two uploads landing in the same millisecond stage the same way every build.

`docs/design.md § Rebuilding on change` is corrected, and the correction is the
part worth reading before building rebuild avoidance. Since 0.33–0.35 the
journal-tier ops — `associate`, `dissociate`, `permissions`, `reparent`,
`unlist`, `list` — leave `version` **and** `updatedAt` exactly where they stand.
The previously sketched `updatedAt: { after }` gate would therefore skip a
rebuild for precisely the edits this plugin cares most about: adding a record to
a site, scoping one with `for-site`, embedding an attachment, moving a page, or
publishing a draft. The gate now runs after load and fingerprints the index
(associations and permissions included) rather than asking the query layer a
question `updatedAt` can no longer answer. A watching `--serve` correspondingly
reads `RecordChange.ops`, never `version`.

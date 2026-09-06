---
'@haverstack/eleventy': patch
---

Run the per-listing-root collection queries concurrently, and download
attachments in a bounded pool of 6 rather than one at a time. No
behaviour change; noticeably faster on a build against a remote stack.

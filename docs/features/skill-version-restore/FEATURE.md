# Compare and restore skill versions

Readers compare any two stored skill versions. Admins and Open-access operators can make an older bundle the default by publishing it as a new current version.

- AC1-compare: History allows two version selections and shows differences across complete bundles, including text, binary, additions and removals. Name and description differences are visible.
- AC2-restore: The browser confirms the source and current versions, then restores the complete old bundle and metadata as a new numbered version. History remains immutable; the skill page, download and Git current bundle reflect the restored content.
- AC3-protect: Only Admin/Open can restore. The route enforces authentication, same-origin/CSRF, valid versions and expected current version. Stale restoration and missing versions fail without writes. Errors remain visible and retryable.

Confirmed user decision: restoration publishes a new current version. No schema migration or separate default pointer. No external deployment or push is part of this delivery.

# Review file differences

Admins compare the proposed complete bundle against its immutable base version before approval.

- AC1-diff: Review shows side-by-side old/new text with aligned line numbers and added/deleted highlights, including added, removed, modified and unchanged files in the tree. New proposals compare against an empty bundle.
- AC2-draft: Differences update with local edits. Removed files remain inspectable without being reintroduced. Binary changes show their status without pretending to provide a text diff.
- AC3-base: Missing or failed base loads show an error and retry; no empty-baseline fallback is presented as a valid update comparison.

The displayed baseline is the proposal base_version, never a newer current version. Default view is Differences, with an Edit file control.

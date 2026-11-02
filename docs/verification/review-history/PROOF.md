# Review and version browser journey

Done: The runner and retained PASS receipt establish completion for the recorded local candidate.
Command: `docs/verification/review-history/proof/run.sh` from the repository root.
Target: isolated production Compose, Nginx, Flask, SQLite and Git, driven through Chromium.

The runner reuses the existing Compose helpers and fake Google provider. Only Google's outer identity provider is controlled. Proposal submit/edit/approval, baseline reads, restore, CSRF, downloads, and storage are real.

The browser submits and publishes complete bundles, submits updates, navigates the review tree, edits and saves, checks old/new diff contents and status labels, selects history versions, and confirms restoration. API read-back checks immutability, authorization, stale-version failures and complete restored content. Host-side Git and SQLite reads independently verify publication. UI errors use request interception only to simulate an unavailable read or failed restore; successful mutations always reach the production app.

Maps review-file-tree AC1/AC2, review-file-diffs AC1/AC2/AC3, and skill-version-restore AC1/AC2/AC3. The runner prints criterion results and fails on any missing assertion.

Does not prove live Google, external Git remote delivery, or an existing deployed instance. Browser scenarios cover ordinary operations and failures; they do not establish load performance.

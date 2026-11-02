# Skill Registry

## Product

Skill Registry combines a small self-hosted publishing service with a compact team portal for discovering, inspecting, reviewing, and downloading agent skills.

SQLite owns skill identity, immutable versions, content, and Git-export status. A separate Git working repository is a one-way mirror that provides normal history, cloning, branching, comparison, and backup without becoming a second write authority.

## Backend outcome

An instance is configured on first run for either open full access or Google Workspace authentication. Open access has no user/admin distinction and publishes directly. Google identities from configured domains submit proposals, while configured administrators review and publish. Every accepted publication produces immutable versions and exports to local Git; remote push failure never rolls back SQLite.

## Portal outcome

A teammate signs in with Google, searches and filters the protected team catalogue, inspects complete bundles and history, downloads ZIPs, and connects Codex or Claude through Registry-owned OAuth. Proposed skills and edits enter a durable review queue. An allowlisted administrator can inspect, edit, approve, or reject them from the portal or MCP.

The portal's Library, skill details, identity, role, and review queue consume Flask as their source of truth. Frontend role state is presentation only; Flask enforces every catalogue, proposal, review, download, Git, OAuth, and MCP boundary.

## Boundaries

- No pull requests or inbound Git synchronization.
- Google OIDC is the authenticated sign-in path; open mode intentionally has no sign-in or roles.
- The administrator emails sealed during first-run setup are the Google-mode administrator authority.
- Skill Registry is the OAuth authorization server for MCP clients. Google credentials and tokens are never MCP credentials.
- Password login and manually issued access tokens do not exist. Direct publication exists only in open mode.
- Connect serves a self-hosted `npx` installer for Codex and generates a Claude plugin ZIP in the browser. Both packages combine the exact instance MCP endpoint with the `skills-registry-guide` companion and contain no credentials.
- The optional one-way remote is either GitHub.com one-click or Manual HTTPS/SSH. GitLab one-click, existing-repository adoption, pull synchronization, and provider-side deletion are not implemented.
- GitHub.com one-click creates a dedicated public GitHub App through the App Manifest flow, then creates a new repository in the account or organization chosen on GitHub. It does not require a pre-registered app or personal access token.
- No migration or compatibility layer for the former application.

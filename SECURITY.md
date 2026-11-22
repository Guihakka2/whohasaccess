# Security Policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
**Security tab > Report a vulnerability** on this repository.
You will get a reply within 7 days.

## Design guarantees

- **Read-only**: whohasaccess only sends GET requests. It cannot change, add or remove anything. The tests check this.
- The token (from `GH_TOKEN`, `GITHUB_TOKEN` or `gh auth token`) is only sent to the GitHub API host, never printed, logged or saved.
- `GITHUB_API_URL` (GitHub Enterprise) must be https. Pagination links and redirects to other hosts are not followed.
- Webhook URLs are shown as host only: their paths and query strings often contain secrets.
- Names coming from GitHub (key titles, logins) are stripped of terminal control characters before printing.
- No telemetry, zero runtime dependencies. npm releases are built by GitHub Actions with provenance; never by hand.

A token with only read scopes is enough. With a fine-grained token, give read access to "Administration", "Webhooks" and "Metadata"; for orgs, "Members" and "Organization administration" (read). Anything it can't read is listed under "Not checked".

## MCP mode

`--mcp` (for AI agents) is read-only (GET requests only), validates every argument before any request, runs the CLI without a shell, never returns the token, and labels GitHub-provided names as data so an agent does not treat them as instructions.

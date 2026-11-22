# whohasaccess

[![npm](https://img.shields.io/npm/v/@guihakka2/whohasaccess)](https://www.npmjs.com/package/@guihakka2/whohasaccess) [![CI](https://github.com/Guihakka2/whohasaccess/actions/workflows/ci.yml/badge.svg)](https://github.com/Guihakka2/whohasaccess/actions/workflows/ci.yml)

English · [Português](README.pt-BR.md) · [日本語](README.ja.md)

The contractor from last year still has admin. A deploy key with write access hasn't been used in 200 days. A webhook sends your push events over plain http. **whohasaccess** finds these in every repository you own, in seconds, without changing anything.

```bash
npx @guihakka2/whohasaccess                 # every repository you own
npx @guihakka2/whohasaccess --org my-company
npx @guihakka2/whohasaccess me/app me/site
```

```
whohasaccess  2 repositories · 3 high · 3 medium · 1 low (--all to list)

me/app
  HIGH    outside collaborator: contractor  admin access
  HIGH    deploy key (WRITE): ci deploy  added 400d ago, last used 200d ago
  HIGH    webhook: hooks.example.com  push (not https)
  MEDIUM  outside collaborator: friend  write access
  MEDIUM  pending invitation: old-invite  write access, sent 30d ago
  MEDIUM  webhook: ok.example.com  issues (last delivery 502)

  Not checked (token lacks permission): me/site: webhooks
```
<sub>Real output, run against the test suite's demo data.</sub>

It uses your existing GitHub CLI login (`gh auth login`), or `GH_TOKEN` / `GITHUB_TOKEN`.

## What it checks

| Check | High | Medium | Low (`--all`) |
|---|---|---|---|
| Outside collaborators | admin | write / maintain | read |
| Pending invitations | | older than 7 days | recent |
| Deploy keys | write key unused for `--stale` days (90) | write key in use, or read-only key unused | read-only key in use |
| Webhooks | not https, or TLS check disabled | failing or inactive | healthy |
| Org members (`--org`) | 2FA disabled | | org owners |
| GitHub Apps (`--org`) | | write access to all repos | others |

## Options

| Option | |
|---|---|
| `--org NAME` | Audit an organization and its repositories |
| `--all` | Also list low-severity items (full inventory) |
| `--fail-on L` | Exit 1 at `high` (default), `medium` or `low` |
| `--stale DAYS` | Deploy key "unused" threshold (default 90) |
| `--json` | Machine-readable output |

Exit codes: `0` nothing at the `--fail-on` level, `1` findings, `2` usage, auth or API error. Works with GitHub Enterprise through `GITHUB_API_URL`.

## Security

See [SECURITY.md](SECURITY.md). **Read-only (GET requests only)**, the token never leaves the GitHub API host and is never printed, webhook URLs are shown as host only. A read-only token is enough.

## License

MIT · Part of [Guihakka Tools](https://github.com/Guihakka2/guihakka-tools)

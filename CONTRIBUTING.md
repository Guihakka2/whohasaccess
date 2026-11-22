# Contributing

Thanks for helping! Rules that keep users safe:

1. Every change goes through a pull request reviewed by the maintainer.
2. **No new runtime dependencies** without an issue discussing it first.
3. **GET requests only.** whohasaccess must never be able to change anything on GitHub.
4. Run `npm test` before opening a PR (Node 20+). Tests use a fake local GitHub API, no token needed.
5. New check? Add it to the fake API in the tests with its expected severity.

English first for code, issues and docs. Translations (pt-BR, ja) are welcome as separate PRs.

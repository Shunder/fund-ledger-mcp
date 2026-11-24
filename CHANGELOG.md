# Changelog

## Unreleased

- Run a fictional, offline ledger over MCP stdio with `npm run demo`. Includes client configurations and recorded DeepSeek Harness Web conversations.
- Reconcile cash and reinvested dividends by platform from the ex-dividend date through settlement, including dividend receivables, confirmed units and historical replay.
- Filter transaction history by platform, status, transaction kind and either side of a conversion.

## 1.0.0 — Initial public version

- Self-hosted MCP service using Streamable HTTP and trusted local stdio.
- PostgreSQL-backed holdings, transaction history and multi-platform bookkeeping.
- OAuth authentication, user isolation, read/write scopes and confirmation previews.
- Published NAV synchronization, historical backfill and explicit missing-data states.
- Portfolio valuation, daily/monthly/yearly returns, TWR, XIRR and maximum drawdown.
- Browser management page, Docker deployment, optional scheduled synchronization, backup/restore documentation.
- 36 MCP tools and machine-readable parameter schemas.

See [known limitations](docs/USAGE.md#mvp-边界) and [test report](docs/TESTING.md). This entry describes the initial public codebase; GitHub release publication is a separate step.

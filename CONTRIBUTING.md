# Contributing / 贡献指南

欢迎提交 Bug 报告、功能建议和 Pull Request。

## Development

1. Fork the repository and create a feature branch.
2. Use Node.js 22.21+ and run `npm ci --ignore-scripts`.
3. Configure a dedicated disposable PostgreSQL test database via `TEST_DATABASE_URL`; never use production.
4. Run `npm test` (OpenSSL required). If tool schemas change, run `npm run tools` and review the generated documentation.
5. Submit a focused PR describing behavior changes, tests, and any migration or compatibility implications.

Use synthetic holdings and transaction fixtures only. Never include real account data, secrets, or private deployment endpoints in issues, screenshots, tests or commits.

For changes to accounting, preserve Decimal precision, distinguish official NAV from estimates, handle incomplete data explicitly, and test cash flows and transaction replay. For authentication changes, test user isolation and read/write scope enforcement.

See [design](docs/DESIGN.md), [testing](docs/TESTING.md), and [security policy](SECURITY.md). Contributions are subject to the repository's MIT license.

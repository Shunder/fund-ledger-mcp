# Security Policy / 安全政策

## Supported versions

Security fixes target the latest maintained version on the default branch. Deployments should use current dependencies and follow the deployment documentation.

## Reporting a vulnerability

Please use the repository's [private vulnerability reporting page](https://github.com/Shunder/fund-ledger-mcp/security/advisories/new) if enabled. If private reporting is unavailable, open an issue asking for a private reporting channel **without disclosing the vulnerability details**.

Do not publish credentials, database URLs, OAuth tokens, actual holdings, transaction exports, or production logs. Use a minimal reproduction with synthetic data. Include affected version, reproduction steps, expected behavior and impact.

## Deployment checklist

- Use HTTPS, a dedicated PostgreSQL database/role, and verified TLS for public database connections.
- Configure an OAuth subject allowlist and least-privilege scopes.
- Keep deployment secrets outside Git; use protected environments and trusted deployment branches.
- Keep private ledger backups encrypted and access-controlled.
- Review public CI logs and avoid production data in tests or diagnostics.
- If a credential is exposed, revoke/rotate it immediately; removing it from Git alone is insufficient.

This project is designed for self-hosted personal bookkeeping, not a hosted financial service. See [security architecture](docs/DESIGN.md).

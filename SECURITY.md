# Security Policy

## Scope and authority

This repository is a read-only/quote-only Suwappu perps risk monitor. Its commands can read market data and positions, request an indicative quote, derive risk metrics, and persist local alert state.

It does **not** contain a Hyperliquid signing key path, order-placement command, open/close endpoint, transaction signer, or broadcast path. Adding any of those would be a separate security/authority review, not a routine feature.

Treat these as sensitive even though the monitor does not execute trades:

- `SUWAPPU_API_KEY`;
- customer watchlists and alert thresholds;
- alert history and delivery endpoints;
- webhook credentials in a downstream product.

The local watch state contains wallet/market/rule metadata but no API key. State directories are created mode `0700` and files/locks mode `0600` on supported Unix filesystems.

## Report a vulnerability

Do not open a public issue for a security report.

- Use GitHub Private Vulnerability Reporting if it is enabled for this repository, or
- email `security@suwappu.bot`.

Include the affected version/commit, reproduction steps, impact, and any suggested mitigation.

Issues in this repository's CLI, state handling, container, dependencies, or CI belong here. Issues in the Suwappu API, shared SDKs, custody infrastructure, or other core services should be reported through the [Suwappu core security policy](https://github.com/0xSoftBoi/suwappubot/security/policy).

We intentionally do not publish response-time promises or legal safe-harbor terms here that have not been established as an operating commitment. Coordinate testing with the security contact when it may affect real users or service availability.

## Operator guidance

- Never commit `.env`, API keys, wallet private keys, or webhook secrets.
- Use a secret manager in hosted deployments and rotate exposed credentials.
- Mount persistent state only where the runtime user needs access.
- Do not run two writers against the same local state directory; the lock is single-node coordination, not a distributed lock.
- Keep `SUWAPPU_API_EVENTS` metadata-only if you forward it to central logging.
- Reconcile `not_returned` decisions rather than automatically interpreting them as a closed/recovered position.
- Review dependency and CodeQL findings before release.

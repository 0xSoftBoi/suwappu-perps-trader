# Contributing

Thanks for improving the Suwappu perps risk monitor.

## Design rules

1. Keep the default product read/quote-only. Signing, order placement, and transaction broadcast require a separate authority/security design.
2. Treat missing or contradictory risk evidence as unknown; do not normalize it into “safe.”
3. Keep network retries bounded. Never add automatic retries to a request unless its contract is explicitly safe/idempotent.
4. Do not log credentials, wallet-bearing URLs/query strings, request/response bodies, or raw upstream exception text in operational telemetry.
5. Keep local state single-writer and fail closed on corrupt state.
6. Separate customer value/product economics from customer trading performance.

## Verify a change

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
./dist/suwappu-perps --help

python -m py_compile trader.py risk.py
python -m unittest discover -s tests -p 'test_*.py'
```

If you change the container or runtime defaults, also verify `docker run --network none ... --help` and a non-root UID. If you change the JSON schema, state machine, thresholds, or authority model, update `README.md`, `BUILDING_A_PRODUCT.md`, `docs/OPERATIONS.md`, tests, and `CHANGELOG.md` in the same pull request.

## Pull requests

Explain the user outcome, authority change (if any), failure behavior, and tests. Small, reviewable changes are preferred. Security-sensitive findings should follow `SECURITY.md` rather than a public issue.

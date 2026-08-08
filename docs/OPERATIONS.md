# Operations

This runbook covers the standalone TypeScript monitor. It is deliberately smaller than a multi-tenant SaaS runbook.

## Runtime contract

- Bun: 1.3.14 or newer compatible runtime; CI and image pin 1.3.14.
- Default command: `--help` (no network or credential required).
- Authenticated commands: `quote`, `positions`, `risk`, `watch` require `SUWAPPU_API_KEY`.
- Persistent path: `SUWAPPU_PERPS_STATE_DIR` (container default `/data/state`).
- One active writer per state directory.
- Exit status `0` means the evaluation ran, including when a warning transition exists. Alerts are data, not process failures.

## Recommended scheduler pattern

Run one `watch --json` process per poll interval and parse the `notifications` array. Do not keep overlapping invocations alive against the same state directory.

Example:

```bash
suwappu-perps watch \
  --address "$HL_ADDRESS" \
  --warn-within 10 \
  --hysteresis 2 \
  --json
```

Persist the state volume across restarts. Back it up before moving the workload; restoring an older state can legitimately replay transitions, so downstream delivery should still use idempotent event handling.

## Signals to monitor

With `SUWAPPU_API_EVENTS=1`, stderr emits only:

```json
{"event":"suwappu.api","operation":"perps.positions","outcome":"ok","attempt":1,"durationMs":123,"status":200}
```

Aggregate operation/status/outcome and latency. Alert on sustained authentication failures, rate limiting, provider 5xx responses, increasing retry rate, stale scheduler runs, and delivery-queue failures in your downstream service.

Do not add wallet addresses, query strings, API keys, response bodies, or exception dumps to these events.

## Failure behavior

| Failure | Monitor behavior | Operator action |
|---|---|---|
| 408/429/5xx or transport failure on GET | bounded retry | inspect provider health/rate limits if sustained |
| quote request failure | no automatic retry | decide/retry explicitly; quote is non-idempotent in current MCP contract |
| invalid API response | fail evaluation | investigate contract/provider drift |
| corrupt watch state | fail closed | restore known-good state or inspect before deliberate reset |
| existing lock | refuse second writer | find the live owner; do not blindly delete the lock |
| liquidation evidence unavailable | `insufficient_data`, preserve prior state | investigate source data; do not assume safe |
| alerted position not returned | one `not_returned` notification, preserve active state | reconcile position/venue state before clearing alert |

## State recovery

There is no automatic stale-lock deletion. If a process was forcibly terminated and left a lock behind:

1. prove no writer is still using the same state directory;
2. inspect and back up `watch-state.json`;
3. remove only that specific orphaned `watch.lock` using your normal operations process;
4. run one manual `watch --json` evaluation and inspect the decisions before restoring the schedule.

Never interpret a state reset as evidence that market risk reset.

## Release check

Before deployment:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
./dist/suwappu-perps --help
bun audit --audit-level=high
python -m pip install -r requirements.txt
python -m pip install pip-audit
python -m py_compile trader.py risk.py
python -m unittest discover -s tests -p 'test_*.py'
pip-audit -r requirements.txt
docker build -t suwappu-perps .
docker run --rm --network none suwappu-perps --help
```

Also require both dependency audits and the SARIF-gated TypeScript/Python CodeQL checks to be green in GitHub Actions.

## Multi-replica boundary

Do not scale this JSON state volume horizontally. Move to a transactional shared state store plus an outbox/queue first. Add tenant isolation, idempotent delivery, backup/restore, SSO/RBAC, audit history, and measured SLOs before calling a shared hosted deployment enterprise-ready.

# Build a Perps Risk Product on Suwappu

The defensible product here is not “a bot that makes money.” It is reliable monitoring: convert read-only position evidence into an alert a customer can trust, route it to the right person, preserve why it fired, and prove delivery.

Version 2 ships the first meaningful slice of that product as `watch`.

## Start with one paid outcome

Use a narrow promise:

> Tell me when a monitored position crosses my configured liquidation-distance rule, without repeating the same alert every poll.

That outcome is observable. It does not claim to predict liquidation or customer profit.

Activation should therefore be measured as:

```text
real wallet read → saved rule → evidence-bearing watch evaluation → delivered transition
```

Repository stars, raw API calls, and customer trading P&L are not substitutes for that funnel.

## What the standalone monitor already provides

`watch` persists a rule-specific state for each `(wallet, market, side, warning threshold, recovery threshold)` and emits:

- `warning` once when the returned liquidation distance enters the configured risk region;
- `recovered` once after the distance crosses the configured hysteresis boundary;
- `insufficient_data` without changing prior state when liquidation evidence is unavailable;
- `not_returned` when a previously observed position disappears from a successful position read, without pretending that absence proves recovery;
- `unchanged` on ordinary polls, with `shouldNotify: false`.

This solves transition dedupe on one node. Delivery, acknowledgement, reminders, and multi-tenant storage are deliberately separate concerns.

## Product ladder

| Stage | Customer outcome | Product work | Sensible meter |
|---|---|---|---|
| Explorer | “Show me risk now.” | market/position/risk reads | Free/onboarding |
| Alerts | “Tell me when a rule changes.” | durable watch + email/webhook/pager | monitored wallets or active rules |
| Workspace | “Let our team operate this.” | tenants, notes, ack/snooze, history | seats + wallets |
| API | “Feed risk into our systems.” | stable API, webhooks, quotas, exports, delivery logs | usage + platform fee |
| Enterprise | “Run this under controls.” | SSO/RBAC, audit, HA, backups, SLO, retention | contract |
| Execution handoff | “Let an approved operator act.” | separate connector, approval, reconciliation | separate product/authority |

Charge for capabilities you actually operate. Never market user trading returns as your product revenue.

## Polling economics

One standalone risk/watch evaluation currently performs:

```text
1 × positions(address) + 1 × markets
```

A multi-wallet service should share the market read within a poll cycle. At 100 wallets and one evaluation per minute:

```text
naive      = 100 × 2 × 1,440 = 288,000 HTTP reads/day
shared     = (100 + 1) × 1,440 = 145,440 HTTP reads/day
saved      = 142,560 reads/day
```

Those are request counts, **not** a claim about current Suwappu billing. Convert them to dollars only with the pricing and unit costs that actually apply to your account.

For a paid service, model contribution separately from customer trading:

```text
monthly realized revenue
  = subscription + usage revenue - discounts - refunds

monthly variable cost
  = Suwappu/API usage
  + notification delivery
  + storage/retention
  + variable compute/egress
  + variable support burden

contribution margin
  = monthly realized revenue - monthly variable cost

contribution margin per monitored wallet
  = contribution margin / average paid monitored wallets
```

Do not call gross receipts “profit,” and do not infer willingness to pay from alert volume alone.

## Delivery is a second state machine

The CLI tells you **what changed**. A paid service still needs to guarantee what happened to the notification.

For every emitted transition, persist a durable event ID and delivery state such as:

```text
pending → attempting → delivered
                    ↘ retryable_failure
                    ↘ terminal_failure
```

Use an outbox/queue so a process crash between saving risk state and sending a webhook cannot silently lose a transition. Give downstream webhooks an idempotency/event key so retries do not become duplicate pages.

Acknowledgement and snooze belong to this delivery/workflow layer—not to the raw risk calculation.

## Snapshot and evidence semantics

Store enough evidence to explain an alert later:

- source wallet, market, and side;
- raw returned mark and liquidation prices;
- derived distance and threshold version;
- local observation/computation time;
- API/provider contract version when your service has one;
- decision state and durable event ID.

Remember the boundaries:

- market and position values are independent reads, not an atomic exchange snapshot;
- `liquidationPrice: 0` is unavailable, not a valid zero-dollar liquidation price;
- reported liquidation is monitoring evidence, not a liquidation guarantee;
- `fundingRate` is current market context, not accrued funding P&L;
- quote entry/liquidation/fee values are indicative and do not guarantee a fill.

## Multi-tenant graduation

The local JSON state is deliberately single-node. Before selling a multi-replica enterprise service, replace it with a transactional store whose primary key includes tenant ownership.

Minimum control plane:

- tenant-scoped watchlists, rule state, delivery endpoints, and history;
- database authorization that does not trust a caller-supplied tenant ID by itself;
- encryption in transit and at rest according to your operating requirements;
- secret-manager-backed Suwappu/webhook credentials with rotation;
- SSO/RBAC for team access and privileged changes;
- immutable/auditable rule and destination changes;
- transactional alert outbox and idempotent delivery workers;
- backups plus a tested restore procedure;
- documented retention/deletion policy;
- service health, queue-age, failed-delivery, stale-data, and provider-rate-limit metrics;
- defined SLOs only after you have measured the system you can actually operate.

Do not advertise an uptime or response-time SLA merely because the repository has health checks.

## Privacy and abuse resistance

A wallet address can be public while a customer's watchlist, thresholds, alert history, team membership, and webhook endpoints are private customer data.

At minimum:

- isolate every record by authenticated tenant;
- avoid API keys, bearer tokens, webhook secrets, full request bodies, and exception dumps in logs;
- rate-limit bulk watchlist imports and expensive polling patterns;
- validate webhook destinations to reduce SSRF risk;
- sign outbound webhooks and rotate signing secrets;
- cap retention rather than accumulating risk history forever by default.

The standalone CLI's `SUWAPPU_API_EVENTS=1` mode is intentionally metadata-only for this reason.

## When to move closer to Hyperliquid

Suwappu gives the product a small read/quote authority surface plus REST/SDK/MCP interfaces. Hyperliquid's direct surface is broader.

Use Hyperliquid's documented [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) when a polling product can no longer meet your latency/cost target. Review the venue's current [rate and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits) as part of capacity planning.

If you need signing/execution, use the venue's official [Python SDK](https://github.com/hyperliquid-dex/hyperliquid-python-sdk) or another explicitly reviewed execution connector—but put it behind a new authority boundary.

Execution should require a durable intent, explicit approval/policy decision, idempotency strategy, and post-timeout reconciliation. A read-only alert acknowledgement must never become implicit permission to trade.

## Enterprise readiness checklist

The repository is a strong standalone primitive when all of these stay true:

- [x] no execution/signing authority;
- [x] bounded read retries/timeouts and no blind quote retry;
- [x] schema checks on Suwappu responses;
- [x] transition dedupe + hysteresis;
- [x] corrupt-state fail-closed behavior and exclusive local ownership;
- [x] non-root container and zero-network default startup;
- [x] reproducible dependency install, tests, audit, and CodeQL;
- [x] metadata-only optional telemetry;
- [ ] transactional multi-tenant state;
- [ ] durable delivery outbox and replay;
- [ ] SSO/RBAC and tenant audit log;
- [ ] backup/restore drills and measured SLOs;
- [ ] documented incident/on-call process for the deployed service.

The unchecked items are not “TODOs hidden in a demo.” They are the line between this standalone product primitive and a shared enterprise SaaS control plane.

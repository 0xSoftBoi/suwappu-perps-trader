# Build a Perps Risk Product on Suwappu

This repository is most valuable as a starting point for a monitoring product, not as an unfinished trading bot. The current Suwappu perps Agent API is read/quote only, which gives you a useful least-authority boundary for customer-facing research and alerts.

## Start with one sellable outcome

The strongest first outcome is simple: “tell me when one of the wallets I monitor needs attention.”

The `risk` command already turns raw positions into the basic facts a product needs:

- open-position count;
- absolute notional and margin;
- unrealized P&L;
- directional distance from the reported mark to the reported liquidation price;
- leverage utilization against returned market metadata;
- explicit warnings when a metric cannot be computed safely.

Do not sell the derived numbers as a prediction of liquidation. Sell the workflow: monitoring, routing, history, collaboration, and reliable notification.

## Product ladder

| Stage | Customer value | What you add |
|---|---|---|
| Explorer | “What is open right now?” | markets, positions, JSON export |
| Alerts | “Tell me when risk changes.” | thresholds, dedupe, hysteresis, email/webhook delivery |
| Workspace | “Monitor our wallets together.” | wallet ownership, teams, history, notes, incident state |
| API | “Feed this into our systems.” | stable snapshot schema, API keys, quotas, webhooks, delivery logs |
| Execution handoff | “Let an approved operator act.” | a separate integration and explicit authority boundary |

Charge for the product value you actually operate: monitored wallets, alerting, history, collaboration, exports, API access, or service guarantees. Do not present customer trading P&L as your product revenue.

## Alert state is the product

A cron job that sends the same warning every minute is a demo. A paid alerting product needs durable state.

For every `(customer, wallet, position, rule_version)` keep at least:

- last observed risk state;
- first-triggered and last-observed timestamps;
- last notification timestamp and delivery result;
- acknowledgement/snooze state;
- the threshold/rule version that produced the alert.

Use hysteresis so normal price noise does not flap alerts. For example, a customer might configure a trigger at a 10% reported liquidation buffer and a recovery threshold at 12%. Those numbers are an example of state-machine behavior, not a recommended risk policy.

Notify on transitions (`healthy → warning`, `warning → recovered`), not on every poll. Add a separate reminder cadence only when the customer asks for it.

## Polling and request economics

The standalone `risk` command performs two Suwappu reads for one wallet: `perps.positions(address)` and `perps.markets()`.

In a service, share market metadata across wallets within the same poll cycle. With 100 wallets polled once per minute:

- naive per-wallet composition: `100 × 2 × 1,440 = 288,000` API reads/day;
- one shared markets read per cycle: `(100 + 1) × 1,440 = 145,440` API reads/day.

Those are request counts, not a claim about Suwappu billing. Convert them into money only with your actual current unit costs and tier terms.

Model the business separately from customer trading performance:

```text
monthly product revenue
  = paid seats × realized subscription revenue per seat

monthly variable cost
  = Suwappu/API usage + notification delivery + storage + variable compute

contribution margin
  = monthly product revenue - monthly variable cost

break-even seats
  = monthly fixed operating cost / contribution margin per seat
```

Track failed deliveries, support time, refunds, and data-retention cost too. “Our users made money” is not a substitute for product gross margin.

## Snapshot semantics

Treat the risk object as a derived observation:

- `computedAt` is local client time;
- positions and markets are independent reads, so the combined object is not atomic;
- `liquidationPrice: 0` means unavailable on the current Suwappu path;
- `fundingRate` is currently a placeholder zero and must not drive funding alerts;
- quote entry/liquidation values are indicative and do not model order-book slippage or a guaranteed fill.

Persist the raw inputs alongside derived alert facts when you need an audit trail. That makes later rule changes explainable.

## Ownership and privacy

A wallet address may be public on-chain, but a customer's watchlist and alert history are still customer data. In a multi-tenant product:

- scope watchlists and alert state to the authenticated tenant;
- never use a user-supplied tenant ID as the authorization decision by itself;
- rate-limit bulk watchlist imports and polling;
- avoid logging API keys or full webhook secrets;
- keep delivery endpoints tenant-scoped and verify webhook ownership.

## Execution is a different authority class

The current example does not execute perps trades. Keep it that way unless you intentionally build a separate connector.

If you later add execution through Hyperliquid or another venue, require a new approval boundary and durable intent record. A network timeout on a money-moving request is ambiguous; reconcile venue state before retrying. Never turn a read-only alert acknowledgement into implicit trade approval.

## When to use Hyperliquid directly

Hyperliquid's official [API docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api) and [Python SDK](https://github.com/hyperliquid-dex/hyperliquid-python-sdk) expose much more venue-native capability than this repository, including trading flows. Hyperliquid's docs also recommend its [WebSocket API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket) for realtime data.

Use those direct surfaces when your product needs low-latency streaming, full venue metadata, signing, or execution. The advantage of Suwappu here is different: a smaller, agent-friendly read/quote boundary with hosted MCP and consistent application-facing primitives.

That boundary is a feature only if the product makes it explicit.

## What to measure after launch

Avoid vanity metrics such as repository stars alone. Measure the funnel that predicts a useful product:

1. developer reaches a successful `markets` or `risk` response;
2. developer saves a real wallet to monitor;
3. at least one alert rule is created;
4. a notification is delivered and acknowledged;
5. the customer is still monitoring wallets in later weeks;
6. paid product revenue exceeds the variable cost of serving those customers.

For the open-source example itself, optimize time-to-first-success, copy/paste accuracy, failure clarity, and the percentage of builders who move from a raw read to a durable product workflow.

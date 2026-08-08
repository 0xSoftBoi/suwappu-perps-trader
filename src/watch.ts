import { createHash } from "node:crypto";
import type { PositionRisk } from "./risk.js";
import type { WatchState, WatchStateEntry } from "./state.js";

export interface WatchRule {
  address: string;
  warnWithinPct: number;
  recoverAbovePct: number;
}

export interface WatchDecision {
  key: string;
  market: string;
  side: "long" | "short";
  state: "warning" | "recovered" | "unchanged" | "insufficient_data" | "not_returned";
  shouldNotify: boolean;
  reason: string;
  liquidationDistancePct: number | null;
}

function normalizePercentage(value: number): number {
  const scale = 1_000_000;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function validateWatchRule(rule: WatchRule): WatchRule {
  if (!Number.isFinite(rule.warnWithinPct) || rule.warnWithinPct <= 0) {
    throw new Error("--warn-within must be a positive percentage");
  }
  if (!Number.isFinite(rule.recoverAbovePct) || rule.recoverAbovePct <= rule.warnWithinPct) {
    throw new Error("recovery threshold must be greater than --warn-within");
  }
  const normalized = {
    ...rule,
    warnWithinPct: normalizePercentage(rule.warnWithinPct),
    recoverAbovePct: normalizePercentage(rule.recoverAbovePct),
  };
  if (normalized.recoverAbovePct <= normalized.warnWithinPct) {
    throw new Error("recovery threshold must be greater than --warn-within at 6-decimal precision");
  }
  return normalized;
}

export function watchKey(rule: WatchRule, market: string, side: "long" | "short"): string {
  const normalized = validateWatchRule(rule);
  const identity = JSON.stringify({
    address: normalized.address.toLowerCase(),
    market,
    side,
    warnWithinPct: normalized.warnWithinPct,
    recoverAbovePct: normalized.recoverAbovePct,
  });
  return createHash("sha256").update(identity).digest("hex");
}

function entryFor(
  rule: WatchRule,
  position: PositionRisk,
  active: boolean,
  previous: WatchStateEntry | undefined,
  observedAt: string,
  transitioned: boolean,
): WatchStateEntry {
  return {
    active,
    missing: false,
    address: rule.address.toLowerCase(),
    market: position.market,
    side: position.side,
    warnWithinPct: rule.warnWithinPct,
    recoverAbovePct: rule.recoverAbovePct,
    lastObservedAt: observedAt,
    lastTransitionAt: transitioned ? observedAt : previous?.lastTransitionAt ?? null,
    missingSince: null,
  };
}

export function evaluatePosition(
  position: PositionRisk,
  rule: WatchRule,
  previous: WatchStateEntry | undefined,
  now = new Date(),
): { decision: WatchDecision; nextEntry: WatchStateEntry | null } {
  const normalizedRule = validateWatchRule(rule);
  const key = watchKey(normalizedRule, position.market, position.side);
  const observedAt = now.toISOString();
  const distance = position.liquidationDistancePct;
  if (distance === null || !Number.isFinite(distance)) {
    return {
      decision: {
        key,
        market: position.market,
        side: position.side,
        state: "insufficient_data",
        shouldNotify: false,
        reason: "reported liquidation distance is unavailable; prior alert state is preserved",
        liquidationDistancePct: null,
      },
      nextEntry: previous
        ? {
            ...previous,
            missing: false,
            lastObservedAt: observedAt,
            missingSince: null,
          }
        : null,
    };
  }

  const wasActive = previous?.active ?? false;
  const active = wasActive
    ? distance < normalizedRule.recoverAbovePct
    : distance <= normalizedRule.warnWithinPct;
  const activated = active && !wasActive;
  const recovered = !active && wasActive;
  const nextEntry = entryFor(
    normalizedRule,
    position,
    active,
    previous,
    observedAt,
    activated || recovered,
  );

  if (activated) {
    return {
      decision: {
        key,
        market: position.market,
        side: position.side,
        state: "warning",
        shouldNotify: true,
        reason: `liquidation distance crossed at or below ${normalizedRule.warnWithinPct}%`,
        liquidationDistancePct: distance,
      },
      nextEntry,
    };
  }
  if (recovered) {
    return {
      decision: {
        key,
        market: position.market,
        side: position.side,
        state: "recovered",
        shouldNotify: true,
        reason: `liquidation distance reached the ${normalizedRule.recoverAbovePct}% recovery boundary`,
        liquidationDistancePct: distance,
      },
      nextEntry,
    };
  }
  return {
    decision: {
      key,
      market: position.market,
      side: position.side,
      state: "unchanged",
      shouldNotify: false,
      reason: active ? "risk rule remains active" : "risk rule remains inactive",
      liquidationDistancePct: distance,
    },
    nextEntry,
  };
}

export function evaluateWatch(
  positions: PositionRisk[],
  ruleInput: WatchRule,
  state: WatchState,
  now = new Date(),
): { decisions: WatchDecision[]; nextState: WatchState } {
  const rule = validateWatchRule(ruleInput);
  const nextState: WatchState = { version: 1, watches: { ...state.watches } };
  const decisions: WatchDecision[] = [];
  const observedKeys = new Set<string>();

  for (const position of positions) {
    const key = watchKey(rule, position.market, position.side);
    observedKeys.add(key);
    const previous = state.watches[key];
    const evaluated = evaluatePosition(position, rule, previous, now);
    decisions.push(evaluated.decision);
    if (evaluated.nextEntry) nextState.watches[key] = evaluated.nextEntry;
  }

  const checkedAt = now.toISOString();
  for (const [key, previous] of Object.entries(state.watches)) {
    const sameRule =
      previous.address === rule.address.toLowerCase() &&
      previous.warnWithinPct === rule.warnWithinPct &&
      previous.recoverAbovePct === rule.recoverAbovePct;
    if (!sameRule || observedKeys.has(key)) continue;

    const firstMissing = !previous.missing;
    nextState.watches[key] = {
      ...previous,
      missing: true,
      missingSince: previous.missingSince ?? checkedAt,
    };
    decisions.push({
      key,
      market: previous.market,
      side: previous.side,
      state: "not_returned",
      shouldNotify: previous.active && firstMissing,
      reason: previous.active
        ? "previously alerted position is no longer returned; do not infer recovery without reconciliation"
        : "previously observed position is no longer returned",
      liquidationDistancePct: null,
    });
  }

  return { decisions, nextState };
}

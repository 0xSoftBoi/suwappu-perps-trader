"""Pure, read-only risk metrics for the Suwappu perps example."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Mapping, Sequence


@dataclass(frozen=True)
class PositionInput:
    id: str
    market: str
    side: str
    size: float
    leverage: float
    entry_price: float
    mark_price: float
    margin: float
    unrealized_pnl: float
    liquidation_price: float
    funding_rate: float | None = None


def _rounded(value: float, digits: int = 6) -> float:
    return round(value, digits)


def validate_warning_threshold(value: float) -> float:
    if not math.isfinite(value) or value <= 0:
        raise ValueError("--warn-within must be a positive percentage")
    return value


def build_position_risk(
    position: PositionInput,
    market_max_leverage: float | None,
    warn_within_pct: float,
) -> dict[str, object]:
    validate_warning_threshold(warn_within_pct)
    warnings: list[str] = []

    mark_price = position.mark_price if math.isfinite(position.mark_price) else 0.0
    liquidation_price = (
        position.liquidation_price
        if math.isfinite(position.liquidation_price) and position.liquidation_price > 0
        else None
    )
    notional_usd = abs(position.size) * max(mark_price, 0.0)
    pnl_on_margin_pct = (
        position.unrealized_pnl / position.margin * 100
        if math.isfinite(position.margin) and position.margin > 0
        else None
    )

    liquidation_distance_pct: float | None = None
    if liquidation_price is None:
        warnings.append("liquidation price unavailable")
    elif mark_price <= 0:
        warnings.append("mark price unavailable; liquidation buffer cannot be computed")
    else:
        if position.side == "long":
            liquidation_distance_pct = (mark_price - liquidation_price) / mark_price * 100
        else:
            liquidation_distance_pct = (liquidation_price - mark_price) / mark_price * 100

        if liquidation_distance_pct <= 0:
            warnings.append("liquidation price is at or beyond the reported mark")
        elif liquidation_distance_pct <= warn_within_pct:
            warnings.append(
                f"liquidation buffer {_rounded(liquidation_distance_pct, 2):g}% "
                f"is within {_rounded(warn_within_pct, 2):g}% threshold"
            )

    leverage_utilization_pct: float | None = None
    if (
        market_max_leverage is None
        or not math.isfinite(market_max_leverage)
        or market_max_leverage <= 0
    ):
        warnings.append("market leverage metadata unavailable")
    else:
        leverage_utilization_pct = position.leverage / market_max_leverage * 100
        if leverage_utilization_pct > 100:
            warnings.append(
                f"reported leverage {position.leverage:g}x exceeds returned market maximum "
                f"{market_max_leverage:g}x"
            )

    return {
        "id": position.id,
        "market": position.market,
        "side": position.side,
        "size": position.size,
        "leverage": position.leverage,
        "markPrice": _rounded(mark_price),
        "liquidationPrice": (
            None if liquidation_price is None else _rounded(liquidation_price)
        ),
        "notionalUsd": _rounded(notional_usd),
        "marginUsd": _rounded(position.margin),
        "unrealizedPnlUsd": _rounded(position.unrealized_pnl),
        "fundingRate": (
            None
            if position.funding_rate is None or not math.isfinite(position.funding_rate)
            else _rounded(position.funding_rate)
        ),
        "pnlOnMarginPct": (
            None if pnl_on_margin_pct is None else _rounded(pnl_on_margin_pct)
        ),
        "liquidationDistancePct": (
            None
            if liquidation_distance_pct is None
            else _rounded(liquidation_distance_pct)
        ),
        "leverageUtilizationPct": (
            None
            if leverage_utilization_pct is None
            else _rounded(leverage_utilization_pct)
        ),
        "warnings": warnings,
    }


def build_risk_snapshot(
    address: str,
    positions: Sequence[PositionInput],
    market_max_by_name: Mapping[str, float],
    warn_within_pct: float,
    computed_at: str | None = None,
) -> dict[str, object]:
    warn_within_pct = validate_warning_threshold(warn_within_pct)
    position_risks = [
        build_position_risk(
            position,
            market_max_by_name.get(position.market),
            warn_within_pct,
        )
        for position in positions
    ]
    distances = [
        value
        for item in position_risks
        if (value := item["liquidationDistancePct"]) is not None
    ]

    return {
        "address": address,
        "computedAt": computed_at
        or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        ),
        "warnWithinPct": _rounded(warn_within_pct),
        "positionCount": len(position_risks),
        "totals": {
            "notionalUsd": _rounded(
                sum(float(item["notionalUsd"]) for item in position_risks)
            ),
            "marginUsd": _rounded(
                sum(float(item["marginUsd"]) for item in position_risks)
            ),
            "unrealizedPnlUsd": _rounded(
                sum(float(item["unrealizedPnlUsd"]) for item in position_risks)
            ),
        },
        "nearestLiquidationDistancePct": (
            _rounded(min(float(value) for value in distances)) if distances else None
        ),
        "warningCount": sum(len(item["warnings"]) for item in position_risks),
        "positions": position_risks,
    }

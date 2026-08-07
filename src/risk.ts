export interface PerpsMarketView {
  name: string;
  maxLeverage: number;
}

export interface PerpsPositionView {
  id: string;
  market: string;
  side: "long" | "short";
  size: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  margin: number;
  unrealizedPnl: number;
  liquidationPrice: number;
}

export interface PositionRisk {
  id: string;
  market: string;
  side: "long" | "short";
  size: number;
  leverage: number;
  markPrice: number;
  liquidationPrice: number | null;
  notionalUsd: number;
  marginUsd: number;
  unrealizedPnlUsd: number;
  pnlOnMarginPct: number | null;
  liquidationDistancePct: number | null;
  leverageUtilizationPct: number | null;
  warnings: string[];
}

export interface PerpsRiskSnapshot {
  address: string;
  computedAt: string;
  warnWithinPct: number;
  positionCount: number;
  totals: {
    notionalUsd: number;
    marginUsd: number;
    unrealizedPnlUsd: number;
  };
  nearestLiquidationDistancePct: number | null;
  warningCount: number;
  positions: PositionRisk[];
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function validateWarningThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("--warn-within must be a positive percentage");
  }
  return value;
}

export function buildPositionRisk(
  position: PerpsPositionView,
  market: PerpsMarketView | undefined,
  warnWithinPct: number,
): PositionRisk {
  validateWarningThreshold(warnWithinPct);

  const warnings: string[] = [];
  const markPrice = Number.isFinite(position.markPrice) ? position.markPrice : 0;
  const liquidationPrice =
    Number.isFinite(position.liquidationPrice) && position.liquidationPrice > 0
      ? position.liquidationPrice
      : null;

  const notionalUsd = Math.abs(position.size) * Math.max(markPrice, 0);
  const pnlOnMarginPct =
    Number.isFinite(position.margin) && position.margin > 0
      ? (position.unrealizedPnl / position.margin) * 100
      : null;

  let liquidationDistancePct: number | null = null;
  if (liquidationPrice === null) {
    warnings.push("liquidation price unavailable");
  } else if (markPrice <= 0) {
    warnings.push("mark price unavailable; liquidation buffer cannot be computed");
  } else {
    liquidationDistancePct =
      position.side === "long"
        ? ((markPrice - liquidationPrice) / markPrice) * 100
        : ((liquidationPrice - markPrice) / markPrice) * 100;

    if (liquidationDistancePct <= 0) {
      warnings.push("liquidation price is at or beyond the reported mark");
    } else if (liquidationDistancePct <= warnWithinPct) {
      warnings.push(
        `liquidation buffer ${round(liquidationDistancePct, 2)}% is within ${round(warnWithinPct, 2)}% threshold`,
      );
    }
  }

  let leverageUtilizationPct: number | null = null;
  if (!market || !Number.isFinite(market.maxLeverage) || market.maxLeverage <= 0) {
    warnings.push("market leverage metadata unavailable");
  } else {
    leverageUtilizationPct = (position.leverage / market.maxLeverage) * 100;
    if (leverageUtilizationPct > 100) {
      warnings.push(
        `reported leverage ${position.leverage}x exceeds returned market maximum ${market.maxLeverage}x`,
      );
    }
  }

  return {
    id: position.id,
    market: position.market,
    side: position.side,
    size: position.size,
    leverage: position.leverage,
    markPrice: round(markPrice),
    liquidationPrice: liquidationPrice === null ? null : round(liquidationPrice),
    notionalUsd: round(notionalUsd),
    marginUsd: round(position.margin),
    unrealizedPnlUsd: round(position.unrealizedPnl),
    pnlOnMarginPct: pnlOnMarginPct === null ? null : round(pnlOnMarginPct),
    liquidationDistancePct:
      liquidationDistancePct === null ? null : round(liquidationDistancePct),
    leverageUtilizationPct:
      leverageUtilizationPct === null ? null : round(leverageUtilizationPct),
    warnings,
  };
}

export function buildRiskSnapshot(options: {
  address: string;
  positions: PerpsPositionView[];
  markets: PerpsMarketView[];
  warnWithinPct: number;
  computedAt?: string;
}): PerpsRiskSnapshot {
  const warnWithinPct = validateWarningThreshold(options.warnWithinPct);
  const marketByName = new Map(options.markets.map((market) => [market.name, market]));
  const positions = options.positions.map((position) =>
    buildPositionRisk(position, marketByName.get(position.market), warnWithinPct),
  );
  const distances = positions
    .map((position) => position.liquidationDistancePct)
    .filter((value): value is number => value !== null);

  return {
    address: options.address,
    computedAt: options.computedAt ?? new Date().toISOString(),
    warnWithinPct: round(warnWithinPct),
    positionCount: positions.length,
    totals: {
      notionalUsd: round(positions.reduce((sum, position) => sum + position.notionalUsd, 0)),
      marginUsd: round(positions.reduce((sum, position) => sum + position.marginUsd, 0)),
      unrealizedPnlUsd: round(
        positions.reduce((sum, position) => sum + position.unrealizedPnlUsd, 0),
      ),
    },
    nearestLiquidationDistancePct: distances.length ? round(Math.min(...distances)) : null,
    warningCount: positions.reduce((sum, position) => sum + position.warnings.length, 0),
    positions,
  };
}

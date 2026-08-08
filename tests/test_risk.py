import unittest

from risk import PositionInput, build_risk_snapshot, validate_warning_threshold


ADDRESS = "0x1111111111111111111111111111111111111111"


class RiskSnapshotTests(unittest.TestCase):
    def test_derives_core_metrics(self) -> None:
        snapshot = build_risk_snapshot(
            address=ADDRESS,
            computed_at="2026-08-07T12:00:00.000Z",
            warn_within_pct=12,
            market_max_by_name={"ETH-USD": 20},
            positions=[
                PositionInput(
                    id="ETH-0",
                    market="ETH-USD",
                    side="long",
                    size=2,
                    leverage=5,
                    entry_price=95,
                    mark_price=100,
                    margin=40,
                    unrealized_pnl=5,
                    liquidation_price=90,
                    funding_rate=0.000125,
                )
            ],
        )

        self.assertEqual(
            snapshot["totals"],
            {"notionalUsd": 200, "marginUsd": 40, "unrealizedPnlUsd": 5},
        )
        self.assertEqual(snapshot["nearestLiquidationDistancePct"], 10)
        position = snapshot["positions"][0]
        self.assertEqual(position["pnlOnMarginPct"], 12.5)
        self.assertEqual(position["fundingRate"], 0.000125)
        self.assertEqual(position["leverageUtilizationPct"], 25)
        self.assertIn("within 12% threshold", position["warnings"][0])

    def test_short_buffer_and_missing_liquidation(self) -> None:
        snapshot = build_risk_snapshot(
            address=ADDRESS,
            warn_within_pct=10,
            market_max_by_name={"BTC-USD": 40, "SOL-USD": 20},
            positions=[
                PositionInput(
                    id="BTC-0",
                    market="BTC-USD",
                    side="short",
                    size=1,
                    leverage=4,
                    entry_price=100,
                    mark_price=100,
                    margin=25,
                    unrealized_pnl=-2,
                    liquidation_price=115,
                ),
                PositionInput(
                    id="SOL-1",
                    market="SOL-USD",
                    side="long",
                    size=3,
                    leverage=2,
                    entry_price=20,
                    mark_price=20,
                    margin=30,
                    unrealized_pnl=0,
                    liquidation_price=0,
                ),
            ],
        )

        self.assertEqual(snapshot["positions"][0]["liquidationDistancePct"], 15)
        self.assertIsNone(snapshot["positions"][1]["liquidationDistancePct"])
        self.assertIn(
            "liquidation price unavailable", snapshot["positions"][1]["warnings"]
        )

    def test_missing_market_does_not_invent_leverage_limit(self) -> None:
        snapshot = build_risk_snapshot(
            address=ADDRESS,
            warn_within_pct=5,
            market_max_by_name={},
            positions=[
                PositionInput(
                    id="NEW-0",
                    market="NEW-USD",
                    side="long",
                    size=1,
                    leverage=2,
                    entry_price=10,
                    mark_price=10,
                    margin=5,
                    unrealized_pnl=0,
                    liquidation_price=8,
                )
            ],
        )

        position = snapshot["positions"][0]
        self.assertIsNone(position["leverageUtilizationPct"])
        self.assertIn("market leverage metadata unavailable", position["warnings"])

    def test_rejects_invalid_threshold(self) -> None:
        with self.assertRaisesRegex(ValueError, "positive percentage"):
            validate_warning_threshold(0)
        with self.assertRaisesRegex(ValueError, "positive percentage"):
            validate_warning_threshold(float("nan"))


if __name__ == "__main__":
    unittest.main()

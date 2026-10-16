import unittest
from unittest.mock import patch
from adapters import daily


class DailyAdapterTests(unittest.TestCase):
    def test_sina_preserves_unadjusted_rows_and_end_date(self):
        rows = [{"day": date, "open": "10", "high": "12", "low": "9", "close": "11", "volume": "100"} for date in ["2026-01-05", "2026-01-06"]]
        with patch.object(daily, "_json", return_value=rows) as request:
            frame = daily.get_price_sina("sh600000", "2026-01-05", 2)
        self.assertEqual([str(d)[:10] for d in frame.index], ["2026-01-05"])
        self.assertEqual(frame.iloc[0]["close"], 11)
        self.assertEqual(request.call_args.args[1]["scale"], "240")

    def test_qfq_never_falls_back_to_unadjusted(self):
        with patch.object(daily, "_json", return_value={"data": {"sh600000": {"day": []}}}):
            with self.assertRaisesRegex(ValueError, "qfq"):
                daily.get_price_day_tx("sh600000", "2026-01-05")

    def test_qfq_mapping_and_empty_series(self):
        with patch.object(daily, "_json", return_value={"data": {"sh600000": {"qfqday": [["2026-01-05", "10", "11", "12", "9", "100"]]}}}):
            frame = daily.get_price_day_tx("sh600000", "2026-01-05")
        self.assertEqual(frame.iloc[0].to_dict(), {"open": 10, "high": 12, "low": 9, "close": 11, "volume": 100})
        with patch.object(daily, "_json", return_value=[]):
            self.assertTrue(daily.get_price_sina("sh600000").empty)

    def test_rejects_other_frequencies_and_invalid_symbols(self):
        with patch.object(daily, "_json") as request:
            for symbol, frequency in [("../../secret", "1d"), ("sh600000", "1m")]:
                with self.assertRaises(ValueError):
                    daily.get_price_sina(symbol, frequency=frequency)
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()

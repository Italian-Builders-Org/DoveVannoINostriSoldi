import unittest
import pandas as pd
from analyze import classify_maturity, kaplan_meier_curve


class AnalysisContract(unittest.TestCase):
    def test_states_are_exclusive_and_missing_is_not_completed(self):
        self.assertEqual(classify_maturity("Concluso", "COLLAUDO"), "Concluso")
        self.assertEqual(classify_maturity("", "COLLAUDO"), "Collaudo non concluso")
        self.assertEqual(classify_maturity("", ""), "Fase non disponibile")

    def test_km_ties_count_censored_as_at_risk_and_stop_at_followup(self):
        curve = kaplan_meier_curve(pd.Series([1, 1, 2, 3]), pd.Series([1, 0, 1, 0]))
        self.assertAlmostEqual(curve.iloc[1]["survival"], .75)
        self.assertAlmostEqual(curve.iloc[2]["survival"], .375)
        self.assertEqual(curve.iloc[-1]["day"], 3)
        self.assertEqual(curve.iloc[-1]["events"], 0)

    def test_no_events_never_implies_completion(self):
        curve = kaplan_meier_curve(pd.Series([2, 5]), pd.Series([0, 0]))
        self.assertTrue(curve["completion"].eq(0).all())
        self.assertEqual(curve.iloc[-1]["day"], 5)


if __name__ == "__main__":
    unittest.main()

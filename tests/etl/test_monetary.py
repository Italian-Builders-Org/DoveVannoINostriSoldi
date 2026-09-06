import re
import unittest
from dataclasses import replace
from decimal import Decimal, Inexact, ROUND_DOWN, localcontext

from monetary import AmountError, AmountRangeError, MAX_SAFE_CENTS, MoneyPolicy, decimal_to_cents, parse_cents


EUROS = MoneyPolicy(
    pattern=re.compile(r"-?\d+(?:,\d+)?"), decimal_separator=",", unit="euros",
    allow_negative=True, rounding="half_up", strip_whitespace=True,
)
CENTS = MoneyPolicy(
    pattern=re.compile(r"-?[0-9]+"), decimal_separator=".", unit="cents",
    allow_negative=True, rounding="reject", strip_whitespace=False,
)


class MonetaryTests(unittest.TestCase):
    def test_units_sign_zero_and_declared_precision(self):
        for raw, policy, expected in (
            ("123", EUROS, 12300), ("123", CENTS, 123),
            ("0", EUROS, 0), ("-0", CENTS, 0), ("-123", CENTS, -123),
            ("1,004", EUROS, 100), ("1,005", EUROS, 101), ("-1,005", EUROS, -101),
            (" 1,005\n", EUROS, 101), ("0001,50", EUROS, 150),
            ("1,00", replace(EUROS, rounding="reject"), 100),
        ):
            with self.subTest(raw=raw, policy=policy):
                actual = parse_cents(raw, policy)
                self.assertIs(type(actual), int)
                self.assertEqual(actual, expected)
        for raw, policy in (
            ("-1", replace(EUROS, allow_negative=False)),
            ("1,001", replace(EUROS, rounding="reject")),
            (" 1", CENTS), ("1.00", CENTS), ("1,00", CENTS),
        ):
            with self.subTest(raw=raw, policy=policy), self.assertRaises(AmountError):
                parse_cents(raw, policy)

    def test_grouping_must_be_declared_and_match_the_entire_format(self):
        italian = replace(EUROS, pattern=re.compile(r"-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}"), thousands_separator=".")
        english = replace(italian, pattern=re.compile(r"-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}"), decimal_separator=".", thousands_separator=",")
        for raw, policy in (("1.234.567,89", italian), ("1,234,567.89", english)):
            with self.subTest(raw=raw):
                self.assertEqual(parse_cents(raw, policy), 123456789)
                with self.assertRaises(AmountError):
                    parse_cents(raw, EUROS)
        for raw, policy in (("1.23,45", italian), ("1234.567,89", italian),
                            ("1..234,56", italian), ("1,23.45", english), ("1,234.5", english)):
            with self.subTest(raw=raw), self.assertRaises(AmountError):
                parse_cents(raw, policy)

    def test_missing_nonfinite_and_malformed_values_are_never_zero(self):
        for raw in ("", " ", "n.d.", "*", "NaN", "Infinity", "-Infinity",
                    "+1", "1e2", "1.00", "1 000", "--1", "1,", ",1", None, 1, 1.5, True):
            with self.subTest(raw=raw), self.assertRaises(AmountError):
                parse_cents(raw, EUROS)
        for value in (Decimal("NaN"), Decimal("sNaN"), Decimal("Infinity"),
                      Decimal("-Infinity"), None, 1, 1.5, True):
            with self.subTest(value=value), self.assertRaises(AmountError):
                decimal_to_cents(value, EUROS)
        permissive = replace(EUROS, pattern=re.compile(r".+"))
        for raw in ("NaN", "Infinity", "bad"):
            with self.subTest(raw=raw), self.assertRaises(AmountError):
                parse_cents(raw, permissive)

    def test_safe_bounds_include_half_up_rounding(self):
        for sign in ("", "-"):
            expected = MAX_SAFE_CENTS * (-1 if sign else 1)
            for raw in (f"{sign}90071992547409,91", f"{sign}90071992547409,914"):
                with self.subTest(raw=raw):
                    self.assertEqual(parse_cents(raw, EUROS), expected)
            self.assertEqual(parse_cents(f"{sign}{MAX_SAFE_CENTS}", CENTS), expected)
            for raw in (f"{sign}90071992547409,915", f"{sign}90071992547409,92", f"{sign}999999999999999999999999"):
                with self.subTest(raw=raw), self.assertRaises(AmountRangeError):
                    parse_cents(raw, EUROS)
            with self.assertRaises(AmountRangeError):
                parse_cents(f"{sign}{MAX_SAFE_CENTS + 1}", CENTS)

    def test_conversion_does_not_round_intermediate_values_or_depend_on_context(self):
        # Rounding before the cent boundary would turn this into 1.005 and 101 cents.
        long_fraction = "1,004" + "9" * 60
        with localcontext() as context:
            context.prec = 3
            context.rounding = ROUND_DOWN
            context.traps[Inexact] = True
            self.assertEqual(parse_cents(long_fraction, EUROS), 100)
            self.assertEqual(parse_cents("90071992547409,91", EUROS), MAX_SAFE_CENTS)
            self.assertEqual(parse_cents("-1,005", EUROS), -101)
            with self.assertRaises(AmountError):
                decimal_to_cents(Decimal("1e-10000000"), replace(EUROS, rounding="reject"))
            self.assertEqual(decimal_to_cents(Decimal("1e-10000000"), EUROS), 0)
            with self.assertRaises(AmountRangeError):
                decimal_to_cents(Decimal("1e10000000"), EUROS)

    def test_unknown_policy_values_fail_closed(self):
        for change in ({"unit": "thousands"}, {"rounding": "truncate"},
                       {"decimal_separator": ";"}, {"thousands_separator": ","},
                       {"thousands_separator": "_"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                replace(EUROS, **change)


if __name__ == "__main__":
    unittest.main()

"""Explicit source formats and exact Decimal-to-cents conversion for ETL adapters."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re
from typing import Literal


MAX_SAFE_CENTS = 9_007_199_254_740_991


class AmountError(ValueError):
    """A present monetary value does not match its declared policy."""


class AmountRangeError(AmountError):
    """The converted amount exceeds the safe publication interval."""


@dataclass(frozen=True)
class MoneyPolicy:
    pattern: re.Pattern[str]
    decimal_separator: Literal[".", ","]
    unit: Literal["euros", "cents"]
    allow_negative: bool
    rounding: Literal["reject", "half_up"]
    strip_whitespace: bool
    thousands_separator: str | None = None

    def __post_init__(self) -> None:
        if self.decimal_separator not in (".", ",") or self.unit not in ("euros", "cents"):
            raise ValueError("Unsupported monetary format or unit")
        if self.rounding not in ("reject", "half_up"):
            raise ValueError("Unsupported monetary rounding policy")
        if self.thousands_separator is not None and (
            self.thousands_separator not in (".", ",", " ", "\u00a0")
            or self.thousands_separator == self.decimal_separator
        ):
            raise ValueError("Invalid thousands separator")


def decimal_to_cents(value: Decimal, policy: MoneyPolicy) -> int:
    """Convert a present Decimal; missing/privacy markers belong to the adapter."""
    if not isinstance(value, Decimal) or not value.is_finite():
        raise AmountError("A finite Decimal is required")
    if not policy.allow_negative and value < 0:
        raise AmountError("Negative amounts are not allowed")
    # Reject huge exponents before arithmetic or construction of a Python integer.
    # This loose bound admits rounding at the exact safe boundary below.
    if value.copy_abs() > Decimal(MAX_SAFE_CENTS + 1):
        raise AmountRangeError("Amount exceeds the safe integer interval")
    # Shift the exponent exactly, without ambient Decimal precision or underflow.
    scaled = value
    if policy.unit == "euros" and value:
        sign, digits, exponent = value.as_tuple()
        scaled = Decimal((sign, digits, exponent + 2))
    if scaled.copy_abs() > Decimal(MAX_SAFE_CENTS + 1):
        raise AmountRangeError("Amount exceeds the safe integer interval")
    rounded = scaled.to_integral_value(rounding=ROUND_HALF_UP)
    if policy.rounding == "reject" and rounded != scaled:
        raise AmountError("Fractional cents are not allowed")
    if rounded.copy_abs() > MAX_SAFE_CENTS:
        raise AmountRangeError("Amount exceeds the safe integer interval")
    return int(rounded)


def parse_cents(raw: str, policy: MoneyPolicy) -> int:
    """Validate the entire source string before normalizing declared separators."""
    if not isinstance(raw, str):
        raise AmountError("A monetary string is required")
    value = raw.strip() if policy.strip_whitespace else raw
    if not policy.pattern.fullmatch(value):
        raise AmountError("Amount does not match the source format")
    if policy.thousands_separator is not None:
        value = value.replace(policy.thousands_separator, "")
    value = value.replace(policy.decimal_separator, ".")
    try:
        decimal = Decimal(value)
    except InvalidOperation as error:
        raise AmountError("Invalid decimal amount") from error
    return decimal_to_cents(decimal, policy)

/*
 * The ETL bridge tests shell out to the Python toolchain. On Windows the
 * interpreter is normally installed as `python`, so a hardcoded `python3`
 * turns every one of those tests into a spawn failure that reads like a
 * broken data contract instead of a missing binary. PYTHON lets a contributor
 * name the interpreter; CI keeps the documented default.
 */
export const PYTHON_BIN = process.env.PYTHON?.trim() || "python3";

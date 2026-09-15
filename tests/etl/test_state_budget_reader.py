"""Expose the reader's independent checks to the existing ETL CI discovery."""
import importlib.util
from pathlib import Path

_path = Path(__file__).resolve().parents[1] / "reports/test_state_budget_reader.py"
_spec = importlib.util.spec_from_file_location("dvns_reader_report_checks", _path)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
ReaderTests = _module.ReaderTests

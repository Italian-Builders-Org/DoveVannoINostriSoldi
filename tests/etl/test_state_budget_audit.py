"""Expose acquired-aggregate checks to the established ETL test discovery."""
import importlib.util
from pathlib import Path

_path = Path(__file__).resolve().parents[1] / 'reports/test_state_budget_audit.py'
_spec = importlib.util.spec_from_file_location('dvns_state_budget_audit_checks', _path)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
AuditTests = _module.AuditTests

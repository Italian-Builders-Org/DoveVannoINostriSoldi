"""Python sitecustomize — auto-installs the offline network guard.

When ``DVNS_OFFLINE_GUARD=1`` is set and this file is on ``PYTHONPATH``,
Python imports it at interpreter startup, which activates the guard.

This file is intentionally minimal — it delegates to ``offline_guard``.
"""

import os

if os.environ.get("DVNS_OFFLINE_GUARD") == "1":
    try:
        from offline_guard import install  # type: ignore[import-not-found]
        install()
    except ImportError:
        pass

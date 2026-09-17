#!/usr/bin/env python3
"""Application-level network guard for offline ETL verification.

This module blocks accidental outbound TCP connections during offline
verification paths. It is **not** kernel-level egress isolation — it patches
``socket.socket.connect`` and ``socket.socket.connect_ex`` at the Python
application level. Libraries built on sockets (urllib, http.client, requests,
etc.) are caught because they all go through ``socket.connect``.

Loopback addresses (127.0.0.0/8, ::1) and Unix domain sockets are allowed.

Activation
----------
The guard activates when the ``DVNS_OFFLINE_GUARD`` environment variable is set
to ``"1"``.  The companion ``sitecustomize.py`` calls ``install()`` at
interpreter startup, so setting ``PYTHONPATH=scripts/ci`` plus
``DVNS_OFFLINE_GUARD=1`` is sufficient.

Direct usage::

    from scripts.ci.offline_guard import install
    install()

Blocked connections raise ``ConnectionError`` with a diagnostic message::

    offline verification attempted outbound connection to 93.184.216.34:443
"""

from __future__ import annotations

import os
import socket

_INSTALLED = False
_ORIGINAL_CONNECT = None
_ORIGINAL_CONNECT_EX = None

ALLOWED_PREFIXES = (
    "127.",
    "::1",
    "localhost",
)


def _is_loopback(host: str | None) -> bool:
    if host is None:
        return True  # Unnamed address — allow (AF_UNIX handled separately)
    if not isinstance(host, str):
        return False
    if host.lower() == "localhost":
        return True
    if host.startswith(ALLOWED_PREFIXES):
        return True
    # Numerical 127.x.x.x
    try:
        parts = host.split(".")
        if len(parts) == 4 and parts[0] == "127":
            return True
    except (AttributeError, IndexError):
        pass
    return False


def _block_connect(self, address, *args, **kwargs):
    # Unix domain sockets use a string path, not a (host, port) tuple.
    # They are local by definition — always allow.
    if self.family == socket.AF_UNIX:
        return _ORIGINAL_CONNECT(self, address, *args, **kwargs)
    # address is (host, port) for AF_INET, (host, port, flowinfo, scopeid) for AF_INET6
    if address and len(address) >= 1:
        host = address[0]
        if not _is_loopback(host):
            port = address[1] if len(address) >= 2 else "?"
            raise ConnectionError(
                f"offline verification attempted outbound connection to {host}:{port}"
            )
    return _ORIGINAL_CONNECT(self, address, *args, **kwargs)


def _block_connect_ex(self, address, *args, **kwargs):
    # Unix domain sockets use a string path, not a (host, port) tuple.
    # They are local by definition — always allow.
    if self.family == socket.AF_UNIX:
        return _ORIGINAL_CONNECT_EX(self, address, *args, **kwargs)
    if address and len(address) >= 1:
        host = address[0]
        if not _is_loopback(host):
            port = address[1] if len(address) >= 2 else "?"
            raise ConnectionError(
                f"offline verification attempted outbound connection to {host}:{port}"
            )
    return _ORIGINAL_CONNECT_EX(self, address, *args, **kwargs)


def install() -> None:
    """Install the network guard by patching ``socket.socket``.

    Safe to call multiple times — only installs once.
    """
    global _INSTALLED, _ORIGINAL_CONNECT, _ORIGINAL_CONNECT_EX

    if _INSTALLED:
        return

    _ORIGINAL_CONNECT = socket.socket.connect
    _ORIGINAL_CONNECT_EX = socket.socket.connect_ex
    socket.socket.connect = _block_connect
    socket.socket.connect_ex = _block_connect_ex
    _INSTALLED = True


def uninstall() -> None:
    """Restore the original socket methods."""
    global _INSTALLED, _ORIGINAL_CONNECT, _ORIGINAL_CONNECT_EX

    if not _INSTALLED:
        return

    socket.socket.connect = _ORIGINAL_CONNECT
    socket.socket.connect_ex = _ORIGINAL_CONNECT_EX
    _INSTALLED = False


def is_active() -> bool:
    """Return True if the guard is currently installed."""
    return _INSTALLED


# Auto-install when the environment variable is set
if os.environ.get("DVNS_OFFLINE_GUARD") == "1":
    install()

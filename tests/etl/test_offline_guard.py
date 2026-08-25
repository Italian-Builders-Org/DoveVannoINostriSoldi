"""Tests for the application-level Python offline network guard.

These tests prove:
  - external connection attempts are blocked
  - external urllib requests are blocked
  - loopback connections are NOT rejected by the policy itself
"""

from __future__ import annotations

import os
import socket
import sys
import unittest
import urllib.request

# Ensure scripts/ci is importable
_CI_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "ci")
_CI_DIR = os.path.abspath(_CI_DIR)
if _CI_DIR not in sys.path:
    sys.path.insert(0, _CI_DIR)

import offline_guard  # type: ignore[import-not-found]


class OfflineGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        offline_guard.install()

    def tearDown(self) -> None:
        offline_guard.uninstall()

    def test_external_socket_connection_is_blocked(self) -> None:
        """A direct socket.connect to an external IP raises ConnectionError."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            with self.assertRaises(ConnectionError) as ctx:
                s.connect(("93.184.216.34", 443))
            self.assertIn("offline verification attempted outbound connection", str(ctx.exception))
            self.assertIn("93.184.216.34", str(ctx.exception))
        finally:
            s.close()

    def test_external_urllib_request_is_blocked(self) -> None:
        """A urllib.request.urlopen to an external host is blocked."""
        with self.assertRaises(Exception) as ctx:
            urllib.request.urlopen("http://93.184.216.34/test", timeout=5)
        # urllib wraps the ConnectionError in URLError
        self.assertIn("offline verification attempted outbound connection", str(ctx.exception))

    def test_loopback_is_not_rejected_by_policy(self) -> None:
        """Loopback (127.0.0.1) connections are allowed by the guard."""
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        port = listener.getsockname()[1]

        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            client.connect(("127.0.0.1", port))  # Should NOT raise
            self.assertEqual(client.getpeername()[0], "127.0.0.1")
        finally:
            client.close()
            listener.close()

    def test_guard_is_installed(self) -> None:
        """After install(), the guard reports as active."""
        self.assertTrue(offline_guard.is_active())

    def test_guard_can_be_uninstalled(self) -> None:
        """After uninstall(), external connections are no longer blocked."""
        offline_guard.uninstall()
        self.assertFalse(offline_guard.is_active())
        # Restore for tearDown
        offline_guard.install()


if __name__ == "__main__":
    unittest.main()

"""Offline checks for the free-licensed portraits of non-parliamentary ministers."""

from __future__ import annotations

import json
import unittest

from ritratti_liberi_snapshot import OUTPUT, SnapshotError, check_committed, load_spec, validate_snapshot


def committed() -> dict:
    return json.loads(OUTPUT.read_text(encoding="utf-8"))


def floor() -> int:
    return int(load_spec()["coverageFloor"]["portraits"])


class RitrattiLiberiSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_every_portrait_carries_author_and_licence(self) -> None:
        for portrait in committed()["portraits"]:
            self.assertTrue(portrait["author"].strip(), portrait["displayName"])
            self.assertTrue(portrait["license"].strip(), portrait["displayName"])
            self.assertIn(portrait["author"], portrait["credit"])
            self.assertIn(portrait["license"], portrait["credit"])

    def test_validate_rejects_shared_image(self) -> None:
        payload = committed()
        payload["portraits"][1]["sha256"] = payload["portraits"][0]["sha256"]
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, floor=floor())

    def test_validate_rejects_portrait_outside_commons(self) -> None:
        payload = committed()
        payload["portraits"][0]["photoUrl"] = "https://example.test/ritratto.jpg"
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, floor=floor())

    def test_validate_rejects_missing_attribution(self) -> None:
        payload = committed()
        payload["portraits"][0]["author"] = ""
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, floor=floor())

    def test_validate_rejects_response_hash_drift(self) -> None:
        payload = committed()
        payload["source"]["responses"]["commons"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, floor=floor(), locks=load_spec()["source"]["committedResponses"])

    def test_spec_rejects_person_declared_twice(self) -> None:
        import tempfile
        from pathlib import Path

        import ritratti_liberi_snapshot as module

        spec = json.loads(module.SPEC.read_text(encoding="utf-8"))
        spec["source"]["people"].append(dict(spec["source"]["people"][0]))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "ritratti-liberi.source.json"
            path.write_text(json.dumps(spec), encoding="utf-8")
            with self.assertRaises(SnapshotError):
                module.load_spec(path)


if __name__ == "__main__":
    unittest.main()

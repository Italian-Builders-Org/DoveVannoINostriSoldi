"""Tests for the line-based GitHub Actions pin checker."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import re
import tempfile
from pathlib import Path
from unittest import TestCase, main, mock


_ROOT = Path(__file__).resolve().parents[2]
_CHECKER_PATH = _ROOT / "scripts" / "ci" / "check-action-pins.py"
_SPEC = importlib.util.spec_from_file_location("check_action_pins", _CHECKER_PATH)
if _SPEC is None or _SPEC.loader is None:  # pragma: no cover - import failure
    raise ImportError(f"Unable to load {_CHECKER_PATH}")
check_action_pins = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_action_pins)


PINNED_SHA = "a" * 40
OTHER_SHA = "b" * 40
PINS = {
    "actions/checkout": {"tag": "v6", "sha": PINNED_SHA},
}


class ActionPinCheckerTests(TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory(
            dir=check_action_pins.ROOT, prefix=".action-pins-test-"
        )
        self.fixture_root = Path(self.tempdir.name)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def fixture_file(self, name: str = "workflow.yml") -> Path:
        path = self.fixture_root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def errors_for(self, content: str) -> list[str]:
        path = self.fixture_file()
        path.write_text(content, encoding="utf-8")
        return check_action_pins.check_workflow(path, PINS)

    def test_anonymous_mutable_tag_is_rejected(self) -> None:
        path = self.fixture_file()
        path.write_text(
            "steps:\n  - uses: actions/checkout@v6\n", encoding="utf-8"
        )

        self.assertEqual(
            check_action_pins.extract_uses(path),
            [(2, "actions/checkout@v6", None)],
        )
        errors = check_action_pins.check_workflow(path, PINS)
        self.assertEqual(len(errors), 1)
        self.assertIn("tag-based ref", errors[0])

    def test_named_mutable_tag_is_rejected(self) -> None:
        path = self.fixture_file()
        path.write_text(
            "steps:\n"
            "  - name: Checkout\n"
            "    uses: actions/checkout@v6 # v6\n",
            encoding="utf-8",
        )

        self.assertEqual(
            check_action_pins.extract_uses(path),
            [(3, "actions/checkout@v6", "v6")],
        )
        errors = check_action_pins.check_workflow(path, PINS)
        self.assertEqual(len(errors), 1)
        self.assertIn("tag-based ref", errors[0])

    def test_double_quoted_mutable_tag_is_rejected(self) -> None:
        path = self.fixture_file()
        path.write_text(
            'steps:\n  - uses: "actions/checkout@v6" # v6\n',
            encoding="utf-8",
        )

        self.assertEqual(
            check_action_pins.extract_uses(path),
            [(2, "actions/checkout@v6", "v6")],
        )
        errors = check_action_pins.check_workflow(path, PINS)
        self.assertEqual(len(errors), 1)
        self.assertIn("tag-based ref", errors[0])

    def test_single_quoted_pinned_ref_is_accepted(self) -> None:
        path = self.fixture_file()
        path.write_text(
            f"steps:\n  - uses: 'actions/checkout@{PINNED_SHA}' # v6\n",
            encoding="utf-8",
        )

        self.assertEqual(
            check_action_pins.extract_uses(path),
            [(2, f"actions/checkout@{PINNED_SHA}", "v6")],
        )
        self.assertEqual(check_action_pins.check_workflow(path, PINS), [])

    def test_multiline_block_and_folded_uses_scalars_are_rejected(self) -> None:
        for indicator in (">", ">-", "|", "|-"):
            with self.subTest(indicator=indicator):
                path = self.fixture_file(f"workflow-{indicator.replace('-', 'dash')}.yml")
                path.write_text(
                    "steps:\n"
                    f"  - uses: {indicator}\n"
                    "      actions/checkout@v6\n",
                    encoding="utf-8",
                )

                errors = check_action_pins.check_workflow(path, PINS)
                self.assertEqual(len(errors), 1)
                self.assertIn("multiline block/folded scalar is unsupported", errors[0])

    def test_multiline_quoted_scalar_is_rejected(self) -> None:
        path = self.fixture_file()
        path.write_text(
            'steps:\n  - uses: "actions/checkout@\n      v6"\n',
            encoding="utf-8",
        )

        errors = check_action_pins.check_workflow(path, PINS)
        self.assertEqual(len(errors), 1)
        self.assertIn("unsupported scalar", errors[0])

    def test_reachable_anchor_alias_uses_the_anchored_action_ref(self) -> None:
        path = self.fixture_file()
        path.write_text(
            "steps:\n"
            f"  - uses: &checkout 'actions/checkout@{PINNED_SHA}' # v6\n"
            "  - uses: *checkout # v6\n",
            encoding="utf-8",
        )

        self.assertEqual(
            check_action_pins.extract_uses(path),
            [
                (2, f"actions/checkout@{PINNED_SHA}", "v6"),
                (3, f"actions/checkout@{PINNED_SHA}", "v6"),
            ],
        )
        self.assertEqual(check_action_pins.check_workflow(path, PINS), [])

    def test_unknown_sha_for_known_action_is_rejected(self) -> None:
        errors = self.errors_for(
            f"steps:\n  - uses: actions/checkout@{OTHER_SHA} # v6\n"
        )

        self.assertEqual(len(errors), 1)
        self.assertIn("SHA does not match", errors[0])

    def test_comment_mismatch_is_rejected(self) -> None:
        errors = self.errors_for(
            f"steps:\n  - uses: actions/checkout@{PINNED_SHA} # v5\n"
        )

        self.assertEqual(len(errors), 1)
        self.assertIn("version comment 'v5'", errors[0])
        self.assertIn("expected '# v6'", errors[0])

    def test_local_actions_are_exempt_but_docker_tags_are_rejected(self) -> None:
        path = self.fixture_file()
        path.write_text(
            "steps:\n"
            "  - name: Local\n"
            "    uses: ./.github/actions/local\n"
            "  - name: Docker\n"
            "    uses: docker://alpine:3.20\n"
            f"  - name: Third party\n    uses: actions/checkout@{PINNED_SHA} # v6\n",
            encoding="utf-8",
        )

        self.assertEqual(
            check_action_pins.extract_uses(path),
            [(5, "docker://alpine:3.20", None), (7, f"actions/checkout@{PINNED_SHA}", "v6")],
        )
        errors = check_action_pins.check_workflow(path, PINS)
        self.assertEqual(len(errors), 1)
        self.assertIn("mutable Docker action reference", errors[0])

    def test_docker_digest_is_accepted(self) -> None:
        digest = "b" * 64
        errors = self.errors_for(f"steps:\n  - uses: docker://alpine@sha256:{digest}\n")
        self.assertEqual(errors, [])

    def test_quoted_key_and_inline_mapping_are_checked(self) -> None:
        path = self.fixture_file()
        path.write_text(
            "steps:\n"
            f'  - "uses": actions/checkout@{PINNED_SHA} # v6\n'
            f"  - {{ name: Checkout, 'uses': actions/checkout@{OTHER_SHA} }}\n",
            encoding="utf-8",
        )
        self.assertEqual(
            check_action_pins.extract_uses(path),
            [
                (2, f"actions/checkout@{PINNED_SHA}", "v6"),
                (3, f"actions/checkout@{OTHER_SHA}", None),
            ],
        )
        errors = check_action_pins.check_workflow(path, PINS)
        self.assertEqual(len(errors), 1)
        self.assertIn("SHA does not match", errors[0])

    def test_main_scans_workflow_and_both_local_action_yaml_names(self) -> None:
        workflows = self.fixture_root / "workflows"
        actions = self.fixture_root / "actions"
        workflows.mkdir()

        (workflows / "anonymous.yml").write_text(
            f"steps:\n  - uses: actions/checkout@{PINNED_SHA} # v6\n",
            encoding="utf-8",
        )
        (workflows / "named.yaml").write_text(
            "steps:\n"
            "  - name: Checkout\n"
            f"    uses: actions/checkout@{PINNED_SHA} # v6\n",
            encoding="utf-8",
        )
        (actions / "first").mkdir(parents=True)
        (actions / "first" / "action.yml").write_text(
            "runs:\n"
            "  using: composite\n"
            "  steps:\n"
            f"    - uses: actions/checkout@{PINNED_SHA} # v6\n",
            encoding="utf-8",
        )
        (actions / "second").mkdir(parents=True)
        (actions / "second" / "action.yaml").write_text(
            "runs:\n"
            "  using: composite\n"
            "  steps:\n"
            "    - uses: ./.github/actions/other\n"
            "    - uses: docker://alpine@sha256:" + "c" * 64 + "\n",
            encoding="utf-8",
        )
        pins_file = self.fixture_root / "action-pins.json"
        pins_file.write_text(json.dumps({"actions": PINS}), encoding="utf-8")

        output = io.StringIO()
        with (
            mock.patch.object(check_action_pins, "WORKFLOWS_DIR", workflows),
            mock.patch.object(check_action_pins, "LOCAL_ACTIONS_DIR", actions),
            mock.patch.object(check_action_pins, "PINS_FILE", pins_file),
            contextlib.redirect_stdout(output),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            result = check_action_pins.main([])

        self.assertEqual(result, 0)
        report = output.getvalue()
        self.assertIn("4 workflow/action file(s)", report)
        self.assertIn("(2 workflow, 2 local action)", report)
        self.assertIn("4 third-party action reference(s)", report)
        self.assertIn("1 pinned action(s)", report)

    @staticmethod
    def independent_simple_scan(paths: list[Path]) -> int:
        """Count third-party uses with a deliberately simple line scan."""
        count = 0
        for path in paths:
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if line.startswith("-"):
                    line = line[1:].strip()
                if not line.startswith("uses:"):
                    continue
                action_ref = line[len("uses:") :].split("#", 1)[0].strip()
                if action_ref.startswith("./"):
                    continue
                if action_ref.startswith("docker://"):
                    count += 1
                    continue
                if "@" not in action_ref:
                    continue
                action_name = action_ref.split("@", 1)[0]
                if re.fullmatch(
                    r"[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+", action_name
                ):
                    count += 1
        return count

    def test_real_repository_count_matches_independent_line_scan(self) -> None:
        paths = check_action_pins.workflow_files() + check_action_pins.local_action_files()
        extracted_count = sum(
            len(check_action_pins.extract_uses(path)) for path in paths
        )

        self.assertGreater(extracted_count, 0)
        self.assertEqual(extracted_count, self.independent_simple_scan(paths))


if __name__ == "__main__":
    main()

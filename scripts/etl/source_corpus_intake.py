#!/usr/bin/env python3
"""Build or verify the path-redacted receipt for the source corpus."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from source_corpus.archive_receipt import (
    DEFAULT_OUTPUT,
    DEFAULT_POLICY,
    ReceiptError,
    run_checked,
)


def _add_common_paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create and validate a complete, path-redacted source receipt.",
    )
    subparsers = parser.add_subparsers(dest="action", required=True)

    build = subparsers.add_parser("build", help="build public receipt artifacts")
    build.add_argument("--archive", type=Path, required=True)
    build.add_argument("--private-map-out", type=Path, required=True)
    _add_common_paths(build)

    check = subparsers.add_parser("check", help="validate committed artifacts offline")
    _add_common_paths(check)

    verify = subparsers.add_parser(
        "verify-source",
        help="rebuild from the private source and compare every receipt byte",
    )
    verify.add_argument("--archive", type=Path, required=True)
    _add_common_paths(verify)
    return parser


def _summary(receipt: dict[str, object]) -> str:
    observed = receipt.get("observed")
    archive = receipt.get("archive")
    if not isinstance(observed, dict) or not isinstance(archive, dict):
        raise ReceiptError("validated receipt summary is unavailable")
    return json.dumps(
        {
            "status": receipt.get("status"),
            "entries": observed.get("entries"),
            "regular": observed.get("regular"),
            "hardlink": observed.get("hardlink"),
            "symlink": observed.get("symlink"),
            "archiveBytes": archive.get("bytes"),
            "archiveSha256": archive.get("sha256"),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments and arguments[0] == "--check":
        arguments[0] = "check"
    parser = build_parser()
    args = parser.parse_args(arguments)

    kwargs: dict[str, Path] = {
        "output_dir": args.output_dir,
        "policy_path": args.policy,
    }
    if args.action in {"build", "verify-source"}:
        kwargs["archive_path"] = args.archive
    if args.action == "build":
        kwargs["private_map_out"] = args.private_map_out

    try:
        receipt = run_checked(args.action, **kwargs)
    except (ReceiptError, OSError) as exc:
        parser.exit(1, f"receipt check failed: {exc}\n")
    print(_summary(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

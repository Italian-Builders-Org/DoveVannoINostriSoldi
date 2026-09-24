"""Compact, reviewable JSON for the Camera and Senato act/vote snapshots."""

from __future__ import annotations

import json
from typing import Any


def serialize_snapshot(snapshot: dict[str, Any]) -> str:
    def compact(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    fields = []
    for key, value in snapshot.items():
        if key in ("acts", "finalVotes"):
            encoded = "[\n" + ",\n".join(f"    {compact(row)}" for row in value) + "\n  ]"
        else:
            encoded = compact(value)
        fields.append(f"  {compact(key)}:{encoded}")
    return "{\n" + ",\n".join(fields) + "\n}\n"

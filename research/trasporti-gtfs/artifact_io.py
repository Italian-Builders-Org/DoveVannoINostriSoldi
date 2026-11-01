"""Publish local public-data artifacts without rewriting immutable snapshots."""

import os
import tempfile
from pathlib import Path


def write_artifact(path, data):
    path = Path(path)
    if path.is_file() and path.read_bytes() == data:
        return False
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=".artifact-", delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(data)
        os.chmod(temporary, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(temporary, path)
        return True
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

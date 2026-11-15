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
        # Owner-only: public research outputs are served via explicit publish, not umask-world files.
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        return True
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

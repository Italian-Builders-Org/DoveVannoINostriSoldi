"""Small independently verifiable blocks for paginated operator award details."""

from __future__ import annotations

import gzip
import hashlib
import json
from typing import BinaryIO, Mapping

from anac_operator_awards_index import ContractError


BLOCK_ROWS = 100
MAX_BLOCK_BYTES = 1_048_576
MAX_BLOCK_OUTPUT_BYTES = 4_194_304


def write_blocks(
    stream: BinaryIO,
    ref: str,
    awards: list[dict],
    procedures: Mapping[str, Mapping[str, object]],
) -> dict[str, object]:
    blocks = []
    filters = []
    for start in range(0, len(awards), BLOCK_ROWS):
        rows = []
        for award in awards[start : start + BLOCK_ROWS]:
            procedure = procedures.get(award["cig"])
            rows.append({**award, "procedure": procedure})
            filters.append(
                [
                    int(award["awardedAt"][:4]) if award["awardedAt"] else None,
                    procedure.get("authorityRef") if procedure else None,
                    procedure.get("procedure") if procedure else None,
                    award["amount"],
                ]
            )
        raw = json.dumps(
            {"ref": ref, "start": start, "awards": rows},
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
        if len(raw) > MAX_BLOCK_OUTPUT_BYTES:
            raise ContractError("Blocco storico oltre il limite decompresso")
        compressed = bytearray(gzip.compress(raw, compresslevel=9, mtime=0))
        compressed[9] = 255
        if len(compressed) > MAX_BLOCK_BYTES:
            raise ContractError("Blocco storico oltre il limite compresso")
        blocks.append(
            {
                "offset": stream.tell(),
                "bytes": len(compressed),
                "rows": len(rows),
                "sha256": hashlib.sha256(compressed).hexdigest(),
            }
        )
        stream.write(compressed)
    return {"blockSize": BLOCK_ROWS, "blocks": blocks, "filterRows": filters}

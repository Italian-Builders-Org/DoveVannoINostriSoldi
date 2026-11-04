"""Shared GTFS source identifiers — kept out of analyze/basemap to avoid import cycles."""

import re


def archive_id(source, key="archiveId"):
    identifier = source.get(key, source["id"])
    if not isinstance(identifier, str) or not re.fullmatch(
        r"[a-z][a-z0-9-]{0,31}", identifier
    ):
        raise ValueError("Invalid archive identifier")
    return identifier

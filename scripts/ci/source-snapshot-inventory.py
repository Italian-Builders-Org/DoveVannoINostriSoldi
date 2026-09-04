#!/usr/bin/env python3
"""Build the published-snapshot inventory from the generated-artifact registry.

Francesco asked for this inventory in issue #189 before automating sources one
at a time. The markdown is generated, not hand-edited: a stale doc fails CI.

Usage:
    python3 scripts/ci/source-snapshot-inventory.py --write
    python3 scripts/ci/source-snapshot-inventory.py --check
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = ROOT / "scripts" / "ci" / "generated-artifacts.json"
DOC_PATH = ROOT / "docs" / "SOURCE_SNAPSHOT_INVENTORY.md"
MAX_SNAPSHOT_BYTES = 2_000_000
CRON_RE = re.compile(r"cron:\s*[\"']([^\"']+)[\"']")
PUBLISH_RE = re.compile(r"uses:\s*\./\.github/actions/publish-data-refresh")
HEAD_FIELD_RE = re.compile(
    r'"(referenceDate|referenceYear|referencePeriod|latestYear|year|taxYear|'
    r'generatedAt|observedAt|acquiredAt|retrievedAt|publishedAt|extractionDate|'
    r'dataThrough|observedThrough|sourceDate|updatedAt)"\s*:\s*(?:"([^"]+)"|(\d+))'
)

MODE_PR = "PR automatica"
MODE_DETECT = "solo rilevamento"
MODE_CACHE = "invalidazione cache"
MODE_MANUAL = "manuale"

ROLLBACK = {
    MODE_PR: (
        "Chiudere o revertire la PR del data bot. `main` resta sull'ultimo "
        "snapshot valido. Nessun push diretto su `main`."
    ),
    MODE_DETECT: (
        "Il job fallisce e non riscrive i file. Resta pubblicato lo snapshot "
        "già committato."
    ),
    MODE_CACHE: (
        "Non pubblica snapshot. Se il job fallisce la cache resta quella "
        "precedente fino al prossimo tentativo."
    ),
    MODE_MANUAL: (
        "PR umana dopo revisione di hash, schema e periodo. Rollback: revert "
        "del merge."
    ),
}


def load_registry() -> dict[str, Any]:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def load_json(path: Path) -> Any | None:
    if not path.is_file():
        return None
    try:
        if path.stat().st_size <= MAX_SNAPSHOT_BYTES:
            return json.loads(path.read_text(encoding="utf-8"))
        head = path.read_bytes()[:16_384].decode("utf-8", "replace")
        payload: dict[str, Any] = {}
        for match in HEAD_FIELD_RE.finditer(head):
            payload.setdefault(match.group(1), match.group(2) or match.group(3))
        return payload or None
    except (OSError, json.JSONDecodeError):
        return None


def format_value(value: Any) -> str | None:
    if value is None or value is False:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(int(value) if isinstance(value, float) and value.is_integer() else value)
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, dict):
        start = value.get("from") or value.get("start") or value.get("min")
        end = value.get("to") or value.get("end") or value.get("max")
        if start is not None and end is not None:
            return f"{start}-{end}"
        date = value.get("referenceDate") or value.get("date")
        if isinstance(date, str) and date.strip():
            return date.strip()
    if isinstance(value, list) and value and all(isinstance(item, (int, str)) for item in value):
        return ", ".join(str(item) for item in value[:6])
    return None


def pick_period(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in (
        "referenceDate",
        "referencePeriod",
        "referenceYear",
        "period",
        "latestYear",
        "year",
        "taxYear",
        "publishedAt",
        "extractionDate",
        "dataThrough",
        "observedThrough",
        "sourceDate",
        "updatedAt",
        "sourceLastModified",
    ):
        formatted = format_value(payload.get(key))
        if formatted:
            return formatted
    for nested_key in ("stock", "coverage", "source", "scope", "freshness", "meta"):
        nested = payload.get(nested_key)
        if isinstance(nested, dict):
            found = pick_period(nested)
            if found:
                return found
    sources = payload.get("sources")
    if isinstance(sources, dict):
        dates = []
        for source in sources.values():
            if not isinstance(source, dict):
                continue
            for key in ("updatedAt", "observedThrough", "referencePeriod", "referenceDate", "release"):
                formatted = format_value(source.get(key))
                if formatted:
                    dates.append(formatted)
                    break
        if dates:
            return max(dates)
    inputs = payload.get("inputs")
    if isinstance(inputs, dict):
        dates = []
        for entry in inputs.values():
            if isinstance(entry, dict):
                formatted = format_value(entry.get("sourceLastModified") or entry.get("referenceDate"))
                if formatted:
                    dates.append(formatted)
        if dates:
            return max(dates)
    return None


def pick_observed(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ("observedAt", "acquiredAt", "generatedAt", "retrievedAt", "catalogObservedAt"):
        formatted = format_value(payload.get(key))
        if formatted:
            return formatted
    sources = payload.get("sources")
    if isinstance(sources, dict):
        for source in sources.values():
            if isinstance(source, dict):
                formatted = format_value(source.get("retrievedAt") or source.get("observedAt"))
                if formatted:
                    return formatted
    return None


def period_from_spec(artifact: dict[str, Any]) -> str | None:
    spec_path = artifact.get("sourceSpec")
    if not isinstance(spec_path, str):
        return None
    spec = load_json(ROOT / spec_path)
    if not isinstance(spec, dict):
        return None
    found = pick_period(spec)
    if found:
        return found
    observed = spec.get("catalogObservedAt") or spec.get("catalogMetadataModifiedAt")
    return format_value(observed)


def snapshot_dates(artifact: dict[str, Any]) -> tuple[str, str]:
    period = None
    observed = None
    preferred: list[Path] = []
    rest: list[Path] = []
    for relative in artifact.get("files") or []:
        path = ROOT / relative
        if path.is_dir():
            meta = path / "meta.json"
            if meta.is_file():
                preferred.append(meta)
            continue
        if "meta" in path.name:
            preferred.append(path)
        else:
            rest.append(path)
    for path in preferred + rest:
        payload = load_json(path)
        if payload is None:
            continue
        period = period or pick_period(payload)
        observed = observed or pick_observed(payload)
        if period and observed:
            break
    period = period or period_from_spec(artifact)
    return period or "non dichiarato nello snapshot", observed or "non dichiarato"


def official_url(artifact: dict[str, Any]) -> str:
    publication = artifact.get("publication") or {}
    url = publication.get("upstreamUrl")
    if isinstance(url, str) and url.startswith("https://"):
        return url
    spec_path = artifact.get("sourceSpec")
    if isinstance(spec_path, str):
        spec = load_json(ROOT / spec_path)
        if isinstance(spec, dict):
            for key in ("landingUrl", "sourceUrl", "datasetPageUrl", "catalogUrl"):
                value = spec.get(key)
                if isinstance(value, str) and value.startswith("https://"):
                    return value
            inputs = spec.get("inputs")
            if isinstance(inputs, dict):
                for entry in inputs.values():
                    if not isinstance(entry, dict):
                        continue
                    for key in ("datasetPageUrl", "resourcePageUrl", "url", "landingUrl"):
                        value = entry.get(key)
                        if isinstance(value, str) and value.startswith("https://"):
                            return value
            source = spec.get("source")
            if isinstance(source, dict):
                landing = source.get("landingUrl")
                if isinstance(landing, str) and landing.startswith("https://"):
                    return landing
    return "non dichiarato nel registro"


def workflow_schedule(relative: str | None) -> str:
    if not relative:
        return "nessuno"
    path = ROOT / relative
    if not path.is_file():
        return "workflow assente"
    text = path.read_text(encoding="utf-8")
    found = CRON_RE.findall(text)
    if not found:
        return "solo workflow_dispatch"
    unique = []
    for item in found:
        if item not in unique:
            unique.append(item)
    return "; ".join(f"`{item}`" for item in unique)


def classify_mode(artifact: dict[str, Any]) -> str:
    workflow = artifact.get("refreshWorkflow")
    if workflow == ".github/workflows/source-refresh.yml":
        return MODE_CACHE
    if isinstance(workflow, str) and workflow:
        path = ROOT / workflow
        text = path.read_text(encoding="utf-8") if path.is_file() else ""
        if artifact.get("publication") and PUBLISH_RE.search(text):
            return MODE_PR
        return MODE_DETECT
    return MODE_MANUAL


def validation_label(artifact: dict[str, Any]) -> str:
    offline = artifact.get("offlineCheck") or {}
    command = offline.get("command")
    covered = offline.get("coveredBy")
    if isinstance(command, str) and command.strip():
        return f"`{command}`"
    if covered == "etl-suite":
        return "suite ETL"
    if covered == "node-tests":
        return "test Node"
    return "non dichiarato"


def markdown_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def render_markdown(registry: dict[str, Any] | None = None) -> str:
    registry = registry or load_registry()
    artifacts = list(registry.get("artifacts") or [])
    rows = []
    counts = {MODE_PR: 0, MODE_DETECT: 0, MODE_CACHE: 0, MODE_MANUAL: 0}
    for artifact in artifacts:
        mode = classify_mode(artifact)
        counts[mode] = counts.get(mode, 0) + 1
        period, observed = snapshot_dates(artifact)
        workflow = artifact.get("refreshWorkflow") or "nessuno"
        rows.append(
            {
                "id": artifact.get("id", ""),
                "owner": artifact.get("owner", ""),
                "mode": mode,
                "period": period,
                "observed": observed,
                "url": official_url(artifact),
                "schedule": workflow_schedule(artifact.get("refreshWorkflow")),
                "workflow": workflow if isinstance(workflow, str) else "nessuno",
                "validation": validation_label(artifact),
                "verification": artifact.get("verificationMode", ""),
            }
        )

    lines = [
        "# Inventario degli snapshot pubblicati",
        "",
        "Inventario operativo richiesto da [#189](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/189).",
        "Non è la cadenza dichiarata dalla fonte: quella resta in",
        "[FRESHNESS_AND_REFRESH.md](FRESHNESS_AND_REFRESH.md).",
        "Qui si vede, per ogni artefatto committato: periodo nello snapshot,",
        "URL ufficiale, controlli, workflow, modo di aggiornamento e rollback.",
        "",
        "Questo file è generato da `scripts/ci/source-snapshot-inventory.py`.",
        "Dopo una modifica al registro o a un workflow di refresh:",
        "",
        "```bash",
        "python3 scripts/ci/source-snapshot-inventory.py --write",
        "```",
        "",
        "## Criterio di completamento",
        "",
        "Un aggiornamento nuovo deve essere rilevato, rigenerato, validato e",
        "proposto in PR senza modifiche manuali. Un errore della fonte deve",
        "fallire in modo visibile, senza pubblicare dati parziali. Nessun",
        "workflow scrive su `main`.",
        "",
        "## Riepilogo",
        "",
        f"- Artefatti nel registro: {len(rows)}",
        f"- {MODE_PR}: {counts[MODE_PR]} (data bot, branch `automation/data/*`, PR)",
        f"- {MODE_DETECT}: {counts[MODE_DETECT]} (controlla l'upstream, non pubblica)",
        f"- {MODE_CACHE}: {counts[MODE_CACHE]} (invalida tag, non tocca gli snapshot)",
        f"- {MODE_MANUAL}: {counts[MODE_MANUAL]} (PR umana dopo revisione)",
        "",
        "## Rollback per modo",
        "",
    ]
    for mode in (MODE_PR, MODE_DETECT, MODE_CACHE, MODE_MANUAL):
        lines.append(f"- **{mode}.** {ROLLBACK[mode]}")
    lines.extend(
        [
            "",
            "Responsabile operativo dei refresh automatici: GitHub App data bot",
            "(`DATA_BOT_APP_CLIENT_ID` nell'environment `source-operations`).",
            "La revisione e il merge restano umani.",
            "",
            "## Artefatti",
            "",
            "| Artefatto | Periodo nello snapshot | Osservazione | URL ufficiale | Controllo DVNS | Workflow | Modo | Validazione |",
            "|---|---|---|---|---|---|---|---|",
        ]
    )
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                markdown_cell(part)
                for part in (
                    f"`{row['id']}`",
                    row["period"],
                    row["observed"],
                    row["url"],
                    row["schedule"],
                    f"`{row['workflow']}`" if row["workflow"] != "nessuno" else "nessuno",
                    row["mode"],
                    row["validation"],
                )
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## Prossimo passo",
            "",
            "Automatizzare una sola fonte ancora in modo **manuale**, usando il",
            "publisher già gestito: branch dedicato, artefatti verificati, PR",
            "automatica, mai push su `main`. Non aprire un workflow unico che",
            "aggiorna tutto.",
            "",
        ]
    )
    return "\n".join(lines)


def write_doc() -> Path:
    DOC_PATH.write_text(render_markdown(), encoding="utf-8")
    return DOC_PATH


def check_doc() -> None:
    expected = render_markdown()
    if not DOC_PATH.is_file():
        raise SystemExit(f"missing {DOC_PATH.relative_to(ROOT)}; run with --write")
    actual = DOC_PATH.read_text(encoding="utf-8")
    if actual != expected:
        raise SystemExit(
            f"{DOC_PATH.relative_to(ROOT)} is stale; run "
            "python3 scripts/ci/source-snapshot-inventory.py --write"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true", help="Regenerate the committed inventory.")
    group.add_argument("--check", action="store_true", help="Fail if the committed inventory is stale.")
    args = parser.parse_args()
    if args.write:
        path = write_doc()
        print(path.relative_to(ROOT))
        return 0
    check_doc()
    print(f"{DOC_PATH.relative_to(ROOT)} is current")
    return 0


if __name__ == "__main__":
    sys.exit(main())

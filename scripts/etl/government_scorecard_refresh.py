#!/usr/bin/env python3
"""Refresh the registered scorecard pair, retaining the last valid release on failure."""
from __future__ import annotations

import argparse
import calendar
import copy
import datetime as dt
import json
import os
import tempfile
import subprocess
from pathlib import Path

try:
    from . import government_scorecard_snapshot as score
    from . import government_scorecard_page as page
    from . import government_scorecard_chronology as chronology
except ImportError:
    import government_scorecard_snapshot as score
    import government_scorecard_page as page
    import government_scorecard_chronology as chronology

ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = ROOT / "scripts/etl/specs/government-scorecard-page.source.json"


def load_policy(path):
    spec = score.load_json(path)
    if (spec.get("schemaVersion") != page.SCHEMA_VERSION
            or spec.get("snapshotVersion") != page.SNAPSHOT_VERSION
            or spec.get("geographies") != [code for code, _ in page.COUNTRIES]
            or spec.get("scoreImpact") != "none"
            or spec.get("sourceContract", {}).get("license") != {
                "ameco": "CC BY 4.0 unless otherwise indicated",
                "eurostat": "Free reuse with source acknowledgement, subject to the exceptions in the Eurostat copyright notice",
            }
            or spec.get("sourceContract", {}).get("termsUrls") != [
                "https://commission.europa.eu/legal-notice_en", page.EUROSTAT_TERMS,
            ]):
        score.fail("page provenance schema, identity or license drift")
    return spec["refreshPolicy"]


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def receipt(source):
    return {key: value for key, value in source.items() if key != "retrieved_at"}


def review_deadline(reviewed_at):
    chronology._iso_date(reviewed_at, "contextReview.reviewedAt")
    reviewed = dt.date.fromisoformat(reviewed_at)
    month = reviewed.month + 3
    year = reviewed.year + (month > 12)
    month = (month - 1) % 12 + 1
    return dt.date(year, month, min(reviewed.day, calendar.monthrange(year, month)[1]))


def validate_release(core, supplemental, registry, policy, checked_at=None):
    """The same offline contract gates both refresh and the existing publisher."""
    score.validate_snapshot(core)
    chronology.validate_registry(registry)
    page.validate(supplemental, core_hash=score.sha256(encoded(core)), chronology=registry)
    if set(policy) != {"contextReview", "approvedSources", "approvedPeriods", "coreArtifactSha256", "scoreAcquiredAt"}:
        score.fail("refresh policy: unexpected schema")
    if score.sha256(encoded(core)) != policy["coreArtifactSha256"] or core["sources"]["ameco"]["retrievedAt"] != policy["scoreAcquiredAt"]:
        score.fail("unreviewed score revision or core artifact hash")
    review = policy["contextReview"]
    if set(review) != {"reviewedAt", "contextsSha256", "chronologySha256"}:
        score.fail("context review: unexpected schema")
    review_deadline(review["reviewedAt"])
    checked_at = checked_at or dt.datetime.now(dt.UTC).date()
    if supplemental["as_of_date"] > checked_at.isoformat():
        score.fail("snapshot as_of_date exceeds validation date")
    if review["reviewedAt"] > supplemental["as_of_date"]:
        score.fail("context review date exceeds snapshot as_of_date")
    if (review["contextsSha256"] != page._canonical_hash(supplemental["contexts"])
            or review["chronologySha256"] != page._canonical_hash(registry)
            or review["reviewedAt"] < registry["verifiedAt"]):
        score.fail("context/government change requires a matching editorial review")
    for index, government in enumerate(registry["governments"]):
        context = supplemental["contexts"][index]
        oath = next(slide for slide in context["slides"] if slide["category"] == "chronology")["items"]
        end = registry["governments"][index + 1]["startDate"] if index + 1 < len(registry["governments"]) else None
        if (len(oath) != 1 or oath[0]["start_date"] != government["startDate"]
                or oath[0]["end_date_or_null"] != end
                or oath[0]["sources"] != [{"owner": government["sourceOwner"], "type": "official", "url": government["sourceUrl"]}]):
            score.fail("government transition: context chronology does not reconcile")
    expected = policy["approvedSources"]
    actual = [receipt(item) for item in supplemental["sources"]]
    if actual != expected:
        score.fail("source/schema/license/period/hash drift: review the acquired receipts before publication")
    if supplemental["sources"][0] != page._ameco_source(core):
        score.fail("AMECO receipt does not reconcile with score data")
    if supplemental["coverage"]["latest_published_periods"] != policy["approvedPeriods"]:
        score.fail("unexpected published period: review required")
    sources = {item["id"]: item for item in supplemental["sources"]}
    by_dataset = {item["dataset_code"]: item for item in supplemental["sources"]}
    for series in supplemental["series"]:
        for geography in series["geographies"]:
            for point in geography["points"]:
                if point["period_start"] != page._period_start(point["period"]):
                    score.fail("point period does not reconcile")
                if page._publication_status(point["upstream_status_or_null"]) != point["status"]:
                    score.fail("observed/forecast publication status mismatch")
                components = point.get("component_sources")
                if components:
                    for component in components:
                        source = by_dataset.get(component["dataset_code"], {})
                        if (component["raw_sha256"] != source.get("raw_sha256")
                                or component["source_url"] != source.get("query_url")):
                            score.fail("component receipt/hash mismatch")
                    hashes = [item["raw_sha256"] for item in components]
                    if series["indicator_id"] == "primary_balance":
                        hashes.append("B9+D41PAY")
                        derivation = point["derivation"]
                        if point["value"] != round(derivation["net_lending_percent_gdp"] + derivation["interest_payable_percent_gdp"], 4):
                            score.fail("primary balance does not reconcile")
                    if point["raw_sha256"] != page._canonical_hash(hashes):
                        score.fail("derived hash mismatch")
                else:
                    source = sources.get(point["source_id"], {})
                    for point_key, source_key in (("source_owner", "owner"), ("source_url", "query_url"),
                                                  ("retrieved_at", "retrieved_at"), ("raw_sha256", "raw_sha256")):
                        if point[point_key] != source.get(source_key):
                            score.fail("point receipt/hash mismatch")
                if series["usage"] == "score_and_context":
                    raw = next(item for item in core["indicators"] if item["id"] == series["indicator_id"])
                    country = dict(page.COUNTRIES)[geography["geography"]]
                    values = {item["year"]: item["value"] for item in raw["countries"][country]}
                    if point["year"] > core["sources"]["ameco"]["observedThrough"] or point["value"] != values.get(point["year"]):
                        score.fail("score display must use common observed AMECO values")


def preserve_unchanged_receipts(candidate, previous, reviewed_at):
    """A successful poll is recorded in the run log, never by rewriting acquisition dates."""
    previous_sources = {item["id"]: item for item in previous["sources"]}
    retained = {}
    for source in candidate["sources"]:
        old = previous_sources.get(source["id"])
        if old is not None and receipt(source) == receipt(old):
            source["retrieved_at"] = old["retrieved_at"]
            retained[source["id"]] = old["retrieved_at"]
    for series in candidate["series"]:
        for geography in series["geographies"]:
            for point in geography["points"]:
                if point["source_id"] in retained:
                    point["retrieved_at"] = retained[point["source_id"]]
                elif point.get("component_sources"):
                    components = point["component_sources"]
                    old_sources = {item["dataset_code"]: item for item in previous["sources"]}
                    if all(item["raw_sha256"] == old_sources.get(item["dataset_code"], {}).get("raw_sha256") for item in components):
                        old_series = next(item for item in previous["series"] if item["indicator_id"] == series["indicator_id"])
                        old_geo = next(item for item in old_series["geographies"] if item["geography"] == geography["geography"])
                        old_point = next((item for item in old_geo["points"] if item["period"] == point["period"]), None)
                        if old_point:
                            point["retrieved_at"] = old_point["retrieved_at"]
    without_date = lambda value: {key: item for key, item in value.items() if key != "as_of_date"}
    if without_date(candidate) == without_date(previous):
        candidate["as_of_date"] = max(previous["as_of_date"], reviewed_at)


def require_complete_update(candidate, previous):
    for series, old_series in zip(candidate["series"], previous["series"], strict=True):
        for geo, old_geo in zip(series["geographies"], old_series["geographies"], strict=True):
            if not {point["period"] for point in old_geo["points"]} <= {point["period"] for point in geo["points"]}:
                score.fail("partial update removed previously published observations")


def replace_release(outputs, validate):
    """Local rollback plus the publisher's single Git tree provide release atomicity.

    No running application reads this ETL workspace. A killed runner cannot reach
    the publish step; ordinary errors restore the exact original bytes locally.
    """
    originals = {path: path.read_bytes() for path in outputs}
    parent = next(iter(outputs)).parent
    # Prepare every candidate and rollback copy before replacing any file.
    # Rollback uses rename, so it needs no further allocation after a disk-full error.
    with tempfile.TemporaryDirectory(prefix=".scorecard-refresh-", dir=parent) as directory:
        staged = Path(directory)
        for index, (path, value) in enumerate(outputs.items()):
            with (staged / f"{index}.previous").open("wb") as handle:
                handle.write(originals[path])
                handle.flush()
                os.fsync(handle.fileno())
            score.atomic_write(staged / f"{index}.candidate", value)
        if any(path.read_bytes() != payload for path, payload in originals.items()):
            score.fail("scorecard changed concurrently; retry from a clean checkout")
        replaced = []
        try:
            for index, (path, value) in enumerate(outputs.items()):
                if encoded(value) != originals[path]:
                    os.replace(staged / f"{index}.candidate", path)
                    replaced.append((index, path))
            validate()
        except BaseException:
            for index, path in reversed(replaced):
                os.replace(staged / f"{index}.previous", path)
            raise


def refresh(retrieved_at, *, root=ROOT, fetch_score=score.download, build_page=page.build_snapshot, verify=None, observe=False):
    retrieved_at = page._timestamp(retrieved_at)
    score_path = root / "src/data/generated/government-scorecard.json"
    page_path = root / "src/data/generated/government-scorecard-page.json"
    registry = score.load_json(root / "scripts/etl/specs/government-scorecard-chronology.json")
    policy = load_policy(root / "scripts/etl/specs/government-scorecard-page.source.json")
    previous_core, previous_page = score.load_json(score_path), score.load_json(page_path)
    # Check bindings before network access; an expired review does not prevent
    # economic observation, but prevents publication after that observation.
    chronology.validate_registry(registry)
    spec = score.load_json(root / "scripts/etl/specs/government-scorecard.source.json")
    payload = fetch_score(spec["ameco"]["downloadUrl"])
    acquired_at = retrieved_at if observe else policy["scoreAcquiredAt"]
    candidate_core = score.build_snapshot(spec, payload, acquired_at)
    # Editorial caveats are reviewed content, not economic observations.
    candidate_core["caveats"] = previous_core["caveats"]
    score.validate_snapshot(candidate_core)  # requires the complete common observed panel
    old_core = copy.deepcopy(previous_core)
    old_core["generatedAt"] = acquired_at
    old_core["sources"]["ameco"]["retrievedAt"] = acquired_at
    if old_core == candidate_core:
        candidate_core = previous_core
    candidate_page = build_page(retrieved_at, core=candidate_core, chronology=registry,
                                existing=previous_page, core_hash=score.sha256(encoded(candidate_core)))
    preserve_unchanged_receipts(
        candidate_page,
        previous_page,
        policy["contextReview"]["reviewedAt"],
    )
    require_complete_update(candidate_page, previous_page)
    if observe:
        print(json.dumps({"approvedSources": [receipt(item) for item in candidate_page["sources"]],
                          "approvedPeriods": candidate_page["coverage"]["latest_published_periods"],
                          "scoreAcquiredAt": candidate_core["sources"]["ameco"]["retrievedAt"],
                          "coreArtifactSha256": score.sha256(encoded(candidate_core))}, ensure_ascii=False, indent=2))
        return False
    today = dt.date.fromisoformat(retrieved_at[:10])
    validate_release(candidate_core, candidate_page, registry, policy, checked_at=today)
    if today < dt.date.fromisoformat(policy["contextReview"]["reviewedAt"]):
        score.fail("context review date is in the future")
    if today >= review_deadline(policy["contextReview"]["reviewedAt"]):
        score.fail("quarterly context review overdue; last valid snapshot retained")
    changed = candidate_core != previous_core or candidate_page != previous_page
    if changed:
        replace_release({score_path: candidate_core, page_path: candidate_page}, verify or (lambda: None))
    print(f"observed official economic inputs at {retrieved_at}; changed={str(changed).lower()}; context review due {review_deadline(policy['contextReview']['reviewedAt'])}")
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--observe", action="store_true", help="print acquired receipts for human review without writing a candidate")
    args = parser.parse_args()
    def verify():
        subprocess.run(["npm", "run", "government-scorecard:verify"], cwd=ROOT, check=True)
        subprocess.run(["python3", "scripts/ci/source-snapshot-inventory.py", "--check"], cwd=ROOT, check=True)
    refresh(args.retrieved_at, verify=verify, observe=args.observe)


if __name__ == "__main__":
    main()

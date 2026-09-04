#!/usr/bin/env python3
"""Publish one approved generated-data refresh as a reviewed GitHub PR.

The caller supplies only ``--artifact-id``.  Registry metadata owns the file
allowlist, stable branch, titles, upstream URL(s), and workflow mapping.  This
module deliberately has no direct-main, merge, auto-merge, delete, force, or
unauthenticated fallback path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = ROOT / "scripts" / "ci" / "generated-artifacts.json"
BASE_BRANCH = "main"
BOT_NAME = "dove-vanno-i-nostri-soldi-bot"
BOT_EMAIL = "actions@users.noreply.github.com"
TRAILER_NAMES = (
    "Data-Refresh-Artifact",
    "Data-Refresh-Base",
    "Data-Refresh-Files-SHA256",
    "Data-Refresh-Run",
)
BRANCH_RE = re.compile(r"^automation/data/[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class PublishError(RuntimeError):
    """A fail-closed publication policy violation."""


@dataclass(frozen=True)
class Publication:
    branch: str
    commit_title: str
    pr_title: str
    upstream_url: str
    upstream_urls: tuple[str, ...] = ()


@dataclass(frozen=True)
class Artifact:
    artifact_id: str
    files: tuple[str, ...]
    workflow: str
    offline_command: str
    node_tests: tuple[str, ...]
    reconciliation_tests: tuple[str, ...]
    publication: Publication


@dataclass(frozen=True)
class RunContext:
    token: str
    repository: str
    server_url: str
    workflow_ref: str
    event_name: str
    ref_name: str
    sha: str
    run_id: str
    run_attempt: str
    run_url: str

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "RunContext":
        required = (
            "GH_TOKEN",
            "GITHUB_REPOSITORY",
            "GITHUB_SERVER_URL",
            "GITHUB_WORKFLOW_REF",
            "GITHUB_EVENT_NAME",
            "GITHUB_REF_NAME",
            "GITHUB_SHA",
            "GITHUB_RUN_ID",
            "GITHUB_RUN_ATTEMPT",
        )
        missing = [name for name in required if not env.get(name, "").strip()]
        if missing:
            raise PublishError(
                "missing required GitHub credentials or runtime environment: "
                + ", ".join(missing)
            )
        repository = env["GITHUB_REPOSITORY"]
        if repository.count("/") != 1:
            raise PublishError("GITHUB_REPOSITORY must be owner/name")
        server_url = env["GITHUB_SERVER_URL"].rstrip("/")
        if not server_url.startswith("https://"):
            raise PublishError("GITHUB_SERVER_URL must use HTTPS")
        if not SHA_RE.fullmatch(env["GITHUB_SHA"]):
            raise PublishError("GITHUB_SHA must be a 40-character commit SHA")
        run_url = env.get("GITHUB_RUN_URL") or (
            f"{server_url}/{repository}/actions/runs/{env['GITHUB_RUN_ID']}"
        )
        return cls(
            token=env["GH_TOKEN"],
            repository=repository,
            server_url=server_url,
            workflow_ref=env["GITHUB_WORKFLOW_REF"],
            event_name=env["GITHUB_EVENT_NAME"],
            ref_name=env["GITHUB_REF_NAME"],
            sha=env["GITHUB_SHA"],
            run_id=env["GITHUB_RUN_ID"],
            run_attempt=env["GITHUB_RUN_ATTEMPT"],
            run_url=run_url,
        )


@dataclass(frozen=True)
class BranchCommit:
    tip: str
    parent: str
    files: tuple[str, ...]
    subject: str
    trailers: Mapping[str, str]
    author_name: str
    author_email: str
    committer_name: str
    committer_email: str


@dataclass(frozen=True)
class PullRequest:
    number: int
    state: str
    title: str
    body: str
    head_ref: str
    base_ref: str
    head_sha: str
    base_sha: str
    merged_at: str | None


Runner = Callable[..., subprocess.CompletedProcess[str]]


def run_command(
    args: Sequence[str],
    *,
    env: Mapping[str, str] | None = None,
    input_text: str | None = None,
    check: bool = True,
    runner: Runner = subprocess.run,
) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    if env is not None:
        command_env.update(env)
    result = runner(
        list(args),
        cwd=ROOT,
        env=command_env,
        input=input_text,
        capture_output=True,
        text=True,
        check=False,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "command failed").strip()
        token = command_env.get("GH_TOKEN")
        if token:
            detail = detail.replace(token, "[redacted]")
        if "GH_TOKEN" in detail:
            detail = "GitHub command failed without exposing credentials"
        raise PublishError(f"{' '.join(args[:3])}: {detail[:500]}")
    return result


def _publication_upstream_urls(publication: Mapping[str, object], artifact_id: str) -> tuple[str, ...]:
    primary = publication.get("upstreamUrl")
    if not isinstance(primary, str) or not primary.strip():
        raise PublishError(f"publication metadata incomplete for {artifact_id}")
    configured = publication.get("upstreamUrls")
    if configured is None:
        candidates: Sequence[object] = (primary,)
    elif isinstance(configured, list) and configured:
        # Keep the singular field as the stable compatibility/primary value,
        # then retain registry order while removing duplicates.
        candidates = (primary, *configured)
    else:
        raise PublishError(f"publication.upstreamUrls must be a non-empty list for {artifact_id}")

    result: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not isinstance(candidate, str) or not candidate.strip():
            raise PublishError(f"publication upstream must be a non-empty HTTPS URL for {artifact_id}")
        parsed = urlparse(candidate)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise PublishError(f"publication upstream must be an HTTPS URL for {artifact_id}")
        if candidate not in seen:
            seen.add(candidate)
            result.append(candidate)
    return tuple(result)


def load_artifact(artifact_id: str, registry_path: Path = REGISTRY_PATH) -> Artifact:
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PublishError(f"cannot load generated-artifact registry: {exc}") from exc
    matches = [item for item in registry.get("artifacts", []) if item.get("id") == artifact_id]
    if len(matches) != 1:
        raise PublishError(f"unknown or duplicate artifact id: {artifact_id}")
    item = matches[0]
    publication = item.get("publication")
    offline = item.get("offlineCheck") or {}
    if not isinstance(publication, dict):
        raise PublishError(f"artifact is not eligible for source publication: {artifact_id}")
    required = ("branch", "commitTitle", "prTitle", "upstreamUrl")
    if any(not isinstance(publication.get(field), str) or not publication[field].strip() for field in required):
        raise PublishError(f"publication metadata incomplete for {artifact_id}")
    if not BRANCH_RE.fullmatch(publication["branch"]):
        raise PublishError(f"invalid managed publication branch for {artifact_id}")
    upstream_urls = _publication_upstream_urls(publication, artifact_id)
    if item.get("verificationMode") != "online-refresh":
        raise PublishError(f"artifact is not an online source refresh: {artifact_id}")
    if not item.get("refreshWorkflow") or not item.get("generator", {}).get("requiresNetworkInput"):
        raise PublishError(f"artifact is not source-only publication eligible: {artifact_id}")
    if offline.get("coveredBy") != "standalone" or not offline.get("command"):
        raise PublishError(f"artifact lacks a standalone validator: {artifact_id}")
    files = tuple(item.get("files") or ())
    if not files or any(not isinstance(path, str) or not path for path in files):
        raise PublishError(f"artifact has no valid generated file allowlist: {artifact_id}")
    return Artifact(
        artifact_id=artifact_id,
        files=files,
        workflow=item["refreshWorkflow"],
        offline_command=offline["command"],
        node_tests=tuple(item.get("nodeTests") or ()),
        reconciliation_tests=tuple(item.get("reconciliationTests") or ()),
        publication=Publication(
            branch=publication["branch"],
            commit_title=publication["commitTitle"],
            pr_title=publication["prTitle"],
            upstream_url=publication["upstreamUrl"],
            upstream_urls=upstream_urls,
        ),
    )


def validate_run(artifact: Artifact, run: RunContext) -> None:
    if run.event_name not in {"schedule", "workflow_dispatch"}:
        raise PublishError(f"unsupported publication event: {run.event_name}")
    if run.ref_name != BASE_BRANCH:
        raise PublishError("source publication must run from main")
    expected_ref = f"{run.repository}/{artifact.workflow}@refs/heads/{BASE_BRANCH}"
    if run.workflow_ref != expected_ref:
        raise PublishError(f"workflow mapping mismatch: expected {expected_ref}, got {run.workflow_ref}")


def normalized_repo_path(path: str) -> str:
    candidate = Path(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise PublishError(f"unsafe repository path: {path}")
    return candidate.as_posix()


def allowlisted_paths(artifact: Artifact) -> set[str]:
    normalized = {normalized_repo_path(path) for path in artifact.files}
    if len(normalized) != len(artifact.files):
        raise PublishError(f"duplicate generated file in registry for {artifact.artifact_id}")
    root = (ROOT / "src/data/generated").resolve()
    for path in normalized:
        resolved = (ROOT / path).resolve()
        if resolved != root and root not in resolved.parents:
            raise PublishError(f"generated file escapes the generated-data root: {path}")
        if (ROOT / path).is_symlink():
            raise PublishError(f"generated file must not be a symlink: {path}")
    return normalized


def status_paths(artifact: Artifact, *, runner: Runner = subprocess.run) -> set[str]:
    result = run_command(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        runner=runner,
    )
    changed: set[str] = set()
    for line in result.stdout.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]
        if " -> " in path:
            raise PublishError("renames are not permitted in generated-data publication")
        changed.add(normalized_repo_path(path))
    allowed = allowlisted_paths(artifact)
    unexpected = changed - allowed
    if unexpected:
        raise PublishError("unexpected tracked or untracked changed path(s): " + ", ".join(sorted(unexpected)))
    missing = [path for path in artifact.files if not (ROOT / path).is_file()]
    if missing:
        raise PublishError("registry-listed generated file is missing: " + ", ".join(missing))
    return changed


def file_digest(artifact: Artifact) -> str:
    digest = hashlib.sha256()
    for path in sorted(artifact.files):
        payload = (ROOT / path).read_bytes()
        encoded_path = path.encode("utf-8")
        digest.update(len(encoded_path).to_bytes(8, "big"))
        digest.update(encoded_path)
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()


def ref_file_digest(ref: str, artifact: Artifact, *, runner: Runner = subprocess.run) -> str:
    """Hash exactly the allowlisted blobs from a candidate commit tree."""
    digest = hashlib.sha256()
    for path in sorted(artifact.files):
        result = run_command(["git", "show", f"{ref}:{path}"], runner=runner)
        payload = result.stdout.encode("utf-8")
        encoded_path = path.encode("utf-8")
        digest.update(len(encoded_path).to_bytes(8, "big"))
        digest.update(encoded_path)
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()


def parse_trailers(body: str) -> dict[str, str]:
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if len(lines) != len(TRAILER_NAMES) or any(":" not in line for line in lines):
        raise PublishError("managed candidate commit has unexpected body/trailers")
    parsed: dict[str, str] = {}
    for line in lines:
        name, value = line.split(":", 1)
        name = name.strip()
        value = value.strip()
        if name not in TRAILER_NAMES or name in parsed or not value:
            raise PublishError("managed candidate commit has unknown or duplicate trailers")
        parsed[name] = value
    if set(parsed) != set(TRAILER_NAMES):
        raise PublishError("managed candidate commit is missing a required trailer")
    return parsed


def provenance_body(
    artifact: Artifact,
    run: RunContext,
    *,
    base_sha: str,
    candidate_sha: str,
    digest: str,
) -> str:
    validators = list(artifact.reconciliation_tests) + list(artifact.node_tests)
    validator_text = ", ".join(validators) if validators else "(registry offline check only)"
    files = "\n".join(f"- `{path}`" for path in artifact.files)
    upstream_urls = artifact.publication.upstream_urls or (artifact.publication.upstream_url,)
    upstream_details = ""
    if len(upstream_urls) > 1:
        upstream_details = "Upstreams:\n" + "\n".join(f"- {url}" for url in upstream_urls) + "\n"
    return (
        "<!-- dvns-data-refresh:v1 -->\n"
        f"Source artifact: `{artifact.artifact_id}`\n\n"
        f"Upstream: {artifact.publication.upstream_url}\n"
        f"{upstream_details}"
        f"Base branch: `main`\n"
        f"Base SHA: `{base_sha}`\n"
        f"Candidate SHA: `{candidate_sha}`\n"
        f"Files SHA-256: `{digest}`\n"
        f"Workflow run: {run.run_url} (attempt {run.run_attempt})\n"
        f"Workflow ref: `{run.workflow_ref}`\n\n"
        "Generated files:\n"
        f"{files}\n\n"
        f"Offline validator: `{artifact.offline_command}`\n"
        f"Runtime/reconciliation validators: {validator_text}\n\n"
        "This PR requires maintainer review. Automatic merge is disabled."
    )


def commit_message(artifact: Artifact, run: RunContext, base_sha: str, digest: str) -> str:
    return (
        f"{artifact.publication.commit_title}\n\n"
        f"Data-Refresh-Artifact: {artifact.artifact_id}\n"
        f"Data-Refresh-Base: {base_sha}\n"
        f"Data-Refresh-Files-SHA256: {digest}\n"
        f"Data-Refresh-Run: {run.run_url}/attempt/{run.run_attempt}"
    )


def parse_branch_commit(tip: str, *, runner: Runner = subprocess.run) -> BranchCommit:
    parent_line = run_command(["git", "rev-list", "--parents", "-n", "1", tip], runner=runner).stdout.strip()
    fields = parent_line.split()
    if len(fields) != 2:
        raise PublishError("existing managed branch tip is a merge or has no parent")
    subject = run_command(["git", "show", "-s", "--format=%s", tip], runner=runner).stdout.strip()
    identity = run_command(
        ["git", "show", "-s", "--format=%an%n%ae%n%cn%n%ce", tip],
        runner=runner,
    ).stdout.splitlines()
    if len(identity) != 4:
        raise PublishError("existing managed branch commit has incomplete identity metadata")
    body = run_command(["git", "show", "-s", "--format=%b", tip], runner=runner).stdout
    files = tuple(
        line.strip()
        for line in run_command(
            ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", tip + "^", tip],
            runner=runner,
        ).stdout.splitlines()
        if line.strip()
    )
    return BranchCommit(
        tip=fields[0],
        parent=fields[1],
        files=files,
        subject=subject,
        trailers=parse_trailers(body),
        author_name=identity[0],
        author_email=identity[1],
        committer_name=identity[2],
        committer_email=identity[3],
    )


def validate_existing_commit(
    commit: BranchCommit,
    artifact: Artifact,
    *,
    base_sha: str | None = None,
    digest: str | None = None,
) -> None:
    if commit.subject != artifact.publication.commit_title:
        raise PublishError("existing branch commit subject is not managed by this source")
    if (
        commit.author_name != BOT_NAME
        or commit.author_email != BOT_EMAIL
        or commit.committer_name != BOT_NAME
        or commit.committer_email != BOT_EMAIL
    ):
        raise PublishError("existing branch commit has human or tampered author/committer identity")
    allowed = allowlisted_paths(artifact)
    if not commit.files or set(commit.files) - allowed:
        raise PublishError("existing branch commit changes an unallowlisted path")
    if commit.trailers.get("Data-Refresh-Artifact") != artifact.artifact_id:
        raise PublishError("existing branch commit has tampered artifact trailer")
    if digest is not None and commit.trailers.get("Data-Refresh-Files-SHA256") != digest:
        raise PublishError("existing branch commit has a different generated-data digest")
    if not re.fullmatch(r"[0-9a-f]{64}", commit.trailers.get("Data-Refresh-Files-SHA256", "")):
        raise PublishError("existing branch commit has an invalid files digest trailer")
    trailer_base = commit.trailers.get("Data-Refresh-Base", "")
    if not SHA_RE.fullmatch(trailer_base) or trailer_base != commit.parent:
        raise PublishError("existing branch commit has inconsistent parent/base provenance")
    run_url = commit.trailers.get("Data-Refresh-Run", "")
    if not run_url.startswith("https://"):
        raise PublishError("existing branch commit has an invalid run trailer")
    if base_sha is not None and commit.parent != base_sha:
        raise PublishError("existing branch commit is not based on the expected main SHA")


def validate_single_candidate_ancestry(
    commit: BranchCommit, *, runner: Runner = subprocess.run
) -> None:
    count = run_command(
        ["git", "rev-list", "--count", f"{commit.parent}..{commit.tip}"],
        runner=runner,
    ).stdout.strip()
    if count != "1":
        raise PublishError("managed branch must contain exactly one candidate commit atop its base")


def _provenance_field(body: str, label: str) -> str | None:
    match = re.search(rf"^{re.escape(label)}: `?([^`\n]+)`?$", body, re.MULTILINE)
    return match.group(1) if match else None


def _provenance_list(body: str, label: str) -> tuple[str, ...]:
    match = re.search(
        rf"^{re.escape(label)}:\n(?P<items>(?:- [^\n]+\n?)+)",
        body,
        re.MULTILINE,
    )
    if not match:
        return ()
    return tuple(line[2:] for line in match.group("items").splitlines() if line.startswith("- "))


def managed_pr_matches(
    pr: PullRequest, artifact: Artifact, branch: BranchCommit, expected_workflow_ref: str
) -> bool:
    files_match = re.search(r"Generated files:\n(?P<files>(?:- `[^`]+`\n?)+)", pr.body)
    listed_files = tuple(re.findall(r"- `([^`]+)`", files_match.group("files"))) if files_match else ()
    validators = list(artifact.reconciliation_tests) + list(artifact.node_tests)
    validator_text = ", ".join(validators) if validators else "(registry offline check only)"
    expected_upstreams = artifact.publication.upstream_urls or (artifact.publication.upstream_url,)
    listed_upstreams = _provenance_list(pr.body, "Upstreams")
    run_trailer = branch.trailers.get("Data-Refresh-Run", "")
    workflow_run = _provenance_field(pr.body, "Workflow run")
    if workflow_run:
        workflow_run = re.sub(r"\s+\(attempt \d+\)$", "", workflow_run)
    body_workflow_ref = _provenance_field(pr.body, "Workflow ref")
    return (
        (pr.state.upper() == "OPEN" or pr.merged_at or pr.state.upper() == "MERGED")
        and pr.head_ref == artifact.publication.branch
        and pr.base_ref == BASE_BRANCH
        and pr.head_sha == branch.tip
        and pr.base_sha == branch.parent
        and pr.title == artifact.publication.pr_title
        and "<!-- dvns-data-refresh:v1 -->" in pr.body
        and _provenance_field(pr.body, "Source artifact") == artifact.artifact_id
        and _provenance_field(pr.body, "Upstream") == artifact.publication.upstream_url
        and listed_upstreams == (expected_upstreams if len(expected_upstreams) > 1 else ())
        and _provenance_field(pr.body, "Base SHA") == branch.parent
        and _provenance_field(pr.body, "Candidate SHA") == branch.tip
        and _provenance_field(pr.body, "Files SHA-256") == branch.trailers.get("Data-Refresh-Files-SHA256")
        and listed_files == tuple(artifact.files)
        and _provenance_field(pr.body, "Offline validator") == artifact.offline_command
        and _provenance_field(pr.body, "Runtime/reconciliation validators") == validator_text
        and workflow_run is not None
        and run_trailer.startswith(workflow_run + "/attempt/")
        and body_workflow_ref == expected_workflow_ref
    )


def relevant_tip_prs(prs: Sequence[PullRequest], branch: str, tip: str) -> list[PullRequest]:
    return [
        pr for pr in prs
        if pr.head_ref == branch and pr.base_ref == BASE_BRANCH and pr.head_sha == tip
    ]


def classify_existing_pr(
    pr: PullRequest,
    artifact: Artifact,
    branch: BranchCommit,
    *,
    current_base: str,
    current_digest: str,
    changed: bool,
    expected_workflow_ref: str,
) -> str:
    if not managed_pr_matches(pr, artifact, branch, expected_workflow_ref):
        raise PublishError("pull request provenance or title was tampered")
    branch_digest = branch.trailers["Data-Refresh-Files-SHA256"]
    if pr.state.upper() == "OPEN":
        exact = branch.parent == current_base and branch_digest == current_digest
        if exact:
            return "ALREADY_PUBLISHED"
        if not changed:
            raise PublishError("no-change cannot legitimize a stale or different open candidate")
        return "REPLACE"
    if branch_digest == current_digest:
        return "NO_CHANGE"
    if not changed:
        raise PublishError("no-change cannot legitimize a stale merged candidate")
    return "REPLACE"


class GhClient:
    def __init__(self, run: RunContext, *, runner: Runner = subprocess.run) -> None:
        self.run = run
        self.runner = runner
        self.env = {"GH_TOKEN": run.token}

    def setup_git(self) -> None:
        run_command(["gh", "auth", "setup-git"], env=self.env, runner=self.runner)

    def prs(self, branch: str) -> list[PullRequest]:
        result = run_command(
            [
                "gh", "pr", "list", "--repo", self.run.repository, "--state", "all",
                "--base", BASE_BRANCH, "--head", branch, "--limit", "1000", "--json",
                "number,state,title,body,headRefName,baseRefName,headRefOid,baseRefOid,mergedAt",
            ],
            env=self.env,
            runner=self.runner,
        )
        try:
            payload = json.loads(result.stdout or "[]")
        except json.JSONDecodeError as exc:
            raise PublishError("gh returned invalid pull-request JSON") from exc
        return [
            PullRequest(
                number=int(item["number"]),
                state=str(item.get("state", "")),
                title=str(item.get("title", "")),
                body=str(item.get("body", "")),
                head_ref=str(item.get("headRefName", "")),
                base_ref=str(item.get("baseRefName", "")),
                head_sha=str(item.get("headRefOid", "")),
                base_sha=str(item.get("baseRefOid", "")),
                merged_at=item.get("mergedAt"),
            )
            for item in payload
        ]

    def create_pr(self, artifact: Artifact, body: str) -> int:
        result = run_command(
            [
                "gh", "pr", "create", "--repo", self.run.repository,
                "--base", BASE_BRANCH, "--head", artifact.publication.branch,
                "--title", artifact.publication.pr_title, "--body", body,
            ],
            env=self.env,
            runner=self.runner,
        )
        match = re.search(r"/pull/(\d+)(?:\s|$)", result.stdout.strip())
        if not match:
            raise PublishError("gh did not return a pull-request URL")
        return int(match.group(1))

    def update_pr(self, number: int, artifact: Artifact, body: str) -> None:
        run_command(
            [
                "gh", "pr", "edit", str(number), "--repo", self.run.repository,
                "--title", artifact.publication.pr_title, "--body", body,
            ],
            env=self.env,
            runner=self.runner,
        )


def git_sha(ref: str, *, runner: Runner = subprocess.run) -> str:
    return run_command(["git", "rev-parse", ref], runner=runner).stdout.strip()


def latest_main(*, runner: Runner = subprocess.run) -> str:
    run_command(["git", "fetch", "--no-tags", "origin", BASE_BRANCH], runner=runner)
    value = git_sha("refs/remotes/origin/main", runner=runner)
    if not SHA_RE.fullmatch(value):
        raise PublishError("origin/main did not resolve to a commit SHA")
    return value


def remote_branch_tip(branch: str, *, runner: Runner = subprocess.run) -> str | None:
    result = run_command(
        ["git", "ls-remote", "--heads", "origin", f"refs/heads/{branch}"],
        check=False,
        runner=runner,
    )
    if result.returncode != 0:
        raise PublishError("unable to inspect the managed remote branch")
    if not result.stdout.strip():
        return None
    value = result.stdout.split()[0]
    if not SHA_RE.fullmatch(value):
        raise PublishError("managed branch resolved to an invalid SHA")
    remote_ref = f"refs/remotes/origin/{branch}"
    run_command(
        ["git", "fetch", "--no-tags", "origin", f"+refs/heads/{branch}:{remote_ref}"],
        runner=runner,
    )
    return value


def make_candidate(
    artifact: Artifact,
    run: RunContext,
    base_sha: str,
    digest: str,
    *,
    runner: Runner = subprocess.run,
) -> str:
    """Write one commit object from dirty allowlisted files without switching HEAD."""
    with tempfile.NamedTemporaryFile(prefix="dvns-refresh-index-", delete=True) as index:
        index_path = index.name
    try:
        index_env = {"GIT_INDEX_FILE": index_path}
        run_command(["git", "read-tree", base_sha], env=index_env, runner=runner)
        run_command(["git", "add", "--", *artifact.files], env=index_env, runner=runner)
        tree = run_command(["git", "write-tree"], env=index_env, runner=runner).stdout.strip()
        message = commit_message(artifact, run, base_sha, digest)
        commit_env = {
            "GIT_AUTHOR_NAME": BOT_NAME,
            "GIT_AUTHOR_EMAIL": BOT_EMAIL,
            "GIT_COMMITTER_NAME": BOT_NAME,
            "GIT_COMMITTER_EMAIL": BOT_EMAIL,
        }
        commit = run_command(
            ["git", "commit-tree", tree, "-p", base_sha],
            env=commit_env,
            input_text=message + "\n",
            runner=runner,
        ).stdout.strip()
        if not SHA_RE.fullmatch(commit):
            raise PublishError("git did not return a valid candidate commit SHA")
        return commit
    finally:
        try:
            Path(index_path).unlink()
        except FileNotFoundError:
            pass


def push_candidate(
    branch: str,
    candidate: str,
    *,
    observed_tip: str | None,
    runner: Runner = subprocess.run,
) -> None:
    if branch == BASE_BRANCH or branch.startswith("automation/data/main"):
        raise PublishError("refusing to publish a candidate to main")
    if observed_tip is None:
        run_command(["git", "push", "origin", f"{candidate}:refs/heads/{branch}"], runner=runner)
        return
    run_command(
        [
            "git", "push", "--force-with-lease",
            f"--force-with-lease=refs/heads/{branch}:{observed_tip}",
            "origin", f"{candidate}:refs/heads/{branch}",
        ],
        runner=runner,
    )


def confirm_pr(
    gh: GhClient,
    artifact: Artifact,
    branch: BranchCommit,
    number: int,
    expected_workflow_ref: str,
) -> None:
    matches = [
        pr for pr in relevant_tip_prs(gh.prs(artifact.publication.branch), artifact.publication.branch, branch.tip)
        if pr.number == number
    ]
    if len(matches) != 1 or not managed_pr_matches(matches[0], artifact, branch, expected_workflow_ref):
        raise PublishError("created or updated pull request failed managed provenance validation")


def publish(
    artifact_id: str,
    *,
    env: Mapping[str, str] | None = None,
    runner: Runner = subprocess.run,
) -> str:
    environment = dict(env or os.environ)
    run = RunContext.from_env(environment)
    artifact = load_artifact(artifact_id)
    validate_run(artifact, run)
    gh = GhClient(run, runner=runner)
    gh.setup_git()
    base_before = latest_main(runner=runner)
    head = git_sha("HEAD", runner=runner)
    if head != base_before:
        raise PublishError("checked-out HEAD is not the exact latest origin/main")
    changed = status_paths(artifact, runner=runner)
    digest = file_digest(artifact)
    observed_tip = remote_branch_tip(artifact.publication.branch, runner=runner)
    prs = gh.prs(artifact.publication.branch)
    if observed_tip is None and not changed:
        return "NO_CHANGE"

    existing: BranchCommit | None = None
    replacement_pr: PullRequest | None = None
    if observed_tip is not None:
        existing = parse_branch_commit(observed_tip, runner=runner)
        validate_existing_commit(existing, artifact, digest=None)
        validate_single_candidate_ancestry(existing, runner=runner)
        if ref_file_digest(existing.tip, artifact, runner=runner) != existing.trailers["Data-Refresh-Files-SHA256"]:
            raise PublishError("managed branch tree does not match its files digest trailer")
        tip_prs = relevant_tip_prs(prs, artifact.publication.branch, existing.tip)
        if len(tip_prs) == 0:
            if existing.parent != base_before or existing.trailers["Data-Refresh-Files-SHA256"] != digest:
                raise PublishError("managed branch without a relevant pull request is stale or tampered")
            body = provenance_body(artifact, run, base_sha=existing.parent, candidate_sha=existing.tip, digest=digest)
            number = gh.create_pr(artifact, body)
            confirm_pr(gh, artifact, existing, number, run.workflow_ref)
            return "CREATED"
        if len(tip_prs) != 1:
            raise PublishError("existing managed branch must have exactly one relevant pull request")
        current_pr = tip_prs[0]
        if current_pr.state.upper() == "CLOSED" and not current_pr.merged_at:
            raise PublishError("relevant pull request was closed without merging")
        action = classify_existing_pr(
            current_pr, artifact, existing, current_base=base_before,
            current_digest=digest, changed=bool(changed), expected_workflow_ref=run.workflow_ref,
        )
        if action == "ALREADY_PUBLISHED":
            return action
        if action == "NO_CHANGE":
            return action
        if current_pr.state.upper() == "OPEN":
            replacement_pr = current_pr

    observed_base = latest_main(runner=runner)
    if observed_base != base_before:
        raise PublishError("origin/main moved after generation; rerun the generator from the new main")
    candidate = make_candidate(artifact, run, base_before, digest, runner=runner)
    push_candidate(artifact.publication.branch, candidate, observed_tip=observed_tip, runner=runner)
    body = provenance_body(artifact, run, base_sha=base_before, candidate_sha=candidate, digest=digest)
    prs = gh.prs(artifact.publication.branch)
    candidate_branch = parse_branch_commit(candidate, runner=runner)
    validate_single_candidate_ancestry(candidate_branch, runner=runner)
    if ref_file_digest(candidate, artifact, runner=runner) != digest:
        raise PublishError("candidate tree does not match its generated-data digest")
    candidate_prs = relevant_tip_prs(prs, artifact.publication.branch, candidate)
    if replacement_pr is not None:
        if len(candidate_prs) > 1 or not any(pr.number == replacement_pr.number for pr in candidate_prs):
            raise PublishError("replacement pull request does not match candidate provenance")
        gh.update_pr(replacement_pr.number, artifact, body)
        confirm_pr(gh, artifact, candidate_branch, replacement_pr.number, run.workflow_ref)
        return "ALREADY_PUBLISHED"
    open_candidates = [pr for pr in candidate_prs if pr.state.upper() == "OPEN"]
    if len(open_candidates) > 1:
        raise PublishError("multiple open pull requests exist after branch publication")
    if open_candidates:
        if not managed_pr_matches(open_candidates[0], artifact, candidate_branch, run.workflow_ref):
            raise PublishError("existing open pull request provenance or title was tampered")
        gh.update_pr(open_candidates[0].number, artifact, body)
        confirm_pr(gh, artifact, candidate_branch, open_candidates[0].number, run.workflow_ref)
        return "ALREADY_PUBLISHED"
    number = gh.create_pr(artifact, body)
    confirm_pr(gh, artifact, candidate_branch, number, run.workflow_ref)
    return "CREATED"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish one generated-data refresh as a reviewed PR")
    parser.add_argument("--artifact-id", required=True)
    args = parser.parse_args(argv)
    try:
        result = publish(args.artifact_id)
    except PublishError as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 1
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

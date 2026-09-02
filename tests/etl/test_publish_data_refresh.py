"""Focused pure and fake-runner tests for the generated-data PR publisher."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import TestCase, main, mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ci" / "publish-data-refresh.py"
SPEC = importlib.util.spec_from_file_location("publish_data_refresh", SCRIPT)
assert SPEC and SPEC.loader
publisher = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = publisher
SPEC.loader.exec_module(publisher)


class PublishDataRefreshTests(TestCase):
    def test_registry_has_only_managed_source_publications(self) -> None:
        registry = json.loads((ROOT / "scripts/ci/generated-artifacts.json").read_text())
        publications = {
            artifact["id"]: artifact["publication"]
            for artifact in registry["artifacts"]
            if artifact.get("publication") is not None
        }
        self.assertEqual(
            set(publications),
            {
                "company-atlas",
                "consulenti-pubblici",
                "government-scorecard",
                "mef-participations",
                "opencivitas-2022",
                "opencoesione",
                "public-debt",
                "siope-municipal",
            },
        )
        self.assertEqual(
            {item["branch"] for item in publications.values()},
            {
                "automation/data/company-atlas",
                "automation/data/consulenti",
                "automation/data/government-scorecard",
                "automation/data/mef-participations",
                "automation/data/opencivitas",
                "automation/data/opencoesione",
                "automation/data/public-debt",
                "automation/data/siope",
            },
        )
        for publication in publications.values():
            artifact = next(item for item in registry["artifacts"] if item.get("publication") == publication)
            self.assertIn("managed PR candidate", artifact["trustModel"])
            self.assertNotIn("commits the snapshot", artifact["trustModel"])

        government = next(
            item for item in registry["artifacts"] if item["id"] == "government-scorecard"
        )
        self.assertEqual(
            government["sourceSpecs"],
            [
                "scripts/etl/specs/government-scorecard.source.json",
                "scripts/etl/specs/government-scorecard-methodology.json",
                "scripts/etl/specs/government-current-signals.source.json",
            ],
        )
        self.assertEqual(len(government["publication"]["upstreamUrls"]), 8)
        self.assertIn(
            government["publication"]["upstreamUrl"],
            government["publication"]["upstreamUrls"],
        )
        self.assertEqual(
            government["publication"]["upstreamUrls"][3:],
            [
                item["pageUrl"]
                for item in json.loads(
                    (ROOT / "scripts/etl/specs/government-scorecard.source.json").read_text()
                )["governmentChronology"]["historicalPages"]
            ],
        )

    def test_publication_upstreams_preserve_order_and_dedupe(self) -> None:
        registry = json.loads((ROOT / "scripts/ci/generated-artifacts.json").read_text())
        government = next(item for item in registry["artifacts"] if item["id"] == "government-scorecard")
        primary = government["publication"]["upstreamUrl"]
        government["publication"]["upstreamUrls"] = [
            primary,
            "https://example.test/second-source",
            primary,
            "https://example.test/third-source",
        ]
        with tempfile.TemporaryDirectory() as directory:
            registry_path = Path(directory) / "registry.json"
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
            artifact = publisher.load_artifact("government-scorecard", registry_path)
        self.assertEqual(
            artifact.publication.upstream_urls,
            (primary, "https://example.test/second-source", "https://example.test/third-source"),
        )

    def test_multi_upstream_provenance_body_lists_all_sources(self) -> None:
        artifact = publisher.load_artifact("government-scorecard")
        run = publisher.RunContext(
            token="secret",
            repository="owner/repo",
            server_url="https://github.com",
            workflow_ref="owner/repo/.github/workflows/government-scorecard-refresh.yml@refs/heads/main",
            event_name="schedule",
            ref_name="main",
            sha="a" * 40,
            run_id="1",
            run_attempt="1",
            run_url="https://github.com/owner/repo/actions/runs/1",
        )
        body = publisher.provenance_body(
            artifact, run, base_sha="a" * 40, candidate_sha="b" * 40, digest="c" * 64
        )
        start = body.index("Upstreams:\n")
        end = body.index("Base branch:", start)
        self.assertEqual(
            body[start:end],
            "Upstreams:\n" + "\n".join(f"- {url}" for url in artifact.publication.upstream_urls) + "\n",
        )
        self.assertIn("Upstream: " + artifact.publication.upstream_url, body)

    def test_multi_upstream_provenance_is_required_for_managed_pr_matching(self) -> None:
        artifact = publisher.load_artifact("government-scorecard")
        tip = "a" * 40
        parent = "b" * 40
        digest = "c" * 64
        run_url = "https://github.com/owner/repo/actions/runs/1"
        workflow_ref = "owner/repo/.github/workflows/government-scorecard-refresh.yml@refs/heads/main"
        branch = publisher.BranchCommit(
            tip=tip,
            parent=parent,
            files=tuple(artifact.files),
            subject=artifact.publication.commit_title,
            trailers={
                "Data-Refresh-Artifact": artifact.artifact_id,
                "Data-Refresh-Base": parent,
                "Data-Refresh-Files-SHA256": digest,
                "Data-Refresh-Run": run_url + "/attempt/1",
            },
            author_name=publisher.BOT_NAME,
            author_email=publisher.BOT_EMAIL,
            committer_name=publisher.BOT_NAME,
            committer_email=publisher.BOT_EMAIL,
        )
        run = publisher.RunContext(
            token="secret",
            repository="owner/repo",
            server_url="https://github.com",
            workflow_ref=workflow_ref,
            event_name="schedule",
            ref_name="main",
            sha=tip,
            run_id="1",
            run_attempt="1",
            run_url=run_url,
        )
        body = publisher.provenance_body(
            artifact, run, base_sha=parent, candidate_sha=tip, digest=digest
        )
        pr = publisher.PullRequest(
            number=1,
            state="OPEN",
            title=artifact.publication.pr_title,
            body=body,
            head_ref=artifact.publication.branch,
            base_ref="main",
            head_sha=tip,
            base_sha=parent,
            merged_at=None,
        )
        self.assertTrue(publisher.managed_pr_matches(pr, artifact, branch, workflow_ref))
        tampered = publisher.PullRequest(**{
            **pr.__dict__,
            "body": body.replace(artifact.publication.upstream_urls[-1], "https://example.test/tampered"),
        })
        self.assertFalse(publisher.managed_pr_matches(tampered, artifact, branch, workflow_ref))

    def test_missing_credentials_fails_before_runner(self) -> None:
        with self.assertRaises(publisher.PublishError):
            publisher.RunContext.from_env({})

    def test_unexpected_tracked_or_untracked_path_fails_closed(self) -> None:
        artifact = publisher.load_artifact("consulenti-pubblici")
        completed = subprocess.CompletedProcess(
            ["git", "status"],
            0,
            " M src/data/generated/consulenti-overview.json\n?? secrets.txt\n",
            "",
        )
        with self.assertRaisesRegex(publisher.PublishError, "unexpected"):
            publisher.status_paths(artifact, runner=lambda *args, **kwargs: completed)

    def test_no_direct_main_push_is_possible(self) -> None:
        with self.assertRaisesRegex(publisher.PublishError, "main"):
            publisher.push_candidate("main", "a" * 40, observed_tip=None, runner=subprocess.run)

    def test_new_branch_push_does_not_target_main(self) -> None:
        calls: list[list[str]] = []

        def fake_runner(args, **kwargs):
            calls.append(list(args))
            return subprocess.CompletedProcess(args, 0, "", "")

        publisher.push_candidate(
            "automation/data/consulenti",
            "a" * 40,
            observed_tip=None,
            runner=fake_runner,
        )
        self.assertEqual(
            calls,
            [["git", "push", "origin", "a" * 40 + ":refs/heads/automation/data/consulenti"]],
        )
        self.assertNotIn("main", " ".join(calls[0]))

    def test_replacement_uses_exact_force_with_lease_tip(self) -> None:
        calls: list[list[str]] = []

        def fake_runner(args, **kwargs):
            calls.append(list(args))
            return subprocess.CompletedProcess(args, 0, "", "")

        publisher.push_candidate(
            "automation/data/siope",
            "a" * 40,
            observed_tip="b" * 40,
            runner=fake_runner,
        )
        self.assertEqual(calls[0][0:3], ["git", "push", "--force-with-lease"])
        self.assertIn(
            "--force-with-lease=refs/heads/automation/data/siope:" + "b" * 40,
            calls[0],
        )
        self.assertEqual(calls[0][-1], "a" * 40 + ":refs/heads/automation/data/siope")

    def test_managed_branch_tamper_is_rejected(self) -> None:
        artifact = publisher.load_artifact("consulenti-pubblici")
        commit = publisher.BranchCommit(
            tip="a" * 40,
            parent="b" * 40,
            files=("src/data/generated/consulenti-overview.json", "src/secret.txt"),
            subject=artifact.publication.commit_title,
            trailers={
                "Data-Refresh-Artifact": artifact.artifact_id,
                "Data-Refresh-Base": "b" * 40,
                "Data-Refresh-Files-SHA256": "c" * 64,
                "Data-Refresh-Run": "https://github.com/owner/repo/actions/runs/1/attempt/1",
            },
            author_name=publisher.BOT_NAME,
            author_email=publisher.BOT_EMAIL,
            committer_name=publisher.BOT_NAME,
            committer_email=publisher.BOT_EMAIL,
        )
        with self.assertRaisesRegex(publisher.PublishError, "unallowlisted"):
            publisher.validate_existing_commit(commit, artifact, digest="c" * 64)

    def test_valid_managed_commit_accepts_exact_trailers(self) -> None:
        artifact = publisher.load_artifact("consulenti-pubblici")
        commit = publisher.BranchCommit(
            tip="a" * 40,
            parent="b" * 40,
            files=("src/data/generated/consulenti-overview.json",),
            subject=artifact.publication.commit_title,
            trailers={
                "Data-Refresh-Artifact": artifact.artifact_id,
                "Data-Refresh-Base": "b" * 40,
                "Data-Refresh-Files-SHA256": "c" * 64,
                "Data-Refresh-Run": "https://github.com/owner/repo/actions/runs/1/attempt/1",
            },
            author_name=publisher.BOT_NAME,
            author_email=publisher.BOT_EMAIL,
            committer_name=publisher.BOT_NAME,
            committer_email=publisher.BOT_EMAIL,
        )
        publisher.validate_existing_commit(commit, artifact, digest="c" * 64)

    def test_provenance_body_contains_base_candidate_digest_files_and_validators(self) -> None:
        artifact = publisher.load_artifact("opencoesione")
        run = publisher.RunContext(
            token="secret",
            repository="Italian-Builders-Org/DoveVannoINostriSoldi",
            server_url="https://github.com",
            workflow_ref="Italian-Builders-Org/DoveVannoINostriSoldi/.github/workflows/opencoesione-refresh.yml@refs/heads/main",
            event_name="schedule",
            ref_name="main",
            sha="a" * 40,
            run_id="123",
            run_attempt="1",
            run_url="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/actions/runs/123",
        )
        body = publisher.provenance_body(
            artifact,
            run,
            base_sha="a" * 40,
            candidate_sha="b" * 40,
            digest="c" * 64,
        )
        for expected in (
            "<!-- dvns-data-refresh:v1 -->",
            "Base SHA: `" + "a" * 40 + "`",
            "Candidate SHA: `" + "b" * 40 + "`",
            "Files SHA-256: `" + "c" * 64 + "`",
            "src/data/generated/opencoesione-overview.json",
            "tests/opencoesione-contract.test.mjs",
            "Automatic merge is disabled",
        ):
            self.assertIn(expected, body)
        self.assertNotIn("secret", body)

    def test_commit_message_has_exact_managed_trailers(self) -> None:
        artifact = publisher.load_artifact("siope-municipal")
        run = publisher.RunContext(
            token="secret",
            repository="owner/repo",
            server_url="https://github.com",
            workflow_ref="owner/repo/.github/workflows/siope-refresh.yml@refs/heads/main",
            event_name="workflow_dispatch",
            ref_name="main",
            sha="a" * 40,
            run_id="7",
            run_attempt="2",
            run_url="https://github.com/owner/repo/actions/runs/7",
        )
        message = publisher.commit_message(artifact, run, "a" * 40, "b" * 64)
        parsed = publisher.parse_trailers(message.split("\n\n", 1)[1])
        self.assertEqual(set(parsed), set(publisher.TRAILER_NAMES))
        self.assertEqual(parsed["Data-Refresh-Artifact"], "siope-municipal")
        self.assertNotIn("secret", message)

    def test_workflow_mapping_rejects_wrong_workflow(self) -> None:
        artifact = publisher.load_artifact("consulenti-pubblici")
        run = publisher.RunContext(
            token="secret",
            repository="owner/repo",
            server_url="https://github.com",
            workflow_ref="owner/repo/.github/workflows/other.yml@refs/heads/main",
            event_name="schedule",
            ref_name="main",
            sha="a" * 40,
            run_id="1",
            run_attempt="1",
            run_url="https://github.com/owner/repo/actions/runs/1",
        )
        with self.assertRaisesRegex(publisher.PublishError, "mapping"):
            publisher.validate_run(artifact, run)

    def test_workflow_mapping_rejects_evil_substring_ref(self) -> None:
        artifact = publisher.load_artifact("consulenti-pubblici")
        run = publisher.RunContext(
            token="secret", repository="owner/repo", server_url="https://github.com",
            workflow_ref="owner/repo/.github/workflows/consulenti-refresh.yml-evil@refs/heads/main",
            event_name="schedule", ref_name="main", sha="a" * 40, run_id="1",
            run_attempt="1", run_url="https://github.com/owner/repo/actions/runs/1",
        )
        with self.assertRaisesRegex(publisher.PublishError, "mapping"):
            publisher.validate_run(artifact, run)

    def _managed_fixture(self, state="OPEN", digest="c" * 64, parent="b" * 40):
        artifact = publisher.load_artifact("consulenti-pubblici")
        branch = publisher.BranchCommit(
            tip="a" * 40, parent=parent,
            files=(artifact.files[0],), subject=artifact.publication.commit_title,
            trailers={
                "Data-Refresh-Artifact": artifact.artifact_id,
                "Data-Refresh-Base": parent,
                "Data-Refresh-Files-SHA256": digest,
                "Data-Refresh-Run": "https://github.com/owner/repo/actions/runs/1/attempt/1",
            }, author_name=publisher.BOT_NAME, author_email=publisher.BOT_EMAIL,
            committer_name=publisher.BOT_NAME, committer_email=publisher.BOT_EMAIL,
        )
        run = publisher.RunContext(
            token="secret", repository="owner/repo", server_url="https://github.com",
            workflow_ref="owner/repo/.github/workflows/consulenti-refresh.yml@refs/heads/main",
            event_name="schedule", ref_name="main", sha="a" * 40, run_id="1",
            run_attempt="1", run_url="https://github.com/owner/repo/actions/runs/1",
        )
        body = publisher.provenance_body(
            artifact, run, base_sha=parent, candidate_sha=branch.tip, digest=digest
        )
        pr = publisher.PullRequest(
            number=4, state=state, title=artifact.publication.pr_title, body=body,
            head_ref=artifact.publication.branch, base_ref="main", head_sha=branch.tip,
            base_sha=parent, merged_at="2026-08-25T00:00:00Z" if state == "MERGED" else None,
        )
        return artifact, branch, pr

    def test_author_and_committer_tamper_is_rejected(self) -> None:
        artifact, branch, _ = self._managed_fixture()
        for field in ("author_name", "author_email", "committer_name", "committer_email"):
            tampered = publisher.BranchCommit(**{**branch.__dict__, field: "human@example.com"})
            with self.assertRaisesRegex(publisher.PublishError, "identity"):
                publisher.validate_existing_commit(tampered, artifact)

    def test_pull_request_provenance_requires_exact_base_candidate_and_digest(self) -> None:
        artifact, branch, pr = self._managed_fixture()
        expected_ref = "owner/repo/.github/workflows/consulenti-refresh.yml@refs/heads/main"
        self.assertTrue(publisher.managed_pr_matches(pr, artifact, branch, expected_ref))
        for field, value in (("base_sha", "d" * 40), ("head_sha", "d" * 40), ("body", pr.body.replace("`" + "c" * 64 + "`", "`" + "e" * 64 + "`"))):
            tampered = publisher.PullRequest(**{**pr.__dict__, field: value})
            self.assertFalse(publisher.managed_pr_matches(tampered, artifact, branch, expected_ref))
        evil_body = pr.body.replace(expected_ref, expected_ref.replace("owner/repo", "evil/repo"))
        evil = publisher.PullRequest(**{**pr.__dict__, "body": evil_body})
        self.assertFalse(publisher.managed_pr_matches(evil, artifact, branch, expected_ref))

    def test_open_candidate_with_different_digest_is_eligible_for_replacement(self) -> None:
        artifact, branch, pr = self._managed_fixture(digest="c" * 64, parent="b" * 40)
        self.assertEqual(
            publisher.classify_existing_pr(
                pr, artifact, branch, current_base="d" * 40,
                current_digest="e" * 64, changed=True, expected_workflow_ref="owner/repo/.github/workflows/consulenti-refresh.yml@refs/heads/main",
            ),
            "REPLACE",
        )

    def test_no_change_stale_open_candidate_is_rejected(self) -> None:
        artifact, branch, pr = self._managed_fixture()
        with self.assertRaisesRegex(publisher.PublishError, "no-change"):
            publisher.classify_existing_pr(
                pr, artifact, branch, current_base="d" * 40,
                current_digest="e" * 64, changed=False, expected_workflow_ref="owner/repo/.github/workflows/consulenti-refresh.yml@refs/heads/main",
            )

    def test_historical_unrelated_closed_pull_request_is_ignored(self) -> None:
        artifact, branch, pr = self._managed_fixture(state="CLOSED")
        unrelated = publisher.PullRequest(
            **{**pr.__dict__, "number": 3, "head_sha": "f" * 40,
               "merged_at": None, "state": "CLOSED"}
        )
        self.assertEqual(
            publisher.relevant_tip_prs([unrelated], artifact.publication.branch, branch.tip),
            [],
        )

    def test_no_post_push_main_check_can_orphan_branch(self) -> None:
        source = SCRIPT.read_text()
        self.assertNotIn("final_main = latest_main", source)
        self.assertIn("observed_base = latest_main", source)

    def test_run_command_redacts_actual_token(self) -> None:
        def failing_runner(args, **kwargs):
            return subprocess.CompletedProcess(args, 1, "", "token=super-secret")
        with self.assertRaisesRegex(publisher.PublishError, "redacted"):
            publisher.run_command(["gh", "api"], env={"GH_TOKEN": "super-secret"}, runner=failing_runner)

    def test_candidate_ancestry_rejects_intermediate_commits(self) -> None:
        artifact, branch, _ = self._managed_fixture()
        def runner(args, **kwargs):
            return subprocess.CompletedProcess(args, 0, "2\n", "")
        with self.assertRaisesRegex(publisher.PublishError, "exactly one"):
            publisher.validate_single_candidate_ancestry(branch, runner=runner)

    def test_remote_tree_digest_is_computed_from_allowlisted_blobs(self) -> None:
        artifact, branch, _ = self._managed_fixture()
        def runner(args, **kwargs):
            self.assertEqual(args[:3], ["git", "show", branch.tip + ":" + artifact.files[0]])
            return subprocess.CompletedProcess(args, 0, "payload", "")
        expected = publisher.hashlib.sha256()
        path = artifact.files[0].encode()
        payload = b"payload"
        expected.update(len(path).to_bytes(8, "big")); expected.update(path)
        expected.update(len(payload).to_bytes(8, "big")); expected.update(payload)
        self.assertEqual(publisher.ref_file_digest(branch.tip, artifact, runner=runner), expected.hexdigest())

    def test_ls_remote_failure_is_not_treated_as_absent(self) -> None:
        def runner(args, **kwargs):
            return subprocess.CompletedProcess(args, 1, "", "network failure")
        with self.assertRaisesRegex(publisher.PublishError, "inspect"):
            publisher.remote_branch_tip("automation/data/consulenti", runner=runner)

    def test_merged_exact_candidate_is_no_change(self) -> None:
        artifact, branch, pr = self._managed_fixture(state="MERGED")
        self.assertEqual(
            publisher.classify_existing_pr(
                pr, artifact, branch, current_base=branch.parent,
                current_digest=branch.trailers["Data-Refresh-Files-SHA256"], changed=False, expected_workflow_ref="owner/repo/.github/workflows/consulenti-refresh.yml@refs/heads/main",
            ), "NO_CHANGE",
        )

    def test_state_machine_preserves_create_recovery_and_push_order(self) -> None:
        source = SCRIPT.read_text()
        self.assertLess(source.index("push_candidate("), source.index("gh.create_pr(artifact, body)"))
        self.assertIn("managed branch without a relevant pull request", source)
        self.assertNotIn("final_main = latest_main", source)

    def _publish_env(self):
        return {
            "GH_TOKEN": "secret", "GITHUB_REPOSITORY": "owner/repo",
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_WORKFLOW_REF": "owner/repo/.github/workflows/consulenti-refresh.yml@refs/heads/main",
            "GITHUB_EVENT_NAME": "schedule", "GITHUB_REF_NAME": "main",
            "GITHUB_SHA": "a" * 40, "GITHUB_RUN_ID": "1", "GITHUB_RUN_ATTEMPT": "1",
        }

    def test_publish_fake_runner_state_machine_create_nochurn_replace_merged_and_recovery(self) -> None:
        artifact, branch, open_pr = self._managed_fixture()
        base = branch.parent
        candidate = "d" * 40
        candidate_branch = publisher.BranchCommit(**{**branch.__dict__, "tip": candidate, "parent": base})
        env = self._publish_env()
        common = [
            mock.patch.object(publisher, "validate_run"),
            mock.patch.object(publisher, "latest_main", return_value=base),
            mock.patch.object(publisher, "git_sha", return_value=base),
            mock.patch.object(publisher, "status_paths", return_value={artifact.files[0]}),
            mock.patch.object(publisher, "file_digest", return_value="c" * 64),
            mock.patch.object(publisher, "remote_branch_tip", return_value=None),
            mock.patch.object(publisher, "parse_branch_commit", side_effect=[branch, candidate_branch]),
            mock.patch.object(publisher, "validate_single_candidate_ancestry"),
            mock.patch.object(publisher, "ref_file_digest", return_value="c" * 64),
            mock.patch.object(publisher, "make_candidate", return_value=candidate),
            mock.patch.object(publisher, "push_candidate"),
            mock.patch.object(publisher.GhClient, "setup_git"),
        ]
        with common[0], common[1], common[2], common[3], common[4], common[5], common[6], common[7], common[8], common[9], common[10], common[11] as setup:
            with mock.patch.object(publisher.GhClient, "prs", side_effect=[[], []]) as prs, mock.patch.object(publisher.GhClient, "create_pr", return_value=9) as create, mock.patch.object(publisher, "confirm_pr"):
                self.assertEqual(publisher.publish(artifact.artifact_id, env=env), "CREATED")
                create.assert_called_once()
        # Exact open candidate is idempotent and must not edit the PR.
        with mock.patch.object(publisher, "validate_run"), mock.patch.object(publisher, "latest_main", return_value=base), mock.patch.object(publisher, "git_sha", return_value=base), mock.patch.object(publisher, "status_paths", return_value={artifact.files[0]}), mock.patch.object(publisher, "file_digest", return_value="c" * 64), mock.patch.object(publisher, "remote_branch_tip", return_value=branch.tip), mock.patch.object(publisher, "parse_branch_commit", return_value=branch), mock.patch.object(publisher, "validate_single_candidate_ancestry"), mock.patch.object(publisher, "ref_file_digest", return_value="c" * 64), mock.patch.object(publisher.GhClient, "setup_git"), mock.patch.object(publisher.GhClient, "prs", return_value=[open_pr]), mock.patch.object(publisher.GhClient, "update_pr") as update:
            self.assertEqual(publisher.publish(artifact.artifact_id, env=env), "ALREADY_PUBLISHED")
            update.assert_not_called()
        # A stale open candidate is replaced and its existing PR is updated.
        stale = open_pr
        stale_base = "e" * 40
        with mock.patch.object(publisher, "validate_run"), mock.patch.object(publisher, "latest_main", return_value=stale_base), mock.patch.object(publisher, "git_sha", return_value=stale_base), mock.patch.object(publisher, "status_paths", return_value={artifact.files[0]}), mock.patch.object(publisher, "file_digest", return_value="c" * 64), mock.patch.object(publisher, "remote_branch_tip", return_value=branch.tip), mock.patch.object(publisher, "parse_branch_commit", side_effect=[branch, candidate_branch]), mock.patch.object(publisher, "validate_single_candidate_ancestry"), mock.patch.object(publisher, "ref_file_digest", return_value="c" * 64), mock.patch.object(publisher, "make_candidate", return_value=candidate), mock.patch.object(publisher, "push_candidate"), mock.patch.object(publisher.GhClient, "setup_git"), mock.patch.object(publisher.GhClient, "prs", side_effect=[[stale], [publisher.PullRequest(**{**stale.__dict__, "head_sha": candidate})]]), mock.patch.object(publisher.GhClient, "update_pr") as update, mock.patch.object(publisher, "confirm_pr"):
            self.assertEqual(publisher.publish(artifact.artifact_id, env=env), "ALREADY_PUBLISHED")
            update.assert_called_once()
        # Merged exact and missing-PR recovery are terminal NO_CHANGE/CREATE paths.
        merged = self._managed_fixture(state="MERGED")[2]
        for prs_value, expected in (([merged], "NO_CHANGE"), ([], "CREATED")):
            with mock.patch.object(publisher, "validate_run"), mock.patch.object(publisher, "latest_main", return_value=base), mock.patch.object(publisher, "git_sha", return_value=base), mock.patch.object(publisher, "status_paths", return_value=set()), mock.patch.object(publisher, "file_digest", return_value="c" * 64), mock.patch.object(publisher, "remote_branch_tip", return_value=branch.tip), mock.patch.object(publisher, "parse_branch_commit", return_value=branch), mock.patch.object(publisher, "validate_single_candidate_ancestry"), mock.patch.object(publisher, "ref_file_digest", return_value="c" * 64), mock.patch.object(publisher.GhClient, "setup_git"), mock.patch.object(publisher.GhClient, "prs", return_value=prs_value), mock.patch.object(publisher.GhClient, "create_pr", return_value=10) as create, mock.patch.object(publisher, "confirm_pr"):
                self.assertEqual(publisher.publish(artifact.artifact_id, env=env), expected)
                if expected == "CREATED": create.assert_called_once()

    def test_publish_push_failure_does_not_call_pr_api(self) -> None:
        artifact = publisher.load_artifact("consulenti-pubblici")
        env = self._publish_env(); base = "b" * 40
        with mock.patch.object(publisher, "validate_run"), mock.patch.object(publisher, "latest_main", return_value=base), mock.patch.object(publisher, "git_sha", return_value=base), mock.patch.object(publisher, "status_paths", return_value={artifact.files[0]}), mock.patch.object(publisher, "file_digest", return_value="c" * 64), mock.patch.object(publisher, "remote_branch_tip", return_value=None), mock.patch.object(publisher.GhClient, "setup_git"), mock.patch.object(publisher.GhClient, "prs", return_value=[]), mock.patch.object(publisher, "make_candidate", return_value="d" * 40), mock.patch.object(publisher, "push_candidate", side_effect=publisher.PublishError("push failed")), mock.patch.object(publisher.GhClient, "create_pr") as create:
            with self.assertRaisesRegex(publisher.PublishError, "push failed"):
                publisher.publish(artifact.artifact_id, env=env)
            create.assert_not_called()

    def test_main_movement_aborts_before_push_or_pr_mutation(self) -> None:
        artifact = publisher.load_artifact("consulenti-pubblici")
        env = self._publish_env(); base = "b" * 40; advanced = "c" * 40
        with mock.patch.object(publisher, "validate_run"), mock.patch.object(publisher, "latest_main", side_effect=[base, advanced]), mock.patch.object(publisher, "git_sha", return_value=base), mock.patch.object(publisher, "status_paths", return_value={artifact.files[0]}), mock.patch.object(publisher, "file_digest", return_value="d" * 64), mock.patch.object(publisher, "remote_branch_tip", return_value=None), mock.patch.object(publisher.GhClient, "setup_git"), mock.patch.object(publisher.GhClient, "prs", return_value=[]), mock.patch.object(publisher, "push_candidate") as push, mock.patch.object(publisher.GhClient, "create_pr") as create:
            with self.assertRaisesRegex(publisher.PublishError, "rerun the generator"):
                publisher.publish(artifact.artifact_id, env=env)
            push.assert_not_called()
            create.assert_not_called()


if __name__ == "__main__":
    main()

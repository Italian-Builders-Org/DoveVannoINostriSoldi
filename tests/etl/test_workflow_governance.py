import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"


class WorkflowGovernanceTests(unittest.TestCase):
    SOURCE_WORKFLOWS = {
        "consulenti-refresh.yml": "consulenti-pubblici",
        "opencivitas-refresh.yml": "opencivitas-2022",
        "opencoesione-refresh.yml": "opencoesione",
        "mef-participations-refresh.yml": "mef-participations",
        "siope-refresh.yml": "siope-municipal",
    }

    def read(self, name):
        return (WORKFLOWS / name).read_text(encoding="utf-8")

    def test_source_refreshes_are_scheduled_manual_only_and_publisher_backed(self):
        for filename, artifact_id in self.SOURCE_WORKFLOWS.items():
            text = self.read(filename)
            with self.subTest(filename=filename):
                self.assertNotRegex(text, r"(?m)^  push:\s*$")
                self.assertIn("  schedule:", text)
                self.assertIn("  workflow_dispatch:", text)
                self.assertIn("environment: source-operations", text)
                self.assertIn("contents: read", text)
                self.assertNotIn("contents: write", text)
                self.assertNotIn("github.token", text)
                self.assertNotIn("secrets.GITHUB_TOKEN", text)
                self.assertNotRegex(text, r"(?m)^\s*git (pull|push)\b")
                self.assertIn("uses: ./.github/actions/publish-data-refresh", text)
                self.assertIn(f"artifact-id: {artifact_id}", text)
                self.assertIn("app-client-id: ${{ vars.DATA_BOT_APP_CLIENT_ID }}", text)
                self.assertIn("app-private-key: ${{ secrets.DATA_BOT_APP_PRIVATE_KEY }}", text)
                self.assertIn("persist-credentials: false", text)
                self.assertIn("ref: main", text)
                self.assertIn("fetch-depth: 0", text)

    def test_siope_keeps_force_dispatch_and_has_daily_schedule(self):
        text = self.read("siope-refresh.yml")
        self.assertRegex(text, r'cron:\s*"[^" ]+ [^" ]+ \* \* \*"')
        self.assertNotRegex(text, r'cron:\s*"[^" ]+ \* \* \* \*"')
        self.assertIn("force:", text)

    def test_source_refresh_is_manual_and_fails_without_configuration(self):
        text = self.read("source-refresh.yml")
        self.assertNotIn("  schedule:", text)
        self.assertIn("  workflow_dispatch:", text)
        self.assertIn("environment: source-operations", text)
        self.assertIn("exit 1", text)
        self.assertNotIn("exit 0", text)

    def test_source_health_uses_canonical_public_endpoint_and_keeps_contract(self):
        text = self.read("source-health.yml")
        self.assertIn("https://www.dovevannoinostrisoldi.com", text)
        self.assertNotIn("secrets.REFRESH_URL", text)
        self.assertNotIn("${{ secrets.REFRESH_URL }}", text)
        for fragment in (
            "payload.ok",
            "Array.isArray(payload.sources)",
            "offline-source-lock-and-snapshot-contract",
            "entities: 76124",
            "national: 5",
            "regional: 105",
            "ssn.artifact.bytes !== 126487",
            "Active official sources unreachable",
        ):
            self.assertIn(fragment, text)

    def test_parliament_temporary_unavailability_is_failure_with_summary(self):
        text = self.read("parliament-sources.yml")
        self.assertIn("Fonte parlamentare temporaneamente non verificabile", text)
        self.assertIn("Lo snapshot verificato non è stato modificato", text)
        self.assertRegex(text, r"(?s)warning title=Fonte parlamentare non verificabile.*exit 1")

    def test_mcp_preview_is_manual_and_requires_endpoint(self):
        text = self.read("mcp-load.yml")
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("preview-load:", text)
        self.assertIn("name: preview-load", text)
        self.assertIn("environment: Preview", text)
        self.assertIn("MCP_PREVIEW_URL: ${{ secrets.MCP_PREVIEW_URL }}", text)
        self.assertNotIn("MCP_STAGING_URL", text)
        self.assertIn('test -n "$MCP_PREVIEW_URL"', text)

    def test_dependabot_keeps_npm_minor_and_patch_separate(self):
        text = (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
        self.assertIn("npm-patch:", text)
        self.assertIn("npm-minor:", text)
        self.assertNotIn("npm-minor-and-patch:", text)
        self.assertNotIn("automerge", text.lower())

    def test_local_action_has_no_token_fallback_and_is_pin_locked(self):
        action = (ROOT / ".github" / "actions" / "publish-data-refresh" / "action.yml").read_text(encoding="utf-8")
        self.assertIn("actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0", action)
        self.assertIn("client-id: ${{ inputs.app-client-id }}", action)
        self.assertNotIn("app-id:", action)
        self.assertIn("permission-contents: write", action)
        self.assertIn("permission-pull-requests: write", action)
        permission_lines = [
            line.strip()
            for line in action.splitlines()
            if line.strip().startswith("permission-")
        ]
        self.assertEqual(
            permission_lines,
            ["permission-contents: write", "permission-pull-requests: write"],
        )
        self.assertIn("GH_TOKEN: ${{ steps.data-bot-token.outputs.token }}", action)
        entrypoint = ROOT / "scripts" / "ci" / "publish-data-refresh.py"
        self.assertIn("python3 scripts/ci/publish-data-refresh.py", action)
        self.assertTrue(entrypoint.is_file(), f"Missing publisher entrypoint: {entrypoint}")
        self.assertNotIn("GITHUB_TOKEN", action)
        self.assertIn("test -n \"${DATA_BOT_APP_CLIENT_ID}\"", action)
        self.assertIn("test -n \"${DATA_BOT_APP_PRIVATE_KEY}\"", action)


if __name__ == "__main__":
    unittest.main()

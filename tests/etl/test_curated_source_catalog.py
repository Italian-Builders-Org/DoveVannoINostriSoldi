import copy
import csv
import importlib.util
import io
import json
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts/etl/curated_source_catalog.py"
POLICY_PATH = ROOT / "scripts/etl/specs/curated-source-catalog-policy.json"
sys.path.insert(0, str(SCRIPT_PATH.parent))

MODULE_SPEC = importlib.util.spec_from_file_location("curated_source_catalog", SCRIPT_PATH)
ETL = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = ETL
MODULE_SPEC.loader.exec_module(ETL)

from source_catalog import CatalogError, classify_identity, load_policy, validate_policy


KEY = bytes(range(32))
SECOND_KEY = bytes(range(1, 33))


def ledger_payload(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="\t", lineterminator="\n")
    writer.writerow(["dataset", "field", "kind", "value", "occurrences"])
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def fixture_rows():
    return [
        (
            "synthetic-internal-dataset",
            "internal_source_field",
            "url",
            "https://catalog.example.gov.it/api/contracts.csv?year=2025&utm_source=test#section",
            "2",
        ),
        (
            "synthetic-internal-dataset",
            "internal_source_field",
            "url",
            "https://catalog.example.gov.it/api/contracts.csv?year=2025&utm_source=test#section",
            "3",
        ),
        (
            "synthetic-internal-dataset",
            "source_page",
            "url",
            "https://catalog.example.gov.it/amministrazione-trasparente",
            "1",
        ),
        (
            "synthetic-internal-dataset",
            "catalog",
            "url",
            "https://dati.gov.it/dataset/example",
            "1",
        ),
        ("benchmarks", "pricing", "url", "https://phrase.com/pricing", "1"),
        ("signals", "article", "url", "https://ansa.it/economia/example", "1"),
        ("sources", "landing", "url", "https://public.example.org/source?id=1", "1"),
        (
            "sources",
            "restricted_link",
            "url",
            "https://catalog.example.gov.it/api/private.csv?token=synthetic-secret-value",
            "1",
        ),
        ("sources", "broken", "url", 'http://"', "1"),
        ("sources", "local_file", "file", "/workspace/raw/batch.tsv", "1"),
        ("sources", "label", "text", "review-draft-batch", "1"),
        (
            "sources",
            "process_url",
            "url",
            "https://catalog.example.gov.it/raw/working-copy.csv",
            "1",
        ),
        ("sources", "private_host", "url", "http://10.17.8.15/source", "1"),
        ("sources", "title", "text", "Official source title without a URL", "1"),
    ]


def build_fixture(rows=None, key=KEY):
    rows = fixture_rows() if rows is None else rows
    policy, policy_bytes = load_policy(POLICY_PATH)
    parsed = ETL.parse_ledger(ledger_payload(rows), policy)
    built = ETL.build_catalog(parsed, key, policy, policy_bytes)
    return policy, policy_bytes, parsed, built


def public_for_private_value(built, value):
    private_entry = next(item for item in built.private_map["entries"] if item["value"] == value)
    return next(item for item in built.public_entries if item["id"] == private_entry["id"])


class CuratedSourceCatalogTests(unittest.TestCase):
    def test_build_accounts_for_every_unique_identity_without_public_raw_leakage(self):
        policy, _, parsed, built = build_fixture()
        expected_unique = len({tuple(row[:4]) for row in fixture_rows()})
        expected_occurrences = sum(int(row[4]) for row in fixture_rows())
        coverage = built.proof["coverage"]

        self.assertEqual(coverage["inputRows"], len(fixture_rows()))
        self.assertEqual(coverage["uniqueIdentities"], expected_unique)
        self.assertEqual(coverage["accountedIdentities"], expected_unique)
        self.assertEqual(coverage["duplicateInputRows"], 1)
        self.assertEqual(coverage["totalOccurrences"], expected_occurrences)
        self.assertEqual(len(built.public_entries), expected_unique)
        self.assertEqual(len(built.private_map["entries"]), expected_unique)
        self.assertEqual(
            coverage["publishedIdentities"] + coverage["quarantinedIdentities"],
            expected_unique,
        )
        self.assertEqual(
            sum(coverage["byClassification"].values()),
            expected_unique,
        )
        self.assertEqual(parsed.total_occurrences, expected_occurrences)

        public_text = built.public_bytes.decode("utf-8") + built.proof_bytes.decode("utf-8")
        for private_value in (
            "synthetic-internal-dataset",
            "internal_source_field",
            "synthetic-secret-value",
            "/workspace/raw/batch.tsv",
            "review-draft-batch",
            "working-copy.csv",
        ):
            self.assertNotIn(private_value, public_text)
            self.assertIn(private_value, built.private_bytes.decode("utf-8"))

        exact_url = fixture_rows()[0][3]
        private_entry = next(
            item for item in built.private_map["entries"] if item["value"] == exact_url
        )
        public_entry = public_for_private_value(built, exact_url)
        self.assertEqual(private_entry["occurrences"], 5)
        self.assertEqual(private_entry["sourceRows"], 2)
        self.assertEqual(public_entry["occurrences"], 5)
        self.assertEqual(public_entry["classification"], "official_primary")
        self.assertEqual(
            public_entry["publicValue"],
            "https://catalog.example.gov.it/api/contracts.csv?year=2025",
        )
        self.assertEqual(
            public_entry["reasonCodes"],
            ["fragment_removed", "tracking_query_removed"],
        )

        observed = {item["classification"] for item in built.public_entries}
        self.assertEqual(
            observed,
            {
                "commercial",
                "local",
                "news",
                "official_index",
                "official_primary",
                "official_secondary",
                "unknown",
                "unresolved",
            },
        )
        self.assertEqual(policy["classifications"], sorted(observed))

    def test_hmac_ids_are_stable_order_independent_and_key_scoped(self):
        policy, _, _, first = build_fixture()
        _, _, _, reordered = build_fixture(list(reversed(fixture_rows())))
        _, _, _, rekeyed = build_fixture(key=SECOND_KEY)

        self.assertEqual(first.public_bytes, reordered.public_bytes)
        self.assertNotEqual(first.proof_bytes, reordered.proof_bytes)
        self.assertNotEqual(
            [item["id"] for item in first.public_entries],
            [item["id"] for item in rekeyed.public_entries],
        )
        identity = tuple(fixture_rows()[0][:4])
        identifier = ETL.opaque_identity_id(identity, KEY, policy)
        self.assertEqual(identifier, ETL.opaque_identity_id(identity, KEY, policy))
        mutated = (identity[0], identity[1], identity[2], identity[3] + "?changed=1")
        self.assertNotEqual(identifier, ETL.opaque_identity_id(mutated, KEY, policy))
        self.assertNotIn("catalog", identifier)
        self.assertRegex(identifier, r"^src_[a-z2-7]{26}$")

    def test_classifier_is_conservative_and_unknown_is_explicit(self):
        policy, _ = load_policy(POLICY_PATH)
        cases = {
            "https://example.gov.it/download/report.pdf": ("official_primary", "published"),
            "https://example.gov.it/amministrazione-trasparente": ("official_index", "published"),
            "https://dati.gov.it/dataset/example": ("official_secondary", "published"),
            "https://deepl.com/pricing": ("commercial", "published"),
            "https://reuters.com/world/example": ("news", "published"),
            "https://public.example.org/source": ("unknown", "published"),
            "http://127.0.0.1/source": ("local", "quarantined"),
            "file:///tmp/source.tsv": ("local", "quarantined"),
            "ftp://public.example.org/source": ("unresolved", "quarantined"),
            'http://"': ("unresolved", "quarantined"),
            "Official source title": ("unresolved", "quarantined"),
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                kind = "url" if "://" in value else "text"
                result = classify_identity(kind, value, policy)
                self.assertEqual((result.classification, result.disposition), expected)

        sensitive = classify_identity(
            "url", "https://example.gov.it/api/data.csv?API-Key=synthetic", policy
        )
        self.assertEqual(sensitive.classification, "official_primary")
        self.assertEqual(sensitive.disposition, "quarantined")
        self.assertIsNone(sensitive.public_value)
        self.assertIn("sensitive_query_parameter", sensitive.reason_codes)

        tracked = classify_identity(
            "url", "HTTPS://EXAMPLE.GOV.IT:443/api/data.csv?year=2025&utm_medium=test#part", policy
        )
        self.assertEqual(tracked.disposition, "published")
        self.assertEqual(
            tracked.public_value,
            "https://example.gov.it/api/data.csv?year=2025",
        )

    def test_url_safety_quarantines_userinfo_process_paths_and_bad_wire_forms(self):
        policy, _ = load_policy(POLICY_PATH)
        cases = (
            ("https://user:pass@example.org/source", "url_userinfo"),
            ("https://example.gov.it/raw/working-copy.csv", "process_path"),
            ("https://example.org/source?x-amz-signature=synthetic", "sensitive_query_parameter"),
            ("https://example.org/source?session_id=synthetic", "sensitive_query_parameter"),
            (
                "https://example.org/redirect?return=https%3A%2F%2Fexample.org%2Fview%3Fp_p_auth%3Dsynthetic",
                "sensitive_query_value",
            ),
            (
                "https://example.org/redirect?return=https%253A%252F%252Fexample.org%252Fview%253Fsession_id%253Dsynthetic",
                "sensitive_query_value",
            ),
            ("https://example.org/source?q=" + "a" * 129, "sensitive_query_value"),
            (
                "https://example.org/source?q=eyJabcdefghijklmno.abcdefghijkl.abcdefghijkl",
                "sensitive_query_value",
            ),
            ("https://example.org/source?batch=review-draft-copy", "process_query"),
            (
                "https://example.org/source?file=C%3A%5CUsers%5Cname%5Csource.tsv",
                "local_query",
            ),
            ("https://example.org/source with space", "malformed_url"),
            ("https://example.org/source%ZZ", "malformed_url"),
            ("https://example.org:invalid/source", "malformed_url"),
            ("http://192.168.1.2/source", "non_public_host"),
            ("http://intranet/source", "non_public_host"),
            ("http://127.1/source", "non_public_host"),
            ("http://2130706433/source", "non_public_host"),
        )
        for value, reason in cases:
            with self.subTest(value=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)
                self.assertIn(reason, result.reason_codes)

    def test_url_safety_checks_the_terminal_percent_decoding_layer(self):
        policy, _ = load_policy(POLICY_PATH)
        nested = "token=synthetic"
        for _ in range(5):
            nested = quote(nested, safe="")

        result = classify_identity(
            "url", f"https://example.org/redirect?return={nested}", policy
        )

        self.assertEqual(result.disposition, "quarantined")
        self.assertIn("sensitive_query_value", result.reason_codes)

    def test_url_safety_decodes_query_keys_before_publication(self):
        policy, _ = load_policy(POLICY_PATH)
        cases = (
            (
                "https://example.org/source?%2574oken=synthetic-private-value",
                "sensitive_query_parameter",
            ),
            (
                "https://example.org/source?%252FUsers%252Falice%252Fprivate.tsv=x",
                "local_query",
            ),
        )

        for value, reason in cases:
            with self.subTest(value=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)
                self.assertIn(reason, result.reason_codes)

    def test_url_safety_decodes_paths_without_blocking_official_home_routes(self):
        policy, _ = load_policy(POLICY_PATH)
        blocked = (
            ("https://example.org/%72aw/%77orkspace/private.tsv", "process_path"),
            ("https://example.org/Users/alice/private.tsv", "local_reference"),
            ("https://example.org/%55sers/alice/private.tsv", "local_reference"),
            (
                "https://example.org/file%3A%2F%2Flocalhost%2FUsers%2Falice%2Fprivate.tsv",
                "local_reference",
            ),
            (
                "https://example.org/file%253A%252F%252Flocalhost%252FUsers%252Falice%252Fprivate.tsv",
                "local_reference",
            ),
            (
                "https://example.org/%5C%5Cserver%5Cprivate%5Csource.tsv",
                "local_reference",
            ),
            (
                "https://example.org/%255C%255Cserver%255Cprivate%255Csource.tsv",
                "local_reference",
            ),
        )

        for value, reason in blocked:
            with self.subTest(value=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)
                self.assertIn(reason, result.reason_codes)

        for official_home in (
            "https://www.corteconti.it/Home/AmministrazioneTrasparente",
            "https://www.indire.it/home/amministrazione-trasparente/",
        ):
            with self.subTest(official_home=official_home):
                result = classify_identity("url", official_home, policy)
                self.assertEqual(result.disposition, "published")
                self.assertEqual(result.public_value, official_home)

    def test_url_safety_rejects_credential_like_path_values_conservatively(self):
        policy, _ = load_policy(POLICY_PATH)
        ipzs_document = (
            "https://www.trasparenza.ipzs.it/dettagli/attodigara/8765/"
            "fornitura-token-medaglia-as-roma.html"
        )
        sviluppo_lavoro_document = (
            "https://societatrasparente.sviluppolavoroitalia.it/page/10/details/"
            "45548/affidamento-diretto-ai-sensi-dellart-50-comma-1-lett-b-del-"
            "dlgs-362023-e-smi-tramite-piattaforma-mepa-numero-procedura-1205681-"
            "id-ordine-8660179-per-il-rinnovo-annuale-della-manutenzione-di-n-950-"
            "licenze-password-manager-per-managed-person-24x7.html"
        )
        synthetic_slack_token = (
            "xo" + "xb-" + "123456789012-123456789012-AbCdEfGhIjKlMnOp"
        )
        blocked = (
            (
                "https://example.org/download/token/synthetic-secret-value-1234/file.csv",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/%74oken/synthetic-secret-value-1234/file.csv",
                "sensitive_path_value",
            ),
            (
                "https://example.org/redirect?next=%252Faccess-token%252F"
                "synthetic-secret-value-1234",
                "sensitive_query_value",
            ),
            (
                "https://example.org/download/refresh-token/SyntheticSecretValue1234",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token/abcdefghijklmnopqrstuvwx",
                "sensitive_path_value",
            ),
            (
                "https://example.org/redirect?next=%252Frefresh-token%252F"
                "SyntheticSecretValue1234",
                "sensitive_query_value",
            ),
            (
                "https://example.org/download/token%255Cabcdefghijklmnopqrstuvwx",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/password/P%40ssw0rd%21LongValue",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token/AbCdEfGh%2FIjKlMnOp",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token/AbCdEf1234",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token/1234512345123451",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token-value/AbCdEfGhIjKlMnOp",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/tokenValue/AbCdEfGhIjKlMnOp",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/password=P%40ssw0rd%21LongValue",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/password/callback",
                "sensitive_path_value",
            ),
            (
                "https://example.org/source?token=refresh",
                "sensitive_query_parameter",
            ),
            (
                "https://example.org/download/"
                "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/glpat-AbCdEfGhIjKlMnOpQrSt",
                "sensitive_path_value",
            ),
            (
                f"https://example.org/download/{synthetic_slack_token}",
                "sensitive_path_value",
            ),
            (
                "https://example.org/?github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                "abcdefghijklmnopqrstuvwxyz0123456789",
                "sensitive_query_parameter",
            ),
            (
                "https://example.org/#ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
                "sensitive_url_value",
            ),
            (
                "https://example.org/download/prefix-github_pat_11ABCDEFGHIJKLMNO"
                "PQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/prefix_glpat-AbCdEfGhIjKlMnOpQrSt",
                "sensitive_path_value",
            ),
            (
                f"https://example.org/download/prefix-{synthetic_slack_token}",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token-AbCdEf1234567890_XyZ",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/client-secret_AbCdEf1234567890_XyZ",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/password.12345678901234567890",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token-x",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/password-short",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/client-secret-Ab9",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token-!!!",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token-1111111111111111",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/vendor-password-Ab9",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/admin-secret-short",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/foo-credential-x",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token~Secret",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/api-key+Ab9",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/password@short",
                "sensitive_path_value",
            ),
            (
                "https://example.org/download/token-1234",
                "sensitive_path_value",
            ),
            (
                "https://example.org/oauth/token/callback/AbCdEf1234567890_XyZ",
                "sensitive_path_value",
            ),
            (
                "https://example.org/oauth/token/callback?state=AbCdEf1234567890_XyZ",
                "sensitive_path_value",
            ),
            (
                "https://example.org/oauth/token/callback#AbCdEf1234567890_XyZ",
                "sensitive_path_value",
            ),
            (
                "https://AKIA1234567890ABCDEF.example.org/documento",
                "sensitive_url_value",
            ),
            (
                "https://token-AbCdEf1234567890XyZ.example.org/documento",
                "sensitive_url_value",
            ),
            ("https://example.org/token-policy", "sensitive_path_value"),
            ("https://example.org/password-documentation", "sensitive_path_value"),
            ("https://example.org/docs-v2/token-policy", "sensitive_path_value"),
            (
                ipzs_document.replace("www.trasparenza.ipzs.it", "evil.example.org"),
                "sensitive_path_value",
            ),
            (ipzs_document + "?state=AbCdEf1234567890XyZ", "sensitive_path_value"),
            (ipzs_document + "#state-AbCdEf1234567890XyZ", "sensitive_path_value"),
            (ipzs_document + "?", "sensitive_path_value"),
            (ipzs_document.replace("https://", "http://"), "sensitive_path_value"),
            (
                ipzs_document.replace(
                    "www.trasparenza.ipzs.it",
                    "www.trasparenza.ipzs.it:443",
                ),
                "sensitive_path_value",
            ),
            (
                ipzs_document.replace(
                    "www.trasparenza.ipzs.it",
                    "www.trasparenza.ipzs.it:8443",
                ),
                "sensitive_path_value",
            ),
            (ipzs_document.replace("token", "%74oken"), "sensitive_path_value"),
            (
                sviluppo_lavoro_document.replace(
                    "societatrasparente.sviluppolavoroitalia.it",
                    "evil.example.org",
                ),
                "sensitive_path_value",
            ),
            (sviluppo_lavoro_document + "#", "sensitive_path_value"),
        )
        for value, reason in blocked:
            with self.subTest(value=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)
                self.assertIn(reason, result.reason_codes)

        allowed = (
            "https://www.corteconti.it/Home/AmministrazioneTrasparente",
            "https://example.gov.it/atti/DECRETO-2025-12345678901234567890.pdf",
            "https://example.gov.it/atti/abcdefghijklmnopqrstuvwx",
            "https://example.gov.it/oauth/token/istruzioni",
            "https://example.gov.it/oauth/token/callback",
            "https://example.gov.it/oauth/token/status",
            "https://example.gov.it/servizi/tokenizzazione/abcdefghijklmnopqrstuvwx",
            "https://example.gov.it/atti/github_pat_documentation",
            "https://example.gov.it/docs/"
            "github_pat_documentation_for_administrators",
            "https://example.gov.it/guide/token-bucket-documentation-for-users-2026",
            "https://example.gov.it/docs/password-policy-documentation-for-users-2026",
            "https://example.gov.it/guide/not-a-token-documentation",
            "https://token.example.gov.it/documento-pubblico-2026",
            "https://example.gov.it/docs/token-policy",
            "https://example.gov.it/documentation/password-documentation",
            ipzs_document,
            sviluppo_lavoro_document,
        )
        for value in allowed:
            with self.subTest(value=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "published")
                self.assertEqual(result.public_value, value)

    def test_url_safety_rejects_credential_like_hostname_spans(self):
        policy, _ = load_policy(POLICY_PATH)
        opaque = "AbCdEf1234567890XyZ"
        credential_spans = (
            "token", "password", "secret", "credential", "signature", "jwt",
            "sessionid", "api-key", "access-token", "client-secret",
            "refresh-token", "session-token", "auth-token", "id-token",
            "vendor-token", "admin-secret", "api-secret", "token-param",
            "client-secret-param", "custom-sessionid", "private.key",
            "access.key", "aws.access.key", "client.key", "session.key",
            "akia", "asia", "aiza", "sk",
            "ghp", "gho", "ghu", "ghs", "ghr", "glpat", "xoxb", "xoxa",
            "xoxp", "xoxr", "xoxs", "bearer", "basic", "api.key",
            "access.token", "client.secret", "refresh.token", "session.token",
            "github.pat", "x.amz.credential", "x.amz.signature",
            "x.goog.credential", "x.goog.signature",
        )
        blocked = [
            url
            for span in credential_spans
            for url in (
                f"https://{span}.{opaque}.example.org/documento",
                f"https://{opaque}.{span}.example.org/documento",
            )
        ]
        compound_keys = (
            "token", "api-key", "access-token", "client-secret",
            "vendor-token", "admin-secret", "token-param", "private-key",
            "x-amz-signature", "x-goog-credential", "ghp", "glpat", "bearer",
            "akia", "asia", "aiza", "sk",
        )
        blocked.extend(
            url
            for key in compound_keys
            for url in (
                f"https://{key}-{opaque}.example.org/documento",
                f"https://{opaque}-{key}.example.org/documento",
                f"https://prefix-{key}-{opaque}.example.org/documento",
                f"https://{opaque}-{key}-suffix.example.org/documento",
            )
        )
        blocked.append(
            "https://eyJAbCdEfGhIjKlMnOp.QrStUvWxYz12."
            "AbCdEfGhIj34.example.org/documento"
        )
        chunks = "AbCd12.EfGh34.IjKl56.MnOp78.QrSt90.UvWx12"
        blocked.extend((
            f"https://token.{chunks}.example.org/documento",
            f"https://{chunks}.token.example.org/documento",
            f"https://ghp.{chunks}.example.org/documento",
            f"https://{chunks}.ghp.example.org/documento",
            f"https://api.key.{chunks}.example.org/documento",
            f"https://{chunks}.api.key.example.org/documento",
            "https://ghp.abcdefghijklmnopqrstuvwx.example.org/documento",
            "https://abcdefghijklmnopqrstuvwx.client.secret.example.org/documento",
            "https://ASIA1234567890ABCDEF.example.org/documento",
            "https://sk-AbCdEf1234567890XyZ.example.org/documento",
            "https://ghp.documentation.AbCdEf1234567890XyZ.example.org/documento",
            "https://ghp.AbCd12.documentation.EfGh34.IjKl56.example.org/documento",
            "https://AbCdEf12.ghp.GhIjKl9012.example.org/documento",
            "https://AbCdEf12-ghp-GhIjKl9012.example.org/documento",
            "https://AbCd12.api.key.EfGh345678.example.org/documento",
            "https://AbCd12-api-key-EfGh345678.example.org/documento",
            "https://a.i.z.a.AbCdEf1234567890XyZ.example.org/documento",
            "https://a.k.i.a.AbCdEf1234567890XyZ.example.org/documento",
            "https://x.o.x.b.AbCdEf1234567890XyZ.example.org/documento",
            "https://g.l.p.a.t.AbCdEf1234567890XyZ.example.org/documento",
            "https://t.o.k.e.n.AbCdEf1234567890XyZ.example.org/documento",
            "https://t.o.docs.k.e.n.AbCdEf1234567890XyZ.example.org/documento",
            "https://t-o-docs-k-e-n-AbCdEf1234567890XyZ.example.org/documento",
            "https://a.i.documentation.z.a.AbCdEf1234567890XyZ.example.org/documento",
            "https://a-i-documentation-z-a-AbCdEf1234567890XyZ.example.org/documento",
            "https://x.o.guida.x.b.AbCdEf1234567890XyZ.example.org/documento",
            "https://g-l-help-pat-AbCdEf1234567890XyZ.example.org/documento",
            "https://api.docs.key.AbCdEf1234567890XyZ.example.org/documento",
            "https://api.documentation.key.AbCdEf1234567890XyZ.example.org/documento",
            "https://google.api.docs.key.AbCdEf1234567890XyZ.example.org/documento",
            "https://api-docs-key-AbCdEf1234567890XyZ.example.org/documento",
            "https://google-api-docs-key-AbCdEf1234567890XyZ.example.org/documento",
            "https://api.public-information.key.AbCdEf1234567890XyZ.example.org/documento",
            "https://api.management.key.AbCdEf1234567890XyZ.example.org/documento",
            "https://api.oauth.key.AbCdEf1234567890XyZ.example.org/documento",
            "https://api-public-key-AbCdEf1234567890XyZ.example.org/documento",
            "https://google-api-service-key-AbCdEf1234567890XyZ.example.org/documento",
        ))

        for value in blocked:
            with self.subTest(blocked=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)
                self.assertIn("sensitive_url_value", result.reason_codes)

        allowed = (
            "https://token.example.gov.it/documento-pubblico-2026",
            "https://api.key.example.gov.it/documento-pubblico-2026",
            "https://access.token.example.gov.it/documento-pubblico-2026",
            "https://AbCdEf12.client.secret.example.gov.it/documento",
            "https://AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://ghp.documentation.example.gov.it/documento",
            "https://token.docs.example.gov.it/documento",
            "https://token.documentazione.example.gov.it/documento",
            "https://token.guida.example.gov.it/documento",
            "https://oauth.token.endpoint.example.gov.it/documento",
            "https://oauth.token.callback.example.gov.it/documento",
            "https://oauth.token.status.example.gov.it/documento",
            "https://password.reset.example.gov.it/documento",
            "https://api.key.management.example.gov.it/documento",
            "https://token.guida-utente.example.gov.it/documento",
            "https://token.public-information.example.gov.it/documento",
            "https://token.docs.verylonginstitutionaldomain.gov.it/documento",
            "https://token.documentation.amministrazione-trasparente.gov.it/documento",
            "https://api.key.guida.servizi-digitali-nazionali.gov.it/documento",
            "https://password.help.password-reset-service.gov.it/documento",
            "https://oauth.token.callback.authentication-service.gov.it/documento",
            "https://sk-documentation-for-users.example.gov.it/documento",
            "https://docs.sk-documentation-for-users.example.gov.it/documento",
            "https://sk-verylonginstitutionaldomain.example.gov.it/documento",
            "https://asiainternationalservice.example.gov.it/documento",
            "https://asia.international-foundation.example.gov.it/documento",
        )
        for value in allowed:
            with self.subTest(allowed=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "published")
                self.assertEqual(result.public_value, value.lower())

    def test_url_safety_rejects_case_sensitive_provider_tokens_in_components(self):
        policy, _ = load_policy(POLICY_PATH)
        tokens = (
            "AKIA1234567890ABCDEF",
            "ASIA1234567890ABCDEF",
            "AIzaAbCdEfGhIjKlMnOpQrStUvWxYz123456",
            "sk-AbCdEf1234567890XyZ",
            "sk-proj-AbCdEf1234567890XyZ",
            "sk-live-AbCdEf1234567890XyZ",
        )
        blocked = (
            value
            for token in tokens
            for value in (
                f"https://example.org/download/{token}",
                f"https://example.org/source?value={token}",
                f"https://example.org/source#{token}",
                f"https://example.org/redirect?return=%252Fdownload%252F{token}",
            )
        )
        for value in blocked:
            with self.subTest(blocked=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)

        for value in (
            "https://example.org/download/asiainternationalservice",
            "https://example.org/download/aizainternationalservice",
            "https://example.org/sk-documentation-for-users",
            "https://example.org/docs/sk-documentation-for-users",
        ):
            with self.subTest(allowed=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "published")
                self.assertEqual(result.public_value, value)

    def test_url_safety_rejects_credentials_in_nested_url_authorities(self):
        policy, _ = load_policy(POLICY_PATH)
        inner_urls = (
            "https://token.AbCdEf1234567890XyZ.example.org/public",
            "https://a.i.z.a.AbCdEf1234567890XyZ.example.org/public",
            "https://reader:SuperSecret123@example.org/public",
            "https://127.0.0.1/private",
            "//a.i.z.a.AbCdEf1234567890XyZ.example.org/public",
            "//reader:SuperSecret123@example.org/public",
            "//127.0.0.1/private",
            "//[::1]/private",
            r"https:\\a.i.z.a.AbCdEf1234567890XyZ.example.org\public",
            r"https:/\reader:SuperSecret123@example.org\public",
            "https:\t//reader:SuperSecret123@example.org/public",
            "ftp://reader:SuperSecret123@example.org/file",
            "ssh://reader:SuperSecret123@example.org/file",
            "ws://reader:SuperSecret123@example.org/socket",
            "https://0177.0.0.1/private",
            "https://127.1/private",
            "https://0x7f.0x0.0x0.0x1/private",
            "https://224.0.0.251/private",
            "https://[ff02::1]/private",
            "https://service.local/private",
            "https://service.home.arpa/private",
            "https://safe.example.org/x,https://a.i.z.a."
            "AbCdEf1234567890XyZ.example.org/x",
        )
        for inner_url in inner_urls:
            nested = inner_url
            for depth in range(1, 9):
                nested = quote(nested, safe="")
                for value in (
                    f"https://example.org/redirect?return={nested}",
                    f"https://example.org/redirect#return={nested}",
                ):
                    with self.subTest(inner=inner_url, depth=depth, outer=value):
                        result = classify_identity("url", value, policy)
                        self.assertEqual(result.disposition, "quarantined")
                        self.assertIsNone(result.public_value)

        encoded_path_authorities = (
            "/redirect/%2F%2Freader%3ASuperSecret123%40example.org%2Fx",
            "/%2F%2Fa.i.z.a.AbCdEf1234567890XyZ.example.org%2Fx",
            "/%2F%2F127.0.0.1%2Fx",
            "/redirect/https%3A%5C%5Creader%3ASuperSecret123%40example.org%5Cx",
            "/redirect/https%3A%5C%5Ca.i.z.a."
            "AbCdEf1234567890XyZ.example.org%5Cx",
            "/redirect/https%3A%09%2F%2Freader%3ASuperSecret123%40example.org%2Fx",
        )
        for path in encoded_path_authorities:
            value = f"https://example.org{path}"
            with self.subTest(encoded_path_authority=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)

        for inner_url in (
            "https://public.example.org/public",
            "https://[2606:4700:4700::1111]/public",
            "https://token.docs.example.gov.it/public",
            "https://api.key.management.example.gov.it/public",
        ):
            safe_inner = quote(inner_url, safe="")
            safe_value = f"https://example.org/redirect?return={safe_inner}"
            result = classify_identity("url", safe_value, policy)
            self.assertEqual(result.disposition, "published")
            self.assertEqual(result.public_value, safe_value)
            safe_fragment = f"https://example.org/redirect#return={safe_inner}"
            result = classify_identity("url", safe_fragment, policy)
            self.assertEqual(result.disposition, "published")
            self.assertEqual(result.public_value, "https://example.org/redirect")
            self.assertIn("fragment_removed", result.reason_codes)

    def test_url_safety_rejects_compact_strong_credential_keys(self):
        policy, _ = load_policy(POLICY_PATH)
        opaque = "AbCdEf1234567890XyZ"
        keys = (
            "privateKey", "accessKey", "secretKey", "signingKey",
            "clientKey", "sessionKey", "awsAccessKeyId",
            "awsSecretAccessKey", "googleApiKey",
            "sshPrivateKey", "tlsPrivateKey", "pgpPrivateKey", "s3AccessKey",
            "stripeSecretKey", "awsSecretKey", "jwtSigningKey",
            "databaseEncryptionKey",
        )
        for key in keys:
            for value in (
                f"https://example.org/source?{key}={opaque}",
                f"https://example.org/download/{key}/{opaque}",
                f"https://{key}.{opaque}.example.org/public",
            ):
                with self.subTest(key=key, value=value):
                    result = classify_identity("url", value, policy)
                    self.assertEqual(result.disposition, "quarantined")
                    self.assertIsNone(result.public_value)

        for key in ("publicKey", "primaryKey", "foreignKey"):
            allowed = f"https://example.org/source?{key}={opaque}"
            result = classify_identity("url", allowed, policy)
            self.assertEqual(result.disposition, "published")
            self.assertEqual(result.public_value, allowed)

        double_slash_path = "https://example.org//wp-content/public-document.pdf"
        result = classify_identity("url", double_slash_path, policy)
        self.assertEqual(result.disposition, "published")
        self.assertEqual(result.public_value, double_slash_path)
        encoded_tab_path = "https://example.org/public/item-%09title"
        result = classify_identity("url", encoded_tab_path, policy)
        self.assertEqual(result.disposition, "published")
        self.assertEqual(result.public_value, encoded_tab_path)

        reviewed_public_paths = (
            "https://web.archive.org/web/20260127005333/"
            "https://appalti.gse.it/PortaleAppalti/it/homepage.wp",
            "https://web.archive.org/web/20260512063047/"
            "https://www.invimit.it/societa-trasparente/",
            "https://www.mase.gov.it/portale/b56411544b-%09fornitura-di-un-"
            "ingranditore-visivo",
            "https://www.mase.gov.it/portale/b56450c9e4-%09servizio-di-"
            "interpretariato-l.i.s",
            "https://www.mase.gov.it/portale/b5745066f6-%09n.-4-abbonamenti-"
            "digitali-alla-rivista-staffetta-quotidiana",
            "https://www.mase.gov.it/portale/web/guest/b7de39d302%09servizi-di-"
            "progettazione-grafica-e-comunicazione",
            "https://www.ministeroturismo.gov.it//wp-content/uploads/2026/01/"
            "Decreto_Approvazione-e-Impegno_Evento-18-dicembre_DG_signed_"
            "Marcato.pdf",
        )
        for value in reviewed_public_paths:
            with self.subTest(reviewed_public_path=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "published")
                self.assertEqual(result.public_value, value)

    def test_exact_documentation_urls_require_the_raw_official_authority(self):
        policy, _ = load_policy(POLICY_PATH)
        host = "www.trasparenza.ipzs.it"
        document = (
            f"https://{host}/dettagli/attodigara/8765/"
            "fornitura-token-medaglia-as-roma.html"
        )
        blocked = (
            document.replace(host, host + ":"),
            document.replace(host, host + ":443"),
            document.replace(host, host + ":8443"),
            document.replace(host, host + "."),
            document.replace(host, "www．trasparenza.ipzs.it"),
            document.replace(host, "ｗｗｗ.trasparenza.ipzs.it"),
            document.replace(host, "www.trasparenzà.ipzs.it"),
            document.replace(host, "reader@" + host),
            document.replace("https://", "http://"),
        )
        for value in blocked:
            with self.subTest(blocked=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)

        uppercase_authority = document.replace(host, host.upper())
        for value, expected in (
            (document, document),
            (uppercase_authority, document),
        ):
            with self.subTest(allowed=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "published")
                self.assertEqual(result.public_value, expected)

    def test_url_safety_rejects_multicast_and_reserved_numeric_hosts(self):
        policy, _ = load_policy(POLICY_PATH)
        for value in (
            "http://224.0.0.251/source",
            "http://[ff02::1]/source",
            "http://[::127.0.0.1]/source",
        ):
            with self.subTest(value=value):
                result = classify_identity("url", value, policy)
                self.assertEqual(result.disposition, "quarantined")
                self.assertIsNone(result.public_value)
                self.assertIn("non_public_host", result.reason_codes)

        global_unicast = classify_identity("url", "https://8.8.8.8/source", policy)
        self.assertEqual(global_unicast.disposition, "published")

    def test_input_contract_fails_closed_on_structural_mutations(self):
        policy, _ = load_policy(POLICY_PATH)
        valid_row = [("dataset", "field", "url", "https://example.org/source", "1")]
        mutations = (
            b"dataset\tfield\tkind\tvalue\nrow\tfield\turl\thttps://example.org\n",
            ledger_payload([("dataset", "field", "url", "https://example.org", "0")]),
            ledger_payload([("dataset", "field", "url", "https://example.org", "01")]),
            ledger_payload([("dataset", "", "url", "https://example.org", "1")]),
            b"\xef\xbb\xbf" + ledger_payload(valid_row),
            ledger_payload(valid_row) + b"\xff",
            b"dataset\tfield\tkind\tvalue\toccurrences\n",
            b'dataset\tfield\tkind\tvalue\toccurrences\n"unterminated',
        )
        for payload in mutations:
            with self.subTest(payload=payload[:30]):
                with self.assertRaises(CatalogError):
                    ETL.parse_ledger(payload, policy)

    def test_policy_contract_rejects_semantic_mutations(self):
        policy, _ = load_policy(POLICY_PATH)
        mutations = []
        bad_schema = copy.deepcopy(policy)
        bad_schema["schemaVersion"] = True
        mutations.append(bad_schema)
        missing_classification = copy.deepcopy(policy)
        missing_classification["classifications"].remove("unknown")
        mutations.append(missing_classification)
        unsorted_keys = copy.deepcopy(policy)
        unsorted_keys["urlRules"]["sensitiveQueryKeys"].reverse()
        mutations.append(unsorted_keys)
        public_text = copy.deepcopy(policy)
        public_text["textRules"]["publicationMode"] = "publish"
        mutations.append(public_text)
        weak_key = copy.deepcopy(policy)
        weak_key["identityId"]["minimumKeyBytes"] = 16
        mutations.append(weak_key)
        short_id = copy.deepcopy(policy)
        short_id["identityId"]["base32Chars"] = 10
        mutations.append(short_id)

        for mutated in mutations:
            with self.subTest(mutated=mutated):
                with self.assertRaises(CatalogError):
                    validate_policy(mutated)

    def test_public_validator_rejects_exposure_and_semantic_mutations(self):
        policy, policy_bytes, parsed, built = build_fixture()
        quarantined_index = next(
            index for index, item in enumerate(built.public_entries)
            if item["disposition"] == "quarantined"
        )
        published_index = next(
            index for index, item in enumerate(built.public_entries)
            if item["disposition"] == "published"
        )

        mutations = []
        exposed = copy.deepcopy(built.public_entries)
        exposed[quarantined_index]["publicValue"] = "synthetic-private-value"
        mutations.append(exposed)
        duplicate = copy.deepcopy(built.public_entries)
        duplicate[1]["id"] = duplicate[0]["id"]
        mutations.append(duplicate)
        boolean_count = copy.deepcopy(built.public_entries)
        boolean_count[0]["occurrences"] = True
        mutations.append(boolean_count)
        bad_reasons = copy.deepcopy(built.public_entries)
        bad_reasons[published_index]["reasonCodes"] = ["z_reason", "a_reason"]
        mutations.append(bad_reasons)
        sensitive_url = copy.deepcopy(built.public_entries)
        sensitive_url[published_index]["publicValue"] += "?token=synthetic"
        mutations.append(sensitive_url)
        wrong_class = copy.deepcopy(built.public_entries)
        wrong_class[published_index]["classification"] = "unresolved"
        mutations.append(wrong_class)

        for mutated in mutations:
            with self.subTest():
                with self.assertRaises(CatalogError):
                    ETL.validate_public_entries(mutated, policy)

        numeric_proof = copy.deepcopy(built.proof)
        numeric_proof["coverage"]["byClassification"]["commercial"] = True
        with self.assertRaises(CatalogError):
            ETL.validate_proof(
                numeric_proof,
                built.public_entries,
                built.public_bytes,
                parsed,
                KEY,
                policy,
                policy_bytes,
            )

    def test_private_key_and_mapping_are_forced_outside_git_with_private_modes(self):
        policy, _ = load_policy(POLICY_PATH)
        with self.assertRaisesRegex(CatalogError, "outside the Git checkout"):
            ETL.require_private_path(POLICY_PATH, "private ledger", must_exist=True)
        with self.assertRaisesRegex(CatalogError, "outside the Git checkout"):
            ETL.require_private_path(ROOT / "private-map.json", "private map", must_exist=False)

        with tempfile.TemporaryDirectory() as directory:
            key_path = Path(directory) / "id.key"
            key_path.write_bytes(KEY)
            key_path.chmod(0o644)
            with self.assertRaisesRegex(CatalogError, "permissions"):
                ETL.read_private_key(key_path, policy)
            key_path.chmod(0o600)
            self.assertEqual(ETL.read_private_key(key_path, policy), KEY)
            key_path.write_bytes(b"too-short")
            with self.assertRaisesRegex(CatalogError, "length"):
                ETL.read_private_key(key_path, policy)

    def test_private_ledger_size_limit_is_enforced_before_open(self):
        policy, _ = load_policy(POLICY_PATH)
        policy = copy.deepcopy(policy)
        policy["limits"]["maximumInputBytes"] = 8
        with tempfile.TemporaryDirectory() as directory:
            ledger_path = Path(directory) / "ledger.tsv"
            ledger_path.write_bytes(b"123456789")

            with mock.patch.object(ETL.os, "open", side_effect=AssertionError("opened")):
                with self.assertRaisesRegex(CatalogError, "byte limit"):
                    ETL._read_private_ledger(ledger_path, policy)

    def test_build_write_and_check_round_trip_with_mutation_detection(self):
        policy, policy_bytes, parsed, built = build_fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private_path = root / "private-map.json"
            public_path = root / "sources.jsonl"
            proof_path = root / "source-catalog-proof.json"
            ETL.write_catalog(built, private_path, public_path, proof_path)
            self.assertEqual(stat.S_IMODE(private_path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(public_path.stat().st_mode), 0o644)
            self.assertEqual(stat.S_IMODE(proof_path.stat().st_mode), 0o644)
            ETL.check_catalog(
                built,
                parsed,
                KEY,
                policy,
                policy_bytes,
                private_path,
                public_path,
                proof_path,
            )

            mutations = ("public", "proof", "private")
            for target in mutations:
                with self.subTest(target=target):
                    ETL.write_catalog(built, private_path, public_path, proof_path)
                    if target == "public":
                        entries = [
                            json.loads(line) for line in public_path.read_text().splitlines()
                        ]
                        entries[0]["occurrences"] += 1
                        public_path.write_bytes(
                            b"".join(ETL.canonical_json(item) + b"\n" for item in entries)
                        )
                    elif target == "proof":
                        proof = json.loads(proof_path.read_text())
                        proof["coverage"]["totalOccurrences"] += 1
                        proof_path.write_bytes(ETL.canonical_json(proof) + b"\n")
                    else:
                        private_map = json.loads(private_path.read_text())
                        private_map["entries"][0]["value"] += "-mutated"
                        private_path.write_bytes(ETL.canonical_json(private_map) + b"\n")
                        private_path.chmod(0o600)
                    with self.assertRaises(CatalogError):
                        ETL.check_catalog(
                            built,
                            parsed,
                            KEY,
                            policy,
                            policy_bytes,
                            private_path,
                            public_path,
                            proof_path,
                        )

    def test_check_detects_policy_and_key_drift(self):
        policy, policy_bytes, parsed, built = build_fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private_path = root / "private-map.json"
            public_path = root / "sources.jsonl"
            proof_path = root / "source-catalog-proof.json"
            ETL.write_catalog(built, private_path, public_path, proof_path)

            rekeyed = ETL.build_catalog(parsed, SECOND_KEY, policy, policy_bytes)
            with self.assertRaises(CatalogError):
                ETL.check_catalog(
                    rekeyed,
                    parsed,
                    SECOND_KEY,
                    policy,
                    policy_bytes,
                    private_path,
                    public_path,
                    proof_path,
                )

            changed_policy = copy.deepcopy(policy)
            changed_policy["catalogVersion"] = "2"
            changed_policy_bytes = ETL.canonical_json(changed_policy) + b"\n"
            changed = ETL.build_catalog(parsed, KEY, changed_policy, changed_policy_bytes)
            with self.assertRaises(CatalogError):
                ETL.check_catalog(
                    changed,
                    parsed,
                    KEY,
                    changed_policy,
                    changed_policy_bytes,
                    private_path,
                    public_path,
                    proof_path,
                )

    def test_cli_build_and_check_use_only_explicit_private_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_path = root / "private-ledger.tsv"
            key_path = root / "id.key"
            private_path = root / "private-map.json"
            public_path = root / "sources.jsonl"
            proof_path = root / "source-catalog-proof.json"
            input_path.write_bytes(ledger_payload(fixture_rows()))
            key_path.write_bytes(KEY)
            key_path.chmod(0o600)
            base_command = [
                sys.executable,
                str(SCRIPT_PATH),
                "--input",
                str(input_path),
                "--id-key-file",
                str(key_path),
                "--private-map",
                str(private_path),
                "--public-output",
                str(public_path),
                "--proof-output",
                str(proof_path),
            ]
            built = subprocess.run(
                [*base_command, "--build"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            summary = json.loads(built.stdout)
            self.assertEqual(summary["identities"], len({tuple(row[:4]) for row in fixture_rows()}))
            self.assertNotIn("synthetic-secret-value", built.stdout + built.stderr)
            checked = subprocess.run(
                [*base_command, "--check"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(checked.returncode, 0, checked.stderr)
            self.assertEqual(json.loads(checked.stdout), summary)

            input_path.write_bytes(
                ledger_payload(
                    [*fixture_rows(), ("new", "source", "url", "https://example.org/new", "1")]
                )
            )
            drift = subprocess.run(
                [*base_command, "--check"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(drift.returncode, 0)
            self.assertNotIn("synthetic-secret-value", drift.stdout + drift.stderr)

    def test_default_public_targets_match_the_shared_source_ledger_contract(self):
        self.assertEqual(
            ETL.DEFAULT_PUBLIC_OUTPUT,
            ROOT / "data/source-ledger/sources.jsonl",
        )
        self.assertEqual(
            ETL.DEFAULT_PROOF_OUTPUT,
            ROOT / "data/source-ledger/source-catalog-proof.json",
        )


if __name__ == "__main__":
    unittest.main()

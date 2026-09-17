import copy
import contextlib
import io
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.etl import government_scorecard_refresh as refresh
from scripts.etl import government_scorecard_snapshot as score
from scripts.etl import government_scorecard_page as page
from tests.etl.test_government_scorecard_snapshot import ameco_zip, load_spec


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        redirect = contextlib.redirect_stdout(self.output)
        redirect.__enter__()
        self.addCleanup(redirect.__exit__, None, None, None)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.spec = load_spec()
        self.payload = ameco_zip(self.spec)
        self.core = score.build_snapshot(self.spec, self.payload, '2026-09-03T08:00:00Z')
        self.page = page._load(page.OUTPUT)
        self.registry = page._load(page.CHRONOLOGY_PATH)
        self.page['sources'][0] = page._ameco_source(self.core)
        self.page['series'][1] = page._ameco_series(self.core, self.page['sources'][0])[0]
        self.page['score_contract']['core_artifact_sha256'] = score.sha256(refresh.encoded(self.core))
        self.policy = page._load(refresh.POLICY_PATH)['refreshPolicy']
        self.policy['approvedSources'] = [refresh.receipt(item) for item in self.page['sources']]
        self.policy['coreArtifactSha256'] = score.sha256(refresh.encoded(self.core))
        self.policy['scoreAcquiredAt'] = self.core['sources']['ameco']['retrievedAt']
        self.write('scripts/etl/specs/government-scorecard.source.json', self.spec)
        self.write('scripts/etl/specs/government-scorecard-chronology.json', self.registry)
        self.write('src/data/generated/government-scorecard.json', self.core)
        self.write('src/data/generated/government-scorecard-page.json', self.page)
        self.save_policy()
        self.originals = self.files()

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(refresh.encoded(value))

    def save_policy(self):
        spec = page._load(refresh.POLICY_PATH)
        spec['refreshPolicy'] = self.policy
        self.write('scripts/etl/specs/government-scorecard-page.source.json', spec)

    def files(self):
        return {path.name: path.read_bytes() for path in (self.root / 'src/data/generated').iterdir()}

    def build(self, timestamp, **kwargs):
        result = copy.deepcopy(self.page)
        result['as_of_date'] = timestamp[:10]
        for source in result['sources'][1:]:
            source['retrieved_at'] = timestamp
        for series in result['series']:
            if series['indicator_id'] != 'real_compensation':
                for geo in series['geographies']:
                    for point in geo['points']:
                        point['retrieved_at'] = timestamp
        result['score_contract']['core_artifact_sha256'] = kwargs['core_hash']
        return result

    def run_refresh(self, builder=None, **kwargs):
        timestamp = kwargs.pop('timestamp', '2026-09-05T08:00:00Z')
        return refresh.refresh(timestamp, root=self.root,
                               fetch_score=lambda _: self.payload, build_page=builder or self.build, **kwargs)

    def approve_inflation_change(self):
        source = self.page['sources'][1]
        source['raw_sha256'] = 'a' * 64
        source['upstream_updated_at'] = '2026-09-04T08:00:00Z'
        for geo in self.page['series'][0]['geographies']:
            for point in geo['points']:
                point['raw_sha256'] = source['raw_sha256']
                point['value'] += 0.1
        self.policy['approvedSources'] = [refresh.receipt(item) for item in self.page['sources']]
        self.save_policy()

    def test_no_change_retains_exact_bytes_and_does_not_verify_or_publish(self):
        self.assertFalse(self.run_refresh(verify=lambda: self.fail('no candidate expected')))
        self.assertEqual(self.files(), self.originals)

    def test_approved_update_then_repeated_poll_is_idempotent(self):
        self.approve_inflation_change()
        self.assertTrue(self.run_refresh())
        first = self.files()
        self.page = page._load(self.root / 'src/data/generated/government-scorecard-page.json')
        self.assertFalse(self.run_refresh())
        self.assertEqual(self.files(), first)
        self.assertEqual(first['government-scorecard.json'], self.originals['government-scorecard.json'])

    def test_incomplete_or_malformed_raw_score_never_writes(self):
        for payload in (b'not zip', ameco_zip(self.spec, omit_member='AMECO18.CSV')):
            self.payload = payload
            with self.assertRaises(score.SnapshotError):
                self.run_refresh()
            self.assertEqual(self.files(), self.originals)

    def test_schema_source_license_identity_period_and_hash_drift(self):
        mutations = [
            lambda value: value.__setitem__('schema_version', 99),
            lambda value: value['sources'][1].__setitem__('owner', 'other'),
            lambda value: value['sources'][1].__setitem__('terms_url', 'https://example.test/license'),
            lambda value: value['sources'][1].__setitem__('dataset_code', 'other'),
            lambda value: value['sources'][1].__setitem__('raw_sha256', '0' * 64),
            lambda value: value['series'][0]['geographies'][0]['points'][0].__setitem__('period', '2050-01'),
            lambda value: value['contexts'][0].__setitem__('government_id', 'other'),
        ]
        for mutation in mutations:
            def builder(timestamp, **kwargs):
                result = self.build(timestamp, **kwargs)
                mutation(result)
                return result
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.run_refresh(builder)
            self.assertEqual(self.files(), self.originals)

    def test_no_common_observed_panel_keeps_last_valid_snapshot(self):
        def missing(indicator, country, filename, row):
            if indicator == 'unemployment' and country == 'spain':
                row[5 + 2024 - 1960] = ':'
        self.payload = ameco_zip(self.spec, mutate_row=missing)
        with self.assertRaisesRegex(ValueError, 'osservazione obbligatoria'):
            self.run_refresh()
        self.assertEqual(self.files(), self.originals)

    def test_license_declaration_drift_fails_before_acquisition(self):
        path = self.root / 'scripts/etl/specs/government-scorecard-page.source.json'
        spec = page._load(path)
        spec['sourceContract']['license']['eurostat'] = 'other license'
        path.write_bytes(refresh.encoded(spec))
        with self.assertRaisesRegex(ValueError, 'license drift'):
            self.run_refresh()
        self.assertEqual(self.files(), self.originals)

    def test_partial_page_update_is_rejected(self):
        def builder(timestamp, **kwargs):
            result = self.build(timestamp, **kwargs)
            result['series'][0]['geographies'][0]['points'].pop(0)
            return result
        with self.assertRaisesRegex(ValueError, 'partial update'):
            self.run_refresh(builder)
        self.assertEqual(self.files(), self.originals)

    def test_forecast_flag_cannot_become_observed(self):
        for flag in ('f', 'epf', 'unknown'):
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                page._publication_status(flag)

    def test_context_review_expiry_does_not_modify_the_snapshot(self):
        with self.assertRaisesRegex(ValueError, 'quarterly context review overdue'):
            self.run_refresh(timestamp='2026-12-03T08:00:00Z')
        self.assertEqual(self.files(), self.originals)
        self.assertEqual(str(refresh.review_deadline('2026-01-31')), '2026-04-30')

    def test_unchanged_context_review_advances_snapshot_date_once(self):
        self.policy['contextReview']['reviewedAt'] = '2026-09-04'
        self.save_policy()

        self.assertTrue(self.run_refresh(timestamp='2026-09-04T08:00:00Z'))
        first = self.files()
        result = page._load(self.root / 'src/data/generated/government-scorecard-page.json')
        self.assertEqual(result['as_of_date'], '2026-09-04')
        self.assertEqual(first['government-scorecard.json'], self.originals['government-scorecard.json'])

        self.page = result
        self.assertFalse(self.run_refresh(timestamp='2026-09-05T08:00:00Z'))
        self.assertEqual(self.files(), first)

    def test_failed_final_validation_restores_both_exact_original_files(self):
        self.approve_inflation_change()
        def fail():
            raise RuntimeError('runtime contract failure')
        with self.assertRaisesRegex(RuntimeError, 'runtime contract'):
            self.run_refresh(verify=fail)
        self.assertEqual(self.files(), self.originals)

    def test_staging_failure_keeps_both_original_files(self):
        outputs = {self.root / 'src/data/generated/government-scorecard.json': {'changed': 1},
                   self.root / 'src/data/generated/government-scorecard-page.json': {'changed': 2}}
        original_write = score.atomic_write
        calls = 0
        def write(path, value):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('disk failure')
            original_write(path, value)
        with patch.object(score, 'atomic_write', side_effect=write), self.assertRaises(OSError):
            refresh.replace_release(outputs, lambda: None)
        self.assertEqual(self.files(), self.originals)

    def test_second_install_failure_restores_first_by_rename(self):
        outputs = {self.root / 'src/data/generated/government-scorecard.json': {'changed': 1},
                   self.root / 'src/data/generated/government-scorecard-page.json': {'changed': 2}}
        real_replace = refresh.os.replace
        def replace(source, target):
            if str(source).endswith('1.candidate'):
                raise OSError('disk failure')
            real_replace(source, target)
        with patch.object(refresh.os, 'replace', side_effect=replace), self.assertRaises(OSError):
            refresh.replace_release(outputs, lambda: None)
        self.assertEqual(self.files(), self.originals)

    def test_economic_poll_preserves_existing_editorial_caveats(self):
        self.core['caveats'][2] = 'Reviewed editorial caveat retained verbatim.'
        self.write('src/data/generated/government-scorecard.json', self.core)
        digest = score.sha256(refresh.encoded(self.core))
        self.page['score_contract']['core_artifact_sha256'] = digest
        self.write('src/data/generated/government-scorecard-page.json', self.page)
        self.policy['coreArtifactSha256'] = digest
        self.save_policy()
        before = self.files()
        self.assertFalse(self.run_refresh())
        self.assertEqual(self.files(), before)

    def test_government_change_requires_complete_reviewed_context(self):
        self.registry['verifiedAt'] = self.registry['asOfDate'] = '2026-09-04'
        self.registry['governments'].append({
            'id': 'fixture-i', 'name': 'Fixture I', 'startDate': '2026-09-04',
            'sourceOwner': 'Presidenza della Repubblica',
            'sourceUrl': 'https://www.quirinale.it/it/notizie/fixture-giuramento',
            'sourceLocator': 'Fixture del giuramento verificato del 4 settembre 2026.',
        })
        refresh.chronology.validate_registry(self.registry)
        self.write('scripts/etl/specs/government-scorecard-chronology.json', self.registry)
        with self.assertRaisesRegex(ValueError, 'context government'):
            self.run_refresh()
        self.assertEqual(self.files(), self.originals)

    def test_reviewed_government_transition_preserves_score_and_closes_previous_mandate(self):
        self.registry['verifiedAt'] = self.registry['asOfDate'] = '2026-09-04'
        government = {
            'id': 'fixture-i', 'name': 'Fixture I', 'startDate': '2026-09-04',
            'sourceOwner': 'Presidenza della Repubblica',
            'sourceUrl': 'https://www.quirinale.it/it/notizie/fixture-giuramento',
            'sourceLocator': 'Fixture del giuramento verificato del 4 settembre 2026.',
        }
        self.registry['governments'].append(government)
        old_oath = self.page['contexts'][-1]['slides'][-1]['items'][0]
        old_oath['end_date_or_null'] = government['startDate']
        old_oath['period'] = old_oath['start_date'] + '–' + government['startDate']
        old_oath['evidence_sha256'] = page._canonical_hash({key: value for key, value in old_oath.items() if key not in ('retrieved_at', 'evidence_sha256')})
        context = {'government_id': government['id'], 'government_name': government['name'], 'slides': []}
        for category in page.CONTEXT_CATEGORIES:
            item = page._context_item('fixture-i:' + category.replace('_', '-'), 'Fixture',
                government['sourceLocator'], government['startDate'], None, 'institutional_timeline',
                government['sourceUrl'], '2026-09-04T08:00:00Z')
            context['slides'].append(page._ready_slide(category, 'Fixture', 'Fixture', 'Fixture', [item]))
        self.page['contexts'].append(context)
        self.policy['contextReview'] = {'reviewedAt': '2026-09-04',
            'contextsSha256': page._canonical_hash(self.page['contexts']),
            'chronologySha256': page._canonical_hash(self.registry)}
        self.write('scripts/etl/specs/government-scorecard-chronology.json', self.registry)
        self.save_policy()
        self.assertTrue(self.run_refresh())
        result = page._load(self.root / 'src/data/generated/government-scorecard-page.json')
        self.assertEqual(len(result['contexts']), 18)
        self.assertEqual(result['contexts'][-2]['slides'][-1]['items'][0]['end_date_or_null'], '2026-09-04')
        self.assertEqual(self.files()['government-scorecard.json'], self.originals['government-scorecard.json'])

    def test_observation_mode_emits_receipts_without_writing_unapproved_changes(self):
        self.page['sources'][1]['raw_sha256'] = 'a' * 64
        self.assertFalse(self.run_refresh(observe=True))
        self.assertEqual(self.files(), self.originals)


class OfflineContextReviewDateTests(unittest.TestCase):
    def setUp(self):
        self.core = score.load_json(score.DEFAULT_OUTPUT)
        self.supplemental = page._load(page.OUTPUT)
        self.registry = page._load(page.CHRONOLOGY_PATH)
        self.policy = refresh.load_policy(refresh.POLICY_PATH)

    def test_offline_release_rejects_future_review_with_valid_hashes(self):
        self.policy['contextReview']['reviewedAt'] = (
            refresh.dt.date.fromisoformat(self.supplemental['as_of_date'])
            + refresh.dt.timedelta(days=1)
        ).isoformat()
        self.assertEqual(self.policy['contextReview']['contextsSha256'],
                         page._canonical_hash(self.supplemental['contexts']))
        self.assertEqual(self.policy['contextReview']['chronologySha256'],
                         page._canonical_hash(self.registry))
        with self.assertRaisesRegex(ValueError, 'context review date exceeds snapshot as_of_date'):
            refresh.validate_release(self.core, self.supplemental, self.registry, self.policy)

    def test_offline_release_rejects_future_snapshot_and_review(self):
        future = (refresh.dt.datetime.now(refresh.dt.UTC).date() + refresh.dt.timedelta(days=1)).isoformat()
        self.supplemental['as_of_date'] = future
        self.policy['contextReview']['reviewedAt'] = future
        with self.assertRaisesRegex(ValueError, 'snapshot as_of_date exceeds validation date'):
            refresh.validate_release(self.core, self.supplemental, self.registry, self.policy)

    def test_offline_release_accepts_review_on_snapshot_date_and_current_release(self):
        refresh.validate_release(self.core, self.supplemental, self.registry, self.policy)
        self.policy['contextReview']['reviewedAt'] = self.supplemental['as_of_date']
        refresh.validate_release(self.core, self.supplemental, self.registry, self.policy)

    def test_offline_release_still_rejects_review_before_registry_verification(self):
        self.policy['contextReview']['reviewedAt'] = (
            refresh.dt.date.fromisoformat(self.registry['verifiedAt'])
            - refresh.dt.timedelta(days=1)
        ).isoformat()
        with self.assertRaisesRegex(ValueError, 'requires a matching editorial review'):
            refresh.validate_release(self.core, self.supplemental, self.registry, self.policy)

    def test_ci_checker_inherits_future_review_rejection(self):
        checker = runpy.run_path(str(refresh.ROOT / 'scripts/ci/check-government-scorecard-artifacts.py'))
        with contextlib.redirect_stdout(io.StringIO()):
            checker['main']()
        policy = copy.deepcopy(self.policy)
        policy['contextReview']['reviewedAt'] = (
            refresh.dt.date.fromisoformat(self.supplemental['as_of_date'])
            + refresh.dt.timedelta(days=1)
        ).isoformat()
        # Replace only the receipt input; exercise the real checker and validator.
        with patch.object(checker['government_scorecard_refresh'], 'load_policy', return_value=policy):
            with self.assertRaisesRegex(ValueError, 'context review date exceeds snapshot as_of_date'):
                checker['main']()


class RawEurostatTests(unittest.TestCase):
    def cube(self):
        return {'version': '2.0', 'class': 'dataset', 'source': 'ESTAT',
                'id': ['freq', 'geo', 'time'], 'size': [1, 4, 1],
                'dimension': {key: {'category': {'index': values}} for key, values in
                              {'freq': ['A'], 'geo': ['IT', 'FR', 'DE', 'ES'], 'time': ['2025']}.items()},
                'value': {'0': 1, '1': 2, '2': 3, '3': 4}}

    def test_valid_cube_and_malformed_payloads(self):
        page.validate_jsonstat(self.cube(), (('freq', 'A'),))
        for mutate in (
            lambda v: v.__setitem__('source', 'other'),
            lambda v: v.__setitem__('version', '3'),
            lambda v: v.__setitem__('value', [1]),
            lambda v: v.__setitem__('size', [1, 5, 1]),
            lambda v: v['dimension']['time']['category'].__setitem__('index', ['2025-13']),
            lambda v: v.__setitem__('status', {'0': 'f'}),
        ):
            candidate = self.cube()
            mutate(candidate)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                page.validate_jsonstat(candidate, (('freq', 'A'),))

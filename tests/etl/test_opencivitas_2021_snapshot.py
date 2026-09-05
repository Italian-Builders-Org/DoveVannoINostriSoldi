import copy
import unittest
import opencivitas_2021_snapshot as snapshot

class HistoricalReleaseTest(unittest.TestCase):
    def test_coherent_tampering_is_rejected_offline(self):
        original = snapshot.load_json(snapshot.OUTPUT)
        snapshot.validate_snapshot(original)
        for field in ('amounts', 'license', 'hash'):
            with self.subTest(field=field):
                altered = copy.deepcopy(original)
                if field == 'amounts':
                    altered['municipalityRows'][0][4] += 100
                    altered['municipalityRows'][0][6] += 100
                elif field == 'license':
                    altered['source']['license'] = 'Unverified'
                else:
                    altered['source']['sha256']['data'] = '0' * 64
                with self.assertRaisesRegex(snapshot.StructuralError, 'SHA-256 semantico'):
                    snapshot.validate_snapshot(altered)

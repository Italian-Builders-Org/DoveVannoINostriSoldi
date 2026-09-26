import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts/etl/mantova_offices_snapshot.py"
spec = importlib.util.spec_from_file_location("mantova_offices_snapshot", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def page(body, people=()):
    links = "".join(
        f'<a href="https://www.comune.mantova.it/it/person/{slug}">{name}</a>'
        for slug, name in people
    )
    return f"<html><body>{body}{links}</body></html>".encode()


class MantovaOfficesSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.giunta = [("murari-andrea", "Andrea Murari")] + [(f"assessore-{i}", f"Assessore {i}") for i in range(9)]
        self.consiglio = [(f"consigliere-{i}", f"Consigliere {i}") for i in range(32)]
        self.write("giunta", page(
            "Giunta comunale presieduta dal Sindaco Andrea Murari, nominata il giorno 8 giugno 2026. "
            "Ultimo aggiornamento: 19 giugno 2026", self.giunta,
        ))
        self.write("consiglio", page(
            "Consiglio comunale. Campisi Matteo (Presidente del Consiglio Comunale). "
            "Ultimo aggiornamento: 7 settembre 2026", self.consiglio,
        ))
        self.write("nomina", page(
            "8 giugno 2026. Il vicesindaco sarà l’assessora Chiara Sortino. "
            "Ultimo aggiornamento: 25 giugno 2026. " + " ".join(name for _, name in self.giunta),
        ))
        self.write("insediamento", page(
            "11 giugno 2026. Primo Consiglio il 10 giugno, mandato Amministrativo 2026/2031. "
            "Ultimo aggiornamento: 23 giugno 2026. " + " ".join(name for _, name in self.consiglio),
        ))
        self.write("licenza", page(
            "i dati, i documenti e le informazioni pubblicati sul sito sono rilasciati con licenza CC-BY 4.0",
        ))

    def write(self, source_id, body):
        (self.directory / module.SOURCE_FILES[source_id]).write_bytes(body)

    def test_builds_bounded_release_and_raw_hashes(self):
        release = module.build_snapshot(self.directory, "2026-09-26")
        self.assertEqual(len(release["members"]), 42)
        self.assertEqual(release["coverage"]["organs"], ["giunta", "consiglio"])
        self.assertFalse(release["coverage"]["historical"])
        self.assertEqual(release["members"][0]["role"], "Sindaco")
        self.assertEqual(release["members"][0]["membershipStartDate"], "2026-06-08")
        raw = (self.directory / module.SOURCE_FILES["giunta"]).read_bytes()
        self.assertEqual(release["sources"][0]["sha256"], hashlib.sha256(raw).hexdigest())

    def test_rejects_changed_roster_or_reuse_conditions(self):
        self.write("consiglio", page("Consiglio comunale. Campisi Matteo (Presidente del Consiglio Comunale). Ultimo aggiornamento: 7 settembre 2026", self.consiglio[:-1]))
        with self.assertRaisesRegex(ValueError, "copertura organi cambiata"):
            module.build_snapshot(self.directory, "2026-09-26")
        self.write("consiglio", page("Consiglio comunale. Campisi Matteo (Presidente del Consiglio Comunale). Ultimo aggiornamento: 7 settembre 2026", self.consiglio))
        self.write("licenza", page("licenza non indicata"))
        with self.assertRaisesRegex(ValueError, "condizioni di riuso"):
            module.build_snapshot(self.directory, "2026-09-26")

    def test_rejects_conflicting_profile_identity(self):
        altered = self.giunta + [("murari-andrea", "Un altro nome")]
        self.write("giunta", page("Giunta comunale presieduta dal Sindaco Andrea Murari, nominata il giorno 8 giugno 2026. Ultimo aggiornamento: 19 giugno 2026", altered))
        with self.assertRaisesRegex(ValueError, "due identità"):
            module.build_snapshot(self.directory, "2026-09-26")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""I percorsi scritti negli artefatti devono essere POSIX, su qualunque sistema li generi.

``str(path.relative_to(ROOT))`` usa il separatore del sistema: su Windows produce
``src\\data\\generated\\...``. Il ``--check`` in locale non se ne accorge, perche'
confronta un valore generato sulla stessa macchina; la CI su Linux lo ricalcola con
le barre normali e rifiuta il lock con «metadata differs», un messaggio che non
somiglia alla causa. Fino a questa correzione dodici controlli offline su dodici
fallivano cosi' su Windows, su main intatto.
"""

import re
import unittest
from pathlib import Path, PurePosixPath, PureWindowsPath

ROOT = Path(__file__).resolve().parents[2]
ETL = ROOT / "scripts" / "etl"
# Un percorso relativo alla radice reso stringa con il separatore del sistema.
PLATFORM_DEPENDENT = re.compile(r"\bstr\(\s*[A-Za-z_][A-Za-z0-9_]*\.relative_to\(")


class ArtifactPathsArePosixTest(unittest.TestCase):
    def test_the_platform_separator_is_what_breaks_the_lock(self) -> None:
        """Il motivo della regola, dimostrato senza bisogno di girare su Windows."""
        relativo = ("src", "data", "generated", "esempio.json")
        self.assertEqual(str(PureWindowsPath(*relativo)), "src\\data\\generated\\esempio.json")
        self.assertEqual(str(PurePosixPath(*relativo)), "src/data/generated/esempio.json")
        # as_posix() li rende uguali, ed e' questo che il lock deve contenere.
        self.assertEqual(PureWindowsPath(*relativo).as_posix(), PurePosixPath(*relativo).as_posix())

    def test_no_etl_writes_a_platform_dependent_path(self) -> None:
        colpevoli = []
        for script in sorted(ETL.glob("*.py")):
            for numero, riga in enumerate(script.read_text(encoding="utf-8").splitlines(), start=1):
                if PLATFORM_DEPENDENT.search(riga):
                    colpevoli.append(f"{script.relative_to(ROOT).as_posix()}:{numero}: {riga.strip()}")
        self.assertEqual(
            colpevoli,
            [],
            "usare .relative_to(ROOT).as_posix() invece di str(...relative_to(ROOT)):\n" + "\n".join(colpevoli),
        )

    def test_the_guard_recognises_the_forms_it_must_refuse(self) -> None:
        """Una guardia che non riconosce il difetto passerebbe sempre: la provo sui casi veri."""
        for riga in (
            '"path": str(DATA.relative_to(ROOT)),',
            '"path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),',
            '"dataArtifact": {"path": str(data_path.relative_to(ROOT)), "bytes": data_bytes},',
        ):
            self.assertIsNotNone(PLATFORM_DEPENDENT.search(riga), riga)
        for riga in (
            '"path": DATA.relative_to(ROOT).as_posix(),',
            'label = str(value)',
        ):
            self.assertIsNone(PLATFORM_DEPENDENT.search(riga), riga)


if __name__ == "__main__":
    unittest.main()

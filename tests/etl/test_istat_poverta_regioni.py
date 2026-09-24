#!/usr/bin/env python3
"""Reconciliation tests for the ISTAT regional relative poverty slice."""

import json
import unittest
from istat_poverta_regioni import (
    DATA,
    MEASURES,
    META,
    SPEC,
    SnapshotError,
    check,
    load_spec,
    ratio_bounds,
    read_measure,
    validate_data,
)

def snapshot() -> dict:
    return json.loads(DATA.read_bytes())


class IstatPovertaRegioniSnapshotTest(unittest.TestCase):
    def test_committed_artifacts_match_the_reviewed_lock(self) -> None:
        check()
        spec = load_spec()
        data = snapshot()
        self.assertEqual(data["datasetId"], "istat-poverta-regioni")
        self.assertEqual(len(data["territories"]), 30)
        self.assertEqual(spec["source"]["licenseId"], "not-declared")
        self.assertFalse(spec["semantics"]["soldi"]["present"])
        meta = json.loads(META.read_bytes())
        self.assertEqual(meta["integrity"]["dataArtifact"]["bytes"], len(DATA.read_bytes()))

    def test_the_two_kinds_of_absence_stay_distinct_and_are_never_zero(self) -> None:
        data = snapshot()
        griglia = data["reconciliation"]["grid"]["cells"]
        for misura, attesi in data["reconciliation"]["byMeasure"].items():
            diffusi = [r for r in data["observations"] if r["measure"] == misura]
            non_diffusi = [r for r in data["undiffused"] if r["measure"] == misura]
            assenti = [r for r in data["missingRows"] if r["measure"] == misura]
            self.assertEqual(len(diffusi), attesi["published"], misura)
            self.assertEqual(len(non_diffusi), attesi["undiffused"], misura)
            self.assertEqual(len(assenti), attesi["missing"], misura)
            self.assertEqual(len(diffusi) + len(non_diffusi) + len(assenti), griglia, misura)
        # Nessuna cella dichiarata assente compare fra i valori, e nessun valore vale zero.
        dichiarate = {(r["measure"], r["territory"], r["year"]) for r in data["undiffused"] + data["missingRows"]}
        pubblicate = {(r["measure"], r["territory"], r["year"]) for r in data["observations"]}
        self.assertEqual(dichiarate & pubblicate, set())
        self.assertNotIn(0, [r["valueHundredths"] for r in data["observations"]])
        # La riga che manca del tutto e' la stessa per entrambe le misure.
        self.assertEqual(
            sorted((r["territory"], r["year"]) for r in data["missingRows"]),
            [("ITD1", 2016), ("ITD1", 2016)],
        )

    def test_bolzano_has_no_household_value_at_all(self) -> None:
        data = snapshot()
        familiari = [r for r in data["observations"] if r["territory"] == "ITD1" and r["measure"] == "households"]
        self.assertEqual(familiari, [], "Bolzano pubblica un valore familiare: rivedere l'esclusione")
        non_diffusi = [r for r in data["undiffused"] if r["territory"] == "ITD1" and r["measure"] == "households"]
        self.assertEqual(len(non_diffusi), 10)

    def test_the_ratio_invariant_refuses_a_flagged_cell_read_as_zero(self) -> None:
        """Il flag '0' di CL_FLAG direbbe «meno della meta' della cifra minima»: i dati lo smentiscono."""
        spec = load_spec()
        data = snapshot()
        limiti = spec["invariants"]["individualToHouseholdRatio"]
        self.assertEqual(data["ratioBounds"], limiti)
        self.assertEqual(ratio_bounds(data["observations"]), limiti)
        # Sulle coppie valide il rapporto individui/famiglie non esce da [0,903 ; 1,919]:
        # leggere una cella non diffusa come "quasi zero" produrrebbe rapporti di due ordini piu' grandi.
        self.assertGreater(limiti["min"], 5_000)
        self.assertLess(limiti["max"], 40_000)
        umbria_2015 = next(
            r for r in data["observations"]
            if r["territory"] == "ITE2" and r["year"] == 2015 and r["measure"] == "individuals"
        )
        self.assertEqual(umbria_2015["valueHundredths"], 1340)

        manomesso = json.loads(json.dumps(data))
        manomesso["undiffused"] = [r for r in manomesso["undiffused"] if not (
            r["territory"] == "ITE2" and r["year"] == 2015 and r["measure"] == "households")]
        manomesso["observations"].append(
            {"territory": "ITE2", "measure": "households", "year": 2015, "valueHundredths": 4})
        with self.assertRaises(SnapshotError):
            validate_data(manomesso, spec)

    def test_source_bytes_outside_the_lock_are_refused(self) -> None:
        spec = load_spec()
        originale = SPEC.read_bytes()
        try:
            alterata = json.loads(originale)
            alterata["reconciliation"]["byMeasure"]["households"]["published"] += 1
            SPEC.write_bytes(json.dumps(alterata, indent=2, ensure_ascii=False).encode("utf-8") + b"\n")
            with self.assertRaises(SnapshotError):
                load_spec()
        finally:
            SPEC.write_bytes(originale)
        # e il lock ripristinato torna valido
        self.assertEqual(load_spec()["integrity"], spec["integrity"])

    def test_reader_separates_values_flagged_cells_and_missing_rows(self) -> None:
        """Le tre forme che una cella puo' assumere nella risposta, su un CSV costruito qui."""
        spec = load_spec()
        misura = next(m for m in MEASURES if m["key"] == "households")
        intestazione = ",".join(spec["headers"])
        fisse = dict(spec["fixedDimensions"])

        def riga(area: str, anno: int, valore: str, flag: str) -> str:
            campi = {
                "DATAFLOW": f"IT1:{misura['dataflowId']}(1.0)",
                "DATA_TYPE": misura["code"],
                "REF_AREA": area,
                "TIME_PERIOD": str(anno),
                "OBS_VALUE": valore,
                "OBS_STATUS": flag,
                **fisse,
            }
            return ",".join(campi.get(colonna, "") for colonna in spec["headers"])

        payload = "\n".join([intestazione, riga("IT", 2014, "10.2", ""), riga("ITE2", 2015, "", "0")]) + "\n"
        diffusi, non_diffusi, assenti = read_measure(payload.encode("utf-8"), misura, spec)
        self.assertEqual(diffusi, [{"territory": "IT", "measure": "households", "year": 2014, "valueHundredths": 1020}])
        self.assertEqual(non_diffusi, [{"territory": "ITE2", "measure": "households", "year": 2015, "flag": "0"}])
        # Tutte le altre celle della griglia 30x11 risultano assenti, non zero.
        self.assertEqual(len(assenti), 30 * 11 - 2)
        self.assertNotIn(("IT", 2014), [(r["territory"], r["year"]) for r in assenti])

        # Un valore che arriva con un flag non e' un valore diffuso: la fonte e' cambiata.
        with self.assertRaises(SnapshotError):
            read_measure(("\n".join([intestazione, riga("IT", 2014, "10.2", "0")]) + "\n").encode("utf-8"), misura, spec)
        # Una cella vuota senza flag e' un'altra cosa ancora, e va rifiutata.
        with self.assertRaises(SnapshotError):
            read_measure(("\n".join([intestazione, riga("IT", 2014, "", "")]) + "\n").encode("utf-8"), misura, spec)


if __name__ == "__main__":
    unittest.main()

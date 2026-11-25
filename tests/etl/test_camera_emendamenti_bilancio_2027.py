"""Parser degli emendamenti alla legge di bilancio 2027 su pagine reali della Camera."""

from __future__ import annotations

import unittest
from pathlib import Path

import camera_emendamenti_bilancio_2027 as etl

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures" / "camera-emendamenti-bilancio-2027"


def page(amendment_id: str) -> dict:
    markup = (FIXTURES / "pages" / f"{amendment_id}.html").read_text(encoding="utf-8")
    return etl.parse_page(markup, amendment_id)


class ListTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.markup = (FIXTURES / "lista-prime-40.html").read_text(encoding="utf-8")
        cls.rows = etl.parse_list(cls.markup)

    def test_reads_every_row_in_publication_order(self) -> None:
        self.assertEqual(len(self.rows), 40)
        self.assertEqual([row["position"] for row in self.rows], list(range(1, 41)))
        self.assertEqual({row["section"] for row in self.rows}, {"Art. 2", "Art. 3"})
        self.assertEqual(self.rows[0]["id"], "2.1")

    def test_outcome_and_reason_come_from_the_official_annotation(self) -> None:
        counts = {}
        for row in self.rows:
            counts[row["outcome"]] = counts.get(row["outcome"], 0) + 1
            # An admissible row never carries a reason, an inadmissible one always does.
            self.assertEqual(row["reason"] is not None, row["outcome"] == "inammissibile")
        self.assertEqual(counts, {"ammissibile": 23, "inammissibile": 17})

    def test_more_signers_than_listed_are_not_counted_from_the_list(self) -> None:
        by_id = {row["id"]: row for row in self.rows}
        self.assertIsNone(by_id["2.1"]["listedSigners"])  # "e altri"
        self.assertEqual(by_id["2.4"]["listedSigners"], 2)

    def test_identical_amendments_are_valid_numbers(self) -> None:
        linked = [row for row in self.rows if row["identicalTo"]]
        self.assertEqual(len(linked), 17)
        for row in linked:
            self.assertNotIn(row["id"], row["identicalTo"])

    def test_unknown_outcome_is_refused(self) -> None:
        broken = self.markup.replace("(inammissibile per carenza di compensazione)", "(accantonato)", 1)
        self.assertNotEqual(broken, self.markup)
        with self.assertRaises(etl.EmendamentiError):
            etl.parse_list(broken)

    def test_missing_row_is_refused(self) -> None:
        start = self.markup.index('<tr class="normale"')
        end = self.markup.index("</tr>", start) + len("</tr>")
        with self.assertRaises(etl.EmendamentiError):
            etl.parse_list(self.markup[:start] + self.markup[end:])


class PageTests(unittest.TestCase):
    def test_signers_are_read_in_order_from_the_page(self) -> None:
        self.assertEqual(len(page("2.1")["signers"]), 7)
        self.assertEqual(len(page("2.4")["signers"]), 2)
        self.assertEqual(page("89.010")["signers"], [{"personId": "308892", "name": "Furfaro Marco"}])

    def test_government_amendment_has_no_deputy(self) -> None:
        self.assertEqual(page("85.0100")["signers"], [{"personId": None, "name": "Il Governo"}])

    def test_outcome_text_matches_the_list_annotation(self) -> None:
        self.assertEqual(page("89.010")["outcomeText"], "inammissibile (inammissibile per estraneità di materia)")
        self.assertEqual(page("2.4")["outcomeText"], "inammissibile (inammissibile per carenza di compensazione)")
        self.assertEqual(page("2.08")["outcomeText"], "")
        # Partial inadmissibility is declared only in the list.
        self.assertEqual(page("42.026")["outcomeText"], "")

    def test_page_of_another_amendment_is_refused(self) -> None:
        markup = (FIXTURES / "pages" / "2.4.html").read_text(encoding="utf-8")
        with self.assertRaises(etl.EmendamentiError):
            etl.parse_page(markup, "2.5")

    def test_empty_shell_is_refused(self) -> None:
        with self.assertRaises(etl.EmendamentiError):
            etl.parse_page("<html><body><div id='wrapper'></div></body></html>", "2.4")


class SpendingTests(unittest.TestCase):
    def test_same_amount_for_each_year(self) -> None:
        spending = etl.parse_spending(page("2.08")["text"])
        self.assertEqual(spending["kind"], "dotazione di un fondo")
        self.assertEqual(spending["byYearCents"], {2027: 6_000_000_000, 2028: 6_000_000_000, 2029: 6_000_000_000})
        self.assertEqual(spending["trienniumCents"], 18_000_000_000)
        self.assertFalse(spending["permanent"])

    def test_different_amounts_by_year(self) -> None:
        spending = etl.parse_spending(page("89.010")["text"])
        self.assertEqual(spending["byYearCents"], {2027: 500_000_000, 2028: 2_000_000_000, 2029: 2_500_000_000})
        self.assertIn("comune di Pescia", spending["evidence"])
        self.assertTrue(spending["evidence"].endswith("25 milioni di euro per l'anno 2029 …"))

    def test_amount_written_before_the_number_and_permanent_from_a_year(self) -> None:
        spending = etl.parse_spending(page("85.0100")["text"])
        self.assertEqual(spending["byYearCents"], {2027: 65_237_900, 2028: 69_087_000, 2029: 69_087_000})
        self.assertTrue(spending["permanent"])

    def test_amount_without_years_is_not_spread_over_the_triennium(self) -> None:
        spending = etl.parse_spending("Per il contributo è autorizzata la spesa di 40 milioni di euro. Agli oneri si provvede.")
        self.assertEqual(spending["items"], [{"cents": 4_000_000_000, "years": None, "since": None}])
        self.assertIsNone(spending["trienniumCents"])
        self.assertIsNone(spending["byYearCents"])

    def test_years_outside_the_budget_are_not_added(self) -> None:
        spending = etl.parse_spending("È autorizzata la spesa di 10 milioni di euro per ciascuno degli anni dal 2028 al 2031.")
        self.assertEqual(spending["byYearCents"], {2027: 0, 2028: 1_000_000_000, 2029: 1_000_000_000})
        self.assertTrue(spending["permanent"], "la spesa prosegue dopo il 2029")

    def test_amounts_only_outside_the_triennium_have_no_triennium_total(self) -> None:
        spending = etl.parse_spending("È autorizzata la spesa di 10 milioni di euro per l'anno 2030.")
        self.assertIsNone(spending["trienniumCents"])
        self.assertIsNone(spending["byYearCents"])
        self.assertTrue(spending["permanent"])

    def by_year(self, text: str) -> list[int] | None:
        spending = etl.parse_spending(text)
        return None if spending["byYearCents"] is None else [cents // 100 for cents in spending["byYearCents"].values()]

    def test_yearly_formulas_seen_in_the_texts(self) -> None:
        million = 1_000_000
        self.assertEqual(self.by_year("è autorizzata la spesa di 40 milioni di euro annui dal 2027 al 2031. Il"), [40 * million] * 3)
        self.assertEqual(self.by_year("con una dotazione di 10 milioni di euro da erogare in ciascuno degli anni 2027 e 2028. 3."), [10 * million, 10 * million, 0])
        self.assertEqual(
            self.by_year("è autorizzata la spesa di 25 milioni di euro per il 2027, di 50 milioni per il 2028 e di 50 milioni per il 2029 a sostegno"),
            [25 * million, 50 * million, 50 * million],
        )
        self.assertEqual(self.by_year("è autorizzata la spesa di 5.000.000 euro annui, a decorrere dall'anno 2027, da destinare"), [5 * million] * 3)

    def test_year_written_before_the_formula(self) -> None:
        self.assertEqual(self.by_year("Altro. Per l'anno 2027 è autorizzata la spesa di 7,5 milioni di euro. Fine"), [7_500_000, 0, 0])
        self.assertEqual(self.by_year("è istituito, per l'anno 2027, un fondo con una dotazione pari a 3.000 milioni di euro. z"), [3_000_000_000, 0, 0])
        # A year in a previous sentence does not date the amount.
        self.assertIsNone(self.by_year("Per l'anno 2027 si provvede. Inoltre è autorizzata la spesa di 5 milioni di euro. Fine"))

    def test_total_with_breakdown_is_read_only_when_the_parts_add_up(self) -> None:
        text = "è autorizzata la spesa complessiva di 15 milioni di euro, di cui 1 milione per l'anno 2027 e 7 milioni per ciascuno degli anni 2028 e 2029, per"
        self.assertEqual(self.by_year(text), [1_000_000, 7_000_000, 7_000_000])
        self.assertIsNone(self.by_year(text.replace("7 milioni", "6 milioni")))

    def test_ambiguous_periods_are_left_without_years(self) -> None:
        for text in (
            "è autorizzata la spesa di 40 milioni di euro dal 2027 al 2031. Il",
            "con una dotazione di 30 milioni di euro annui. 3. Il fondo",
            "con una dotazione di 2.500 milioni di euro per gli anni 2027, 2028 e 2029 finalizzato",
            "è autorizzata la spesa di 10 milioni di euro per il triennio 2027-2029.",
            "con una dotazione di 15 milioni di euro per il medesimo anno. 2.",
        ):
            with self.subTest(text=text):
                self.assertIsNone(self.by_year(text))

    def test_evidence_keeps_the_start_of_the_sentence(self) -> None:
        self.assertTrue(etl.parse_spending("È autorizzata la spesa di 5 milioni di euro per l'anno 2027.")["evidence"].startswith("È autorizzata"))

    def test_decimals_are_exact(self) -> None:
        self.assertEqual(etl.money_cents("1,35", "milioni"), 135_000_000)
        self.assertEqual(etl.money_cents("652.379", None), 65_237_900)
        self.assertEqual(etl.money_cents("2,5", "miliardi"), 250_000_000_000)

    def test_coverage_clause_alone_is_not_spending(self) -> None:
        self.assertIsNone(etl.parse_spending("Agli oneri, pari a 10 milioni di euro per l'anno 2027, si provvede mediante riduzione del fondo."))
        self.assertIsNone(etl.parse_spending(page("2.4")["text"]))


class MunicipalityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = etl.load_municipalities()

    def names(self, text: str) -> list[str]:
        found = etl.parse_municipalities(text, self.index)
        return [] if found is None else [item["name"] for item in found["municipalities"]]

    def test_every_named_municipality_is_kept_with_the_first_evidence(self) -> None:
        # The Collodi amendment names Pescia and, further on, Capannori: it is not a single-Comune one.
        found = etl.parse_municipalities(page("89.010")["text"], self.index)
        self.assertEqual([item["istatCode"] for item in found["municipalities"]], ["046007", "047012"])
        self.assertEqual({item["regionCode"] for item in found["municipalities"]}, {"09"})
        self.assertIn("comune di Pescia", found["evidence"])

    def test_single_municipality(self) -> None:
        found = etl.parse_municipalities("Al comune di Pescia è assegnato un contributo. Il comune di Pescia rendiconta.", self.index)
        self.assertEqual([item["istatCode"] for item in found["municipalities"]], ["047012"])

    def test_lists_and_multiword_names(self) -> None:
        self.assertEqual(
            sorted(self.names("contributi ai comuni di Reggio Calabria, San Giovanni in Fiore e Vibo Valentia per l'anno 2027")),
            ["Reggio di Calabria", "San Giovanni in Fiore", "Vibo Valentia"],
        )

    def test_article_forms_are_limited_to_known_names(self) -> None:
        self.assertEqual(self.names("al Comune dell'Aquila è assegnato un contributo"), ["L'Aquila"])
        self.assertEqual(self.names("i comuni della Valle d'Aosta e i comuni della Sardegna"), [])

    def test_generic_mentions_are_not_municipalities(self) -> None:
        self.assertEqual(self.names("i comuni di montagna e i comuni di cui al comma 1"), [])
        self.assertEqual(self.names("la città metropolitana di Milano"), [])

    def test_homonyms_stay_ambiguous(self) -> None:
        found = etl.parse_municipalities("al comune di Castro è assegnato un contributo", self.index)
        self.assertEqual(found["municipalities"], [])
        self.assertEqual(found["ambiguousNames"], ["Castro"])


class CoverageTests(unittest.TestCase):
    def test_named_funds_are_read_only_in_coverage_clauses(self) -> None:
        fispe = "Agli oneri derivanti dal presente articolo, pari a 5 milioni di euro, si provvede mediante corrispondente riduzione del Fondo per interventi strutturali di politica economica, di cui all'articolo 10, comma 5, del decreto-legge 29 novembre 2004, n. 282."
        self.assertEqual(etl.parse_coverage(fispe), ["fispe"])
        indifferibili = "Agli oneri si provvede mediante corrispondente riduzione del fondo di cui all'articolo 1, comma 200, della legge 23 dicembre 2014, n. 190."
        self.assertEqual(etl.parse_coverage(indifferibili), ["esigenze_indifferibili"])
        self.assertEqual(etl.parse_coverage(fispe + " " + indifferibili), ["fispe", "esigenze_indifferibili"])

    def test_other_coverage_and_no_coverage_stay_distinct(self) -> None:
        self.assertEqual(etl.parse_coverage("Agli oneri si provvede mediante le maggiori entrate di cui al comma 3."), [])
        self.assertIsNone(etl.parse_coverage("Il Fondo per interventi strutturali di politica economica è incrementato di 5 milioni di euro."))
        self.assertIsNone(etl.parse_coverage(page("2.4")["text"]) if "si provvede" not in page("2.4")["text"] else None)

    def test_real_pages(self) -> None:
        self.assertIsNotNone(etl.parse_coverage(page("89.010")["text"]))


class ReconciliationTests(unittest.TestCase):
    def test_expected_page_outcome_follows_the_list(self) -> None:
        rows = etl.parse_list((FIXTURES / "lista-prime-40.html").read_text(encoding="utf-8"))
        inadmissible = next(row for row in rows if row["outcome"] == "inammissibile")
        self.assertTrue(etl.expected_page_outcome(inadmissible).startswith("inammissibile (inammissibile per "))
        self.assertEqual(etl.expected_page_outcome(rows[0] | {"outcome": "ammissibile"}), "")

    def test_constituency_region(self) -> None:
        self.assertEqual(etl.constituency_region("Sicilia 1"), "19")
        self.assertEqual(etl.constituency_region("Emilia-Romagna"), "08")
        self.assertIsNone(etl.constituency_region("Europa"))
        self.assertIsNone(etl.constituency_region(None))


if __name__ == "__main__":
    unittest.main()

import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { clusterPublisherSources, coveragePreview, coverageWithoutPeriod, groupSourcesByPublisher, plainRangeLabel, sharedCadence, publisherAnchor, sourcePublisher, subtitleRepeatsTitle } from "../src/lib/source-publishers.ts";

// Dynamic: sources.ts uses the @/ alias, registered by the helper above.
const { publicSources } = await import("../src/lib/sources.ts");

test("publisher variants collapse to one short name, keeping a real department as detail", () => {
  assert.deepEqual(sourcePublisher("ISTAT — Istituto nazionale di statistica"), { name: "ISTAT", detail: null });
  assert.deepEqual(sourcePublisher("Istituto Nazionale di Statistica (ISTAT)"), { name: "ISTAT", detail: null });
  assert.deepEqual(sourcePublisher("Istituto Nazionale della Previdenza Sociale"), { name: "INPS", detail: null });
  assert.deepEqual(sourcePublisher("Eurostat (Commissione europea)"), { name: "Eurostat", detail: null });
  assert.deepEqual(sourcePublisher("AIFA — Agenzia Italiana del Farmaco"), { name: "AIFA", detail: null });
  assert.deepEqual(sourcePublisher("MEF – Dipartimento delle Finanze"), { name: "MEF", detail: "Dipartimento delle Finanze" });
  assert.deepEqual(sourcePublisher("MEF · Dipartimento dell'Economia"), { name: "MEF", detail: "Dipartimento dell'Economia" });
  assert.deepEqual(sourcePublisher("Commissione europea, DG TAXUD"), { name: "Commissione europea", detail: "DG TAXUD" });
  assert.deepEqual(sourcePublisher("Presidenza del Consiglio dei Ministri · Italia Domani"), { name: "Presidenza del Consiglio dei ministri", detail: "Italia Domani" });
  // A joint publisher is not a department of the first one.
  assert.deepEqual(sourcePublisher("RGS · Banca d'Italia"), { name: "RGS · Banca d'Italia", detail: null });
  assert.deepEqual(sourcePublisher("Senato della Repubblica"), { name: "Senato della Repubblica", detail: null });
});

test("groups keep every source exactly once, largest publishers first", () => {
  const groups = groupSourcesByPublisher(publicSources);
  const slugs = groups.flatMap((group) => group.sources.map((entry) => entry.source.slug));
  assert.deepEqual([...slugs].sort(), publicSources.map((source) => source.slug).sort());
  for (let index = 1; index < groups.length; index += 1) {
    assert.ok(groups[index - 1].sources.length >= groups[index].sources.length);
  }
  const istat = groups.find((group) => group.name === "ISTAT");
  assert.ok(istat && istat.sources.length >= 10, "ISTAT spellings form one group");
  assert.equal(new Set(groups.map((group) => group.name)).size, groups.length);
});

test("a source name drops the publisher prefix already shown by its group heading", () => {
  const groups = groupSourcesByPublisher([
    { slug: "a", name: "ISTAT · povertà assoluta", owner: "ISTAT — Istituto nazionale di statistica" },
    { slug: "b", name: "ISTAT SITUAS", owner: "Istituto nazionale di statistica" },
    { slug: "c", name: "OpenBDAP", owner: "Ragioneria Generale dello Stato" },
    { slug: "d", name: "Eurostat · gov_10a_main", owner: "Eurostat" },
  ]);
  const titles = Object.fromEntries(groups.flatMap((group) => group.sources.map((entry) => [entry.source.slug, entry.title])));
  assert.deepEqual(titles, { a: "Povertà assoluta", b: "ISTAT SITUAS", c: "OpenBDAP", d: "gov_10a_main" });
});

test("a subtitle that paraphrases the title is recognised, a distinct one is kept", () => {
  // Regression: /fonti showed "Consumi finali della PA per funzione" over
  // "Consumi finali delle Amministrazioni pubbliche per funzione".
  assert.equal(subtitleRepeatsTitle("Consumi finali della PA per funzione (COFOG)", "Consumi finali delle Amministrazioni pubbliche per funzione"), true);
  assert.equal(subtitleRepeatsTitle("Spesa pubblica per funzione (COFOG)", "Spesa delle Amministrazioni pubbliche per funzione"), true);
  assert.equal(subtitleRepeatsTitle("Debito pubblico", "Debito lordo della Pubblica amministrazione"), false);
  assert.equal(subtitleRepeatsTitle("Povertà assoluta", "Condizioni economiche delle famiglie"), false);
  assert.equal(subtitleRepeatsTitle("Spesa sanitaria SHA", "Spesa sanitaria per schema di finanziamento (SHA)"), false);
  assert.equal(subtitleRepeatsTitle("Senato", ""), false);
});

test("sources sharing a theme are grouped once, with only their distinguishing label", () => {
  // Regression: "Benessere equo e sostenibile dei territori" was repeated on
  // twelve consecutive rows under ISTAT.
  const entry = (slug, title, area) => ({ source: { slug, name: title, owner: "ISTAT", area }, title, detail: null });
  const bes = "Benessere equo e sostenibile dei territori";
  const items = clusterPublisherSources([
    entry("cofog", "Consumi finali della PA", "Conti"),
    entry("bes-a", "BES dei territori, benessere economico", bes),
    entry("bes-b", "BES dei territori, Salute", bes),
    entry("sit", "ISTAT SITUAS", "Territori"),
    entry("bes-c", "BES dei territori, Istruzione", bes),
    entry("pair-a", "Povertà assoluta", "Famiglie"),
    entry("pair-b", "Povertà relativa", "Famiglie"),
  ]);
  // Regression: "ISTAT SITUAS" and the other plain rows after the BES
  // sub-group read as part of it. Rows without a sub-group come first, in
  // registry order; sub-groups close the publisher.
  assert.deepEqual(items.map((item) => item.kind === "cluster" ? `cluster:${item.label}` : item.entry.source.slug), [
    "cofog", "sit", "pair-a", "pair-b", `cluster:${bes}`,
  ]);
  const cluster = items.at(-1);
  assert.deepEqual(cluster.entries.map((item) => item.title), ["Benessere economico", "Salute", "Istruzione"]);
  // Every source is still listed exactly once.
  const slugs = items.flatMap((item) => item.kind === "cluster" ? item.entries.map((e) => e.source.slug) : [item.entry.source.slug]);
  assert.equal(slugs.length, 7);
  assert.equal(new Set(slugs).size, 7);
});

test("publisher anchors are stable, unique fragment ids", () => {
  assert.equal(publisherAnchor("RGS · Banca d'Italia"), "editore-rgs-banca-d-italia");
  assert.equal(publisherAnchor("Presidenza del Consiglio dei ministri"), "editore-presidenza-del-consiglio-dei-ministri");
  const groups = groupSourcesByPublisher(publicSources);
  const anchors = groups.map((group) => publisherAnchor(group.name));
  assert.equal(new Set(anchors).size, anchors.length);
});

test("period labels show year ranges with a plain hyphen, as the rest of the site", () => {
  assert.equal(plainRangeLabel("2004\u20132024; periodo distinto per indicatore"), "2004-2024; periodo distinto per indicatore");
  assert.equal(plainRangeLabel("incassi 2026 gennaio\u2013settembre"), "incassi 2026 gennaio-settembre");
  assert.equal(plainRangeLabel("2014-2024"), "2014-2024");
  assert.equal(plainRangeLabel("2005\u20132024 per territorio \u2013 dati ISTAT"), "2005-2024 per territorio \u2013 dati ISTAT");
});

// /fonti showed the same years twice per row: in "Cosa contiene" and in
// "Periodo coperto". The registry text (also served to MCP) is unchanged;
// only the page drops the clause the period column already states.
test("a year range already shown as the covered period is dropped from the description", () => {
  assert.equal(coverageWithoutPeriod("Italia, tutte le et\u00e0 e i due sessi insieme, tasso e persone in migliaia, 2015\u20132025", "2015-2025"), "Italia, tutte le et\u00e0 e i due sessi insieme, tasso e persone in migliaia");
  assert.equal(coverageWithoutPeriod("Italia e ripartizioni, 2014\u20132024; incidenza e intensit\u00e0", "2014-2024"), "Italia e ripartizioni; incidenza e intensit\u00e0");
  assert.equal(coverageWithoutPeriod("UE27, area euro e 30 Stati, 2014\u20132024: totale e dieci funzioni", "2014-2024"), "UE27, area euro e 30 Stati: totale e dieci funzioni");
  // A different period, or a range that is not its own clause, stays.
  assert.equal(coverageWithoutPeriod("Italia e ripartizioni, 2014\u20132024; incidenza", "2015-2025"), "Italia e ripartizioni, 2014-2024; incidenza");
  assert.equal(coverageWithoutPeriod("Comuni italiani 2022\u20132026: superficie", "2022-2026"), "Comuni italiani 2022-2026: superficie");
  assert.equal(coverageWithoutPeriod("Italia, anni di imposta 2016\u20132024 (dichiarazioni 2017\u20132025)", "2016-2024 (anni di imposta)"), "Italia, anni di imposta 2016-2024 (dichiarazioni 2017-2025)");
  assert.equal(coverageWithoutPeriod("Italia, 2014\u20132024", null), "Italia, 2014-2024");
  // The description is never emptied.
  assert.equal(coverageWithoutPeriod("2014\u20132024", "2014-2024"), "2014-2024");
});

test("a cadence shared by every source of a theme is stated once", () => {
  const entry = (cadence) => ({ source: { cadence } });
  assert.equal(sharedCadence([entry("Annuale; usiamo l\u2019edizione 2025"), entry("Annuale; usiamo l\u2019edizione 2025"), entry("Annuale; usiamo l\u2019edizione 2025")]), "Annuale; usiamo l\u2019edizione 2025");
  assert.equal(sharedCadence([entry("Annuale"), entry("Annuale"), entry("Mensile")]), null);
  assert.equal(sharedCadence([entry("Annuale")]), null);
  assert.equal(sharedCadence([]), null);
  // The real BES theme on /fonti shares one cadence.
  const istat = groupSourcesByPublisher(publicSources).find((group) => group.name === "ISTAT");
  const bes = clusterPublisherSources(istat.sources).find((item) => item.kind === "cluster" && /Benessere/.test(item.label));
  assert.ok(bes && sharedCadence(bes.entries), "BES rows share their cadence");
});

// Regression: on phones the CSS clamp ended long descriptions with ".…" and
// sometimes hid only three words behind "Mostra tutto".
test("a long description is previewed at a word boundary without dangling punctuation", () => {
  const long = "Italia e ripartizioni, incidenza e intensità della povertà assoluta per famiglie e individui. Con dettaglio per tipologia familiare, cittadinanza e titolo di studio della persona di riferimento.";
  const preview = coveragePreview(long, 90);
  assert.ok(preview);
  assert.ok(preview.endsWith("…"));
  assert.doesNotMatch(preview, /[\s.,;:·(-]…$/u);
  assert.ok(long.startsWith(preview.slice(0, -1)), "the preview is the start of the text");
  assert.ok(preview.length <= 91);
  // Cut exactly after a sentence: the full stop is dropped before the ellipsis.
  assert.equal(coveragePreview("Prima frase completa. " + "x".repeat(60), 22), "Prima frase completa…");
});

test("a description is not clamped when the hidden remainder is short", () => {
  assert.equal(coveragePreview("Breve descrizione.", 120), null);
  // 25 characters past the limit: shown whole rather than behind a toggle.
  const nearly = "a".repeat(100) + " " + "parole finali ancora qui.";
  assert.equal(coveragePreview(nearly, 100), null);
  const clearly = "a".repeat(100) + " " + "b ".repeat(30);
  assert.equal(coveragePreview(clearly, 100), "a".repeat(100) + "…");
});

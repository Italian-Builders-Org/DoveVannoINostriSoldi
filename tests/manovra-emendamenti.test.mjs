import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  amendmentUrl,
  assertEmendamentiSnapshot,
  buildEmendamentiView,
  buildExplorerRows,
  buildMoneyMap,
  isExplorerQueryActive,
  parseExplorerQuery,
  queryAmendments,
  shortGroupLabel,
} = await import("../src/lib/manovra-emendamenti.ts");

const pescia = { istatCode: "047012", name: "Pescia", regionCode: "09", population: 19290 };
const capannori = { istatCode: "046007", name: "Capannori", regionCode: "09", population: 46644 };

function amendment(position, overrides = {}) {
  return {
    id: `2.${position}`,
    section: "Art. 2",
    position,
    additionalArticle: false,
    title: null,
    proponent: "100",
    signers: 2,
    signerGroups: ["gr4136"],
    coverage: null,
    outcome: "ammissibile",
    reason: null,
    partialNote: null,
    identicalTo: [],
    spending: null,
    territory: null,
    ...overrides,
  };
}

function payload(mutate = () => {}) {
  const amendments = [
    amendment(1, { signers: 1, coverage: ["fispe"], territory: { municipalities: [pescia], ambiguousNames: [], evidence: "nel comune di Pescia" } }),
    amendment(2, { proponent: "200", signerGroups: ["gr4132", "gr4136"], coverage: [], outcome: "inammissibile", reason: "estraneita_materia", territory: { municipalities: [pescia], ambiguousNames: [], evidence: "al comune di Pescia" } }),
    amendment(3, { coverage: ["fispe", "esigenze_indifferibili"], outcome: "parzialmente_inammissibile", partialNote: "inammissibile per estraneità di materia limitatamente al comma 2", identicalTo: ["2.4"] }),
    amendment(4, {
      section: "Art. 3",
      proponent: "governo",
      signers: 1,
      signerGroups: ["governo"],
      identicalTo: ["2.3"],
      spending: { kind: "spesa autorizzata", trienniumCents: 3_000_000_000, byYearCents: { 2027: 1_000_000_000, 2028: 1_000_000_000, 2029: 1_000_000_000 }, permanent: false, evidence: "è autorizzata la spesa di 10 milioni di euro per ciascuno degli anni 2027, 2028 e 2029" },
    }),
    amendment(5, { proponent: "300", signerGroups: [], title: "Contributo ai Comuni della Valdinievole", territory: { municipalities: [capannori, pescia], ambiguousNames: [], evidence: "ai comuni di Pescia e Capannori" }, spending: { kind: "contributo", trienniumCents: null, byYearCents: null, permanent: false, evidence: "è concesso un contributo di 2 milioni di euro" } }),
    amendment(6, { proponent: "300", signerGroups: [], territory: { municipalities: [], ambiguousNames: ["Castro"], evidence: "al comune di Castro" } }),
  ];
  const data = {
    schemaVersion: 1,
    datasetId: "camera-emendamenti-bilancio-2027",
    act: { number: "C. 3174-bis", title: "Bilancio 2027", committee: "V Commissione", stage: "sede referente", sittingDate: "2026-11-23", actUrl: "https://www.camera.it/leg19/126?leg=19&idDocumento=3174-bis" },
    source: {
      owner: "Camera dei deputati",
      landingUrl: "https://www.camera.it/leg19/126",
      listUrl: "https://documenti.camera.it/apps/emendamenti/lista",
      amendmentUrlTemplate: "https://documenti.camera.it/apps/emendamenti/get?id={id}.&position={published}",
      license: "Riuso con citazione della fonte",
      acquiredAt: "2026-11-25",
      pages: { count: amendments.length },
    },
    deputiesSource: { owner: "Camera dei deputati", landingUrl: "https://dati.camera.it/", license: "CC BY 4.0", acquiredAt: "2026-09-17" },
    municipalitiesSource: { owner: "Istat", landingUrl: "https://situas.istat.it/web/#/territorio", referenceDate: "2026-08-25" },
    totals: {
      amendments: 6,
      inadmissible: 1,
      partiallyInadmissible: 1,
      byReason: { carenza_compensazione: 0, inidoneita_compensazione: 0, carenza_e_inidoneita_compensazione: 0, estraneita_materia: 1 },
      withIdentical: 2,
      sections: 2,
      singleSigner: 2,
    },
    groups: [
      { id: "gr4136", label: "Gruppo A (componente lunga)", members: 4 },
      { id: "gr4132", label: "Gruppo B", members: 10 },
      { id: "governo", label: "Governo", members: null },
    ],
    proponents: [
      { key: "100", name: "Anna Rossi", groupId: "gr4136", constituency: "Toscana", regionCode: "09" },
      { key: "200", name: "Bruno Verdi", groupId: "gr4132", constituency: "Lombardia 1", regionCode: "03" },
      { key: "300", name: "Carla Neri", groupId: null, constituency: null, regionCode: null },
      { key: "governo", name: "Il Governo", groupId: "governo", constituency: null, regionCode: null },
    ],
    amendments,
  };
  mutate(data);
  return data;
}

test("il contratto accetta il payload coerente e ricalcola i totali dalle righe", () => {
  const snapshot = assertEmendamentiSnapshot(payload());
  assert.equal(snapshot.totals.amendments, 6);
  assert.equal(snapshot.source.pages, 6);
  assert.equal(amendmentUrl(snapshot, "Tab.A.9"), "https://documenti.camera.it/apps/emendamenti/get?id=Tab.A.9.&position=20261123");
});

test("il contratto rifiuta payload troncati, esiti incoerenti e riferimenti rotti", () => {
  const broken = [
    (data) => data.amendments.pop(),
    (data) => { data.totals.inadmissible = 2; },
    (data) => { data.amendments[0].outcome = "approvato"; },
    (data) => { data.amendments[1].reason = null; },
    (data) => { data.amendments[0].reason = "estraneita_materia"; },
    (data) => { data.amendments[2].partialNote = null; },
    (data) => { data.amendments[0].proponent = "999"; },
    (data) => { data.proponents[0].groupId = "gZ"; },
    (data) => { data.amendments[3].spending.trienniumCents = 1; },
    (data) => { data.amendments[4].spending.byYearCents = { 2027: 1, 2028: 0, 2029: 0 }; },
    (data) => { data.amendments[5].territory.ambiguousNames = []; },
    (data) => { data.amendments[0].territory.municipalities[0] = { ...pescia, regionCode: "99" }; },
    (data) => { data.amendments[1].id = "2.1"; },
    (data) => { data.amendments[1].position = 7; },
    (data) => { data.source.listUrl = "http://documenti.camera.it/"; },
    (data) => { data.schemaVersion = 2; },
    (data) => { delete data.municipalitiesSource; },
    (data) => { data.amendments[0].signerGroups = ["gZ"]; },
    (data) => { data.amendments[0].coverage = ["altro"]; },
    (data) => { data.amendments[2].identicalTo = ["9.9"]; },
    (data) => { delete data.amendments[0].coverage; },
  ];
  for (const [index, mutate] of broken.entries()) {
    assert.throws(() => assertEmendamentiSnapshot(payload(mutate)), /Snapshot emendamenti non valido/, `caso ${index}`);
  }
  assert.throws(() => assertEmendamentiSnapshot(null), /Snapshot emendamenti non valido/);
});

test("la vista tiene distinti ammissibili, inammissibili e in parte inammissibili", () => {
  const view = buildEmendamentiView(assertEmendamentiSnapshot(payload()));
  assert.equal(view.totals.admissible, 4);
  assert.equal(view.totals.inadmissible, 1);
  assert.equal(view.totals.partiallyInadmissible, 1);
  assert.equal(view.totals.admissible + view.totals.inadmissible + view.totals.partiallyInadmissible, view.totals.amendments);
});

test("i gruppi contano la prima firma e il rapporto per deputato; chi non ha gruppo resta fuori e contato", () => {
  const view = buildEmendamentiView(assertEmendamentiSnapshot(payload()));
  const byId = Object.fromEntries(view.groups.map((group) => [group.id, group]));
  assert.equal(byId.gr4136.amendments, 2);
  assert.equal(byId.gr4136.perMember, 0.5);
  assert.equal(byId.gr4136.label, "Gruppo A");
  assert.equal(byId.gr4132.inadmissible, 1);
  assert.equal(byId.gr4132.matter, 1);
  assert.equal(byId.gr4132.coverage, 0);
  assert.equal(byId.gr4136.partial, 1);
  for (const row of [...view.groups, ...view.sections]) {
    assert.equal(row.admissible + row.partial + row.coverage + row.matter, row.amendments, row.label ?? row.section);
  }
  assert.equal(byId.governo.perMember, null);
  assert.equal(view.totals.withoutGroup, 2);
  assert.equal(view.groups.reduce((sum, group) => sum + group.amendments, 0) + view.totals.withoutGroup, view.totals.amendments);
});

test("un solo Comune: esclusi i testi con più Comuni e gli omonimi; la regione di elezione è confrontata solo se nota", () => {
  const { municipalities } = buildEmendamentiView(assertEmendamentiSnapshot(payload()));
  assert.deepEqual(municipalities.rows.map((row) => row.id), ["2.1", "2.2"]);
  assert.deepEqual(municipalities.rows.map((row) => row.sameRegion), [true, false]);
  assert.deepEqual(municipalities.sameRegion, { yes: 1, no: 1, unknown: 0 });
  assert.equal(municipalities.amendmentsNamingAny, 3);
  assert.equal(municipalities.withAmbiguousOnly, 1);
  assert.equal(municipalities.distinctMunicipalities, 1);
  assert.deepEqual(municipalities.regions, [{ code: "09", name: "Toscana", amendments: 2, municipalities: 1 }]);
  assert.equal(municipalities.repeated[0].municipality.name, "Pescia");
  assert.equal(municipalities.repeated[0].amendments, 3);
});

test("la spesa dichiarata è contata per classi, mai sommata; senza anni resta fuori dalle classi", () => {
  const { spending } = buildEmendamentiView(assertEmendamentiSnapshot(payload()));
  assert.equal(spending.declared, 2);
  assert.equal(spending.withTriennium, 1);
  assert.equal(spending.withoutYears, 1);
  assert.deepEqual(spending.classes.map((item) => item.amendments), [0, 0, 1, 0, 0]);
  assert.equal(spending.largest[0].id, "2.4");
  assert.equal("total" in spending, false);
});

test("shortGroupLabel taglia solo la parentesi delle componenti", () => {
  assert.equal(shortGroupLabel("NOI MODERATI (NOI CON L'ITALIA)-MAIE"), "NOI MODERATI");
  assert.equal(shortGroupLabel("Lega - Salvini Premier"), "Lega - Salvini Premier");
});

test("maggioranza e opposizione sommano i gruppi del primo firmatario; il Governo resta a parte", () => {
  const view = buildEmendamentiView(assertEmendamentiSnapshot(payload()));
  const byKey = Object.fromEntries(view.coalitions.map((row) => [row.key, row]));
  assert.equal(byKey.opposizione.amendments, 2);
  assert.equal(byKey.opposizione.members, 4);
  assert.equal(byKey.maggioranza.amendments, 1);
  assert.equal(byKey.maggioranza.matter, 1);
  assert.equal(byKey.governo.perMember, null);
});

test("firme: fasce che sommano al totale e proposte condivise tra gruppi e tra schieramenti", () => {
  const { signatures, totals } = buildEmendamentiView(assertEmendamentiSnapshot(payload()));
  assert.equal(signatures.bands.reduce((sum, band) => sum + band.amendments, 0), totals.amendments);
  assert.deepEqual(signatures.bands.map((band) => band.amendments), [2, 4, 0, 0, 0]);
  assert.equal(signatures.multiGroup, 1);
  assert.equal(signatures.acrossCoalitions, 1);
  assert.deepEqual(signatures.widest.map((row) => row.id), ["2.2"]);
});

test("testi identici: un gruppo per ogni insieme di proposte collegate", () => {
  const { identical } = buildEmendamentiView(assertEmendamentiSnapshot(payload()));
  assert.equal(identical.clusters, 1);
  assert.equal(identical.amendments, 2);
  assert.equal(identical.crossGroup, 1);
  assert.deepEqual(identical.largest[0].ids, ["2.3", "2.4"]);
});

test("copertura: fondo citato, altra copertura e nessuna clausola restano distinti", () => {
  const { coverage, totals } = buildEmendamentiView(assertEmendamentiSnapshot(payload()));
  assert.deepEqual(Object.fromEntries(coverage.map((row) => [row.key, row.amendments])), { fispe: 1, esigenze_indifferibili: 0, both: 1, other: 1, none: 3 });
  assert.equal(coverage.reduce((sum, row) => sum + row.amendments, 0), totals.amendments);
});

test("elenco: ricerca senza accenti, filtri combinati e pagine entro i limiti", () => {
  const snapshot = assertEmendamentiSnapshot(payload());
  const rows = buildExplorerRows(snapshot);
  const groupIds = new Set(snapshot.groups.map((group) => group.id));
  const run = (params) => queryAmendments(rows, parseExplorerQuery(params, groupIds));
  assert.equal(run({}).total, 6);
  assert.deepEqual(run({ q: "PESCIA" }).rows.map((row) => row.id), ["2.1", "2.2", "2.5"]);
  assert.deepEqual(run({ q: "rossi pescia" }).rows.map((row) => row.id), ["2.1"]);
  assert.deepEqual(run({ gruppo: "gr4132" }).rows.map((row) => row.id), ["2.2"]);
  assert.deepEqual(run({ esito: "materia" }).rows.map((row) => row.id), ["2.2"]);
  assert.equal(run({ esito: "copertura" }).total, 0);
  assert.deepEqual(run({ comune: "1" }).rows.map((row) => row.id), ["2.1", "2.2", "2.5"]);
  assert.deepEqual(run({ q: "valdinievole" }).rows.map((row) => row.id), ["2.5"]);
  // Unknown or oversized input falls back instead of failing or widening the query.
  assert.equal(run({ gruppo: "x", esito: "approvato", pagina: "abc" }).total, 6);
  assert.equal(run({ pagina: "999" }).page, 1);
  assert.equal(parseExplorerQuery({ q: "a".repeat(500) }, groupIds).q.length, 80);
  assert.equal(parseExplorerQuery({ q: ["due", "valori"] }, groupIds).q, "due");
  assert.equal(isExplorerQueryActive(parseExplorerQuery({}, groupIds)), false);
  assert.equal(isExplorerQueryActive(parseExplorerQuery({ comune: "1" }, groupIds)), true);
  assert.equal(run({ q: "nessunrisultato" }).total, 0);
});

test("mappa dei soldi: solo un Comune con importo 2027-2029, copie identiche contate una volta, opzioni per schieramento e gruppo", () => {
  const spending = (cents) => ({ kind: "spesa autorizzata", trienniumCents: cents, byYearCents: { 2027: cents, 2028: 0, 2029: 0 }, permanent: false, evidence: "è autorizzata la spesa" });
  const snapshot = assertEmendamentiSnapshot(payload((data) => {
    data.amendments[0].spending = spending(3_000_000_000);
    data.amendments[1].spending = spending(1_000_000_000);
    // 2.5 names two Comuni: it stays out even with an amount.
    data.amendments[4].spending = spending(9_000_000_000);
    // A seventh proposal, identical to 2.1 and on the same Comune: not counted twice.
    data.amendments.push(amendment(7, { proponent: "200", signerGroups: ["gr4132"], identicalTo: ["2.1"], spending: spending(3_000_000_000), territory: { municipalities: [pescia], ambiguousNames: [], evidence: "al comune di Pescia" } }));
    data.amendments[0].identicalTo = ["2.7"];
    data.totals.amendments = 7;
    data.totals.withIdentical = 4;
    data.source.pages.count = 7;
  }));
  const map = buildMoneyMap(snapshot);
  assert.equal(map.amendments, 2);
  assert.equal(map.duplicatesSkipped, 1);
  // 2.1 and 2.2 name one Comune; 2.2 has no amount in the base payload, here it has one; 2.7 is the copy.
  assert.equal(map.withoutAmount, 0);
  const byKey = Object.fromEntries(map.options.map((option) => [option.key, option]));
  assert.deepEqual(Object.keys(byKey), ["tutte", "opposizione", "maggioranza", "gr4136", "gr4132"]);
  assert.equal(byKey.tutte.totalCents, 4_000_000_000);
  assert.deepEqual(byKey.tutte.regions, [{ code: "09", amendments: 2, cents: 4_000_000_000, inadmissible: 1 }]);
  assert.equal(byKey.opposizione.totalCents, 3_000_000_000);
  assert.equal(byKey.gr4132.regions[0].inadmissible, 1);
  for (const option of map.options) {
    assert.equal(option.regions.reduce((sum, region) => sum + region.cents, 0), option.totalCents, option.key);
    assert.equal(option.regions.reduce((sum, region) => sum + region.amendments, 0), option.amendments, option.key);
  }
});

test("mappa dei soldi: senza importi resta vuota ma conta le proposte escluse", () => {
  const map = buildMoneyMap(assertEmendamentiSnapshot(payload()));
  assert.equal(map.amendments, 0);
  assert.equal(map.withoutAmount, 2);
  assert.deepEqual(map.options.map((option) => option.key), ["tutte"]);
  assert.deepEqual(map.options[0].regions, []);
});

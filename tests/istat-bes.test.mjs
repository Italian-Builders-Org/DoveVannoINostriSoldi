import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { istatBesData, istatBesMetadata, queryIstatBes } = await import("../src/lib/istat-bes-snapshot.ts");
const { validateIstatBesBundle } = await import("../src/lib/data/istat-bes-contract.ts");

const cellMap = () =>
  new Map(
    istatBesData.observations.map((row) => [
      `${row.indicator}/${row.territory}/${row.sex}/${row.year}`,
      row.valueTenths,
    ]),
  );

test("lo snapshot dichiara copertura piena e la mantiene", () => {
  const { expectedCells, observedCells } = istatBesData.coverage;
  assert.equal(observedCells, expectedCells);
  assert.equal(istatBesData.observations.length, expectedCells);
  const cells = new Set(
    istatBesData.observations.map((r) => `${r.indicator}/${r.territory}/${r.sex}/${r.year}`),
  );
  assert.equal(cells.size, expectedCells, "celle duplicate");
});

test("la copertura è per indicatore, non un unico periodo", () => {
  const spans = new Map(istatBesData.indicators.map((i) => [i.code, [i.from, i.to]]));
  const distinct = new Set([...spans.values()].map((s) => s.join("-")));
  assert.ok(distinct.size > 1, "gli indicatori non condividono lo stesso periodo");
  for (const observation of istatBesData.observations) {
    const [from, to] = spans.get(observation.indicator);
    assert.ok(observation.year >= from && observation.year <= to, JSON.stringify(observation));
  }
  assert.ok(istatBesData.periodNote.length > 0);
});

test("il livello territoriale non segue la lunghezza del codice", () => {
  const kinds = new Map(istatBesData.territories.map((t) => [t.code, t.kind]));
  // ITCD ha la stessa lunghezza di ITC1 ma non è una regione.
  assert.equal("ITCD".length, "ITC1".length);
  assert.equal(kinds.get("ITCD"), "composite");
  assert.equal(kinds.get("ITC1"), "regione");
  assert.equal(kinds.get("ITFG"), "composite");
  assert.equal(kinds.get("IT"), "country");
  assert.equal(kinds.get("ITC"), "ripartizione");
  const counts = {};
  for (const kind of kinds.values()) counts[kind] = (counts[kind] ?? 0) + 1;
  assert.deepEqual(counts, { country: 1, ripartizione: 5, composite: 2, regione: 20, provincia: 111 });
});

test("i compositi dichiarano le loro parti", () => {
  const byCode = new Map(istatBesData.territories.map((t) => [t.code, t]));
  assert.deepEqual(byCode.get("ITCD").parts, ["ITC", "ITD"]);
  assert.deepEqual(byCode.get("ITFG").parts, ["ITF", "ITG"]);
});

test("la rottura della catena di parentela è dichiarata, non rattoppata", () => {
  const orphans = istatBesData.territories.filter((t) => t.parentOutsideDataset);
  assert.deepEqual(orphans.map((t) => t.code).sort(), ["ITD10", "ITD20"]);
  const codes = new Set(istatBesData.territories.map((t) => t.code));
  for (const orphan of orphans) {
    assert.equal(orphan.parent, null);
    assert.ok(!codes.has(orphan.parentOutsideDataset), orphan.code);
  }
});

test("il totale sta fra i due sessi: è l'invariante delle medie", () => {
  const cells = cellMap();
  let compared = 0;
  for (const observation of istatBesData.observations) {
    if (observation.sex !== "T" || observation.valueTenths === null) continue;
    const base = `${observation.indicator}/${observation.territory}`;
    const female = cells.get(`${base}/F/${observation.year}`);
    const male = cells.get(`${base}/M/${observation.year}`);
    if (female === undefined || female === null || male === undefined || male === null) continue;
    compared += 1;
    assert.ok(
      observation.valueTenths >= Math.min(female, male) && observation.valueTenths <= Math.max(female, male),
      `${base}/${observation.year}`,
    );
  }
  assert.equal(compared, istatBesData.reconciliation.comparisons);
  assert.ok(compared > 5000);
});

test("la somma territoriale non è una riconciliazione valida", () => {
  assert.equal(istatBesData.reconciliation.territorialSum, false);
  for (const indicator of istatBesData.indicators) {
    assert.equal(indicator.summableAcrossTerritories, false, indicator.code);
  }
});

test("il contratto rifiuta un indicatore dichiarato sommabile", () => {
  const broken = structuredClone(istatBesData);
  broken.indicators[0].summableAcrossTerritories = true;
  assert.throws(() => validateIstatBesBundle(broken, istatBesMetadata));
});

test("il contratto rifiuta un anno fuori dal periodo del suo indicatore", () => {
  const broken = structuredClone(istatBesData);
  const short = broken.indicators.find((i) => i.from > broken.period.from);
  const target = broken.observations.find((o) => o.indicator === short.code);
  target.year = broken.period.from;
  assert.throws(() => validateIstatBesBundle(broken, istatBesMetadata), /periodo dichiarato/);
});

test("il contratto rifiuta un composito senza le sue parti", () => {
  const broken = structuredClone(istatBesData);
  delete broken.territories.find((t) => t.code === "ITCD").parts;
  assert.throws(() => validateIstatBesBundle(broken, istatBesMetadata));
});

test("il contratto rifiuta un orfano che dichiara anche un padre interno", () => {
  const broken = structuredClone(istatBesData);
  broken.territories.find((t) => t.code === "ITD10").parent = "ITD";
  assert.throws(() => validateIstatBesBundle(broken, istatBesMetadata));
});

test("il flag dichiara CL_FLAG e le celle flaggate restano null", () => {
  assert.equal(istatBesData.flags.codelist, "CL_FLAG");
  const nulls = istatBesData.observations.filter((r) => r.valueTenths === null).length;
  assert.equal(nulls, istatBesData.flags.flaggedCells);
  assert.ok(nulls > 0, "il dataset contiene celle flaggate da onorare");
});

test("la query filtra per territorio, anno, indicatore e sesso", () => {
  const province = queryIstatBes({ territory: "ITC11" });
  assert.ok(province.observations.every((r) => r.territory === "ITC11"));
  assert.ok(province.observations.length > 0);
  const indicator = queryIstatBes({ indicator: "04BEC002P" });
  assert.ok(indicator.observations.every((r) => r.indicator === "04BEC002P"));
  const female = queryIstatBes({ sex: "F", indicator: "04BEC002P" });
  assert.ok(female.observations.every((r) => r.sex === "F"));
  assert.ok(female.observations.length < indicator.observations.length);
});

test("la query rifiuta codici e anni fuori perimetro", () => {
  assert.throws(() => queryIstatBes({ year: 2003 }), /periodo coperto/);
  assert.throws(() => queryIstatBes({ year: 2025 }), /periodo coperto/);
  assert.throws(() => queryIstatBes({ territory: "ITZZZ" }), /Territorio non riconosciuto/);
  assert.throws(() => queryIstatBes({ indicator: "04BEC999P" }), /Indicatore non riconosciuto/);
  assert.throws(() => queryIstatBes({ sex: "X" }), /Sesso non riconosciuto/);
});

test("l'asse soldi è presente ma delimitato", () => {
  const soldi = istatBesMetadata.semantics.soldi;
  assert.match(soldi.unit, /euro/i);
  assert.match(soldi.nature, /non è spesa pubblica/i);
  assert.match(soldi.note, /non sono sommabili/i);
});

test("la fonte resta senza licenza dichiarata e l'edizione è fissata", () => {
  assert.equal(istatBesMetadata.source.licenseId, "not-declared");
  assert.equal(istatBesMetadata.semantics.provenance.publicationEdition, istatBesData.domain.edition);
  assert.equal(istatBesData.domain.code, "BES_04");
});

test("i caveat dicono i limiti che rendono leggibile il dato", () => {
  const joined = istatBesData.caveats.join(" ");
  assert.match(joined, /Non è spesa pubblica/);
  assert.match(joined, /NON sono sommabili fra territori/);
  assert.match(joined, /doppio conteggio/);
  assert.match(joined, /soppresse nel 2016/);
  assert.match(joined, /indice composito/);
});

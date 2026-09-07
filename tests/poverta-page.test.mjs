import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import "./helpers/register-ts-alias.mjs";

const { buildPovertaPageView } = await import("../src/lib/poverta-page.ts");
const { istatPovertaData } = await import("../src/lib/istat-poverta-snapshot.ts");
const { istatPovertaRelativaData } = await import("../src/lib/istat-poverta-relativa-snapshot.ts");

const view = buildPovertaPageView();
const page = await readFile(new URL("../src/app/poverta/page.tsx", import.meta.url), "utf8");

test("la vista tiene le due famiglie separate", () => {
  assert.equal(view.families.length, 2);
  const [assoluta, relativa] = view.families;
  assert.equal(assoluta.key, "assoluta");
  assert.equal(relativa.key, "relativa");
  assert.equal(assoluta.datasetId, "istat-poverta-assoluta");
  assert.equal(relativa.datasetId, "istat-poverta-relativa");
  // Ogni famiglia porta la propria definizione: è ciò che impedisce di leggerle
  // come due misure della stessa cosa.
  assert.notEqual(assoluta.definition, relativa.definition);
  assert.match(assoluta.definition, /paniere/i);
  assert.match(relativa.definition, /spesa media/i);
});

test("la vista non produce mai un totale né una differenza fra le due", () => {
  const serialized = JSON.stringify(view);
  for (const forbidden of ["totale", "differenza", "somma"]) {
    assert.ok(!serialized.toLowerCase().includes(`"${forbidden}`), forbidden);
  }
  // Nessun campo aggrega le due famiglie: si arriva solo per famiglia.
  assert.deepEqual(Object.keys(view).sort(), ["excludedComposites", "families", "latestYear"]);
});

test("i compositi restano fuori dalle tabelle per non contare due volte", () => {
  for (const family of view.families) {
    const codes = family.areas.map((area) => area.code);
    assert.ok(!codes.includes("ITCD"), "Nord non deve stare accanto alle sue parti");
    assert.ok(!codes.includes("ITFG"), "Mezzogiorno non deve stare accanto alle sue parti");
    assert.ok(!codes.includes("IT"), "l'Italia non è una ripartizione");
    assert.equal(codes.length, 5);
  }
  assert.deepEqual(view.excludedComposites.map((area) => area.code).sort(), ["ITCD", "ITFG"]);
  // E la pagina lo spiega, invece di lasciare un buco silenzioso.
  assert.match(page, /Perché Nord e Mezzogiorno non sono in tabella/);
});

test("le ripartizioni sono in ordine geografico, non per valore", () => {
  for (const family of view.families) {
    const values = family.areas.map((area) => area.households);
    const descending = [...values].sort((a, b) => (b ?? 0) - (a ?? 0));
    const ascending = [...values].sort((a, b) => (a ?? 0) - (b ?? 0));
    assert.notDeepEqual(values, descending, "ordinare per valore sarebbe una classifica");
    assert.notDeepEqual(values, ascending, "ordinare per valore sarebbe una classifica");
    // L'ordine è quello dell'anagrafica della fonte.
    assert.deepEqual(family.areas.map((a) => a.code), ["ITC", "ITD", "ITE", "ITF", "ITG"]);
  }
});

test("la serie copre tutto il periodo dichiarato dallo snapshot", () => {
  for (const [index, family] of view.families.entries()) {
    const data = index === 0 ? istatPovertaData : istatPovertaRelativaData;
    assert.equal(family.period.from, data.period.from);
    assert.equal(family.period.to, data.period.to);
    assert.equal(family.series.length, data.period.to - data.period.from + 1);
    assert.equal(family.series[0].year, data.period.from);
    assert.equal(family.series.at(-1).year, data.period.to);
    for (const point of family.series) {
      assert.ok(point.households !== null, `famiglie mancanti nel ${point.year}`);
      assert.ok(point.individuals !== null, `individui mancanti nel ${point.year}`);
    }
  }
});

test("i valori sono percentuali plausibili e coincidono con lo snapshot", () => {
  const [assoluta] = view.families;
  const latest = assoluta.series.at(-1);
  const fromSnapshot = istatPovertaData.observations.find(
    (row) => row.measure === "INCID_POVASS_FAM" && row.territory === "IT" && row.year === latest.year,
  );
  assert.equal(latest.households, fromSnapshot.valueTenths / 10);
  for (const family of view.families) {
    for (const point of family.series) {
      assert.ok(point.households > 0 && point.households < 100, `${family.key} ${point.year}`);
    }
  }
});

test("la pagina dichiara i limiti che il dato impone", () => {
  assert.match(page, /Cosa non è questa pagina/);
  assert.match(page, /Non è spesa pubblica/);
  assert.match(page, /non si sommano e non si sottraggono/);
  assert.match(page, /Non c&apos;è una classifica/);
  assert.match(page, /comunale/);
});

test("la pagina non accosta la povertà alla spesa pubblica", () => {
  // L'unico riferimento a SIOPE o IRPEF deve essere quello che li ESCLUDE.
  const mentions = page.match(/SIOPE|OpenBDAP|IRPEF/g) ?? [];
  assert.equal(mentions.length, 3, "solo la riga che nega l'accostamento può citarli");
  assert.match(page, /Non vanno sommati né accostati a SIOPE/);
});

test("ogni tabella è accessibile e navigabile da tastiera", () => {
  // `FamilySection` è definito una volta e reso per ciascuna famiglia: nel
  // sorgente le tabelle sono due, a schermo diventano quattro.
  assert.equal((page.match(/className="table-scroll"/g) ?? []).length, 2);
  assert.equal((page.match(/role="region"/g) ?? []).length, 2);
  assert.equal((page.match(/tabIndex=\{0\}/g) ?? []).length, 2);
  assert.equal((page.match(/<caption/g) ?? []).length, 2);
  assert.equal(view.families.length, 2, "due famiglie rese dallo stesso componente");
  // Intestazioni di riga e colonna dichiarate.
  assert.ok((page.match(/scope="col"/g) ?? []).length >= 5);
  assert.ok((page.match(/scope="row"/g) ?? []).length >= 2);
});

test("la fonte e la licenza viaggiano con la pagina", () => {
  for (const family of view.families) {
    assert.equal(family.source.licenseId, "not-declared");
    assert.equal(family.source.dataflowId, "34_727_DF_DCCV_POVERTA_1");
    assert.match(family.source.landingUrl, /^https:\/\/esploradati\.istat\.it\//);
  }
  assert.match(page, /databrowser ISTAT/);
});

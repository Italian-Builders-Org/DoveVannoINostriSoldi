import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { validateIstatPovertaRegioniBundle } = await import("../src/lib/data/istat-poverta-regioni-contract.ts");

const load = (suffix) => JSON.parse(readFileSync(
  new URL(`../src/data/generated/istat-poverta-regioni-2014-2024.${suffix}.json`, import.meta.url),
  "utf8",
));
const bundle = () => [load("data"), load("meta")];

test("il contratto accetta il bundle vincolato e ne espone la copertura dichiarata", () => {
  const [data, metadata] = bundle();
  const { data: parsed } = validateIstatPovertaRegioniBundle(data, metadata);

  assert.equal(parsed.datasetId, "istat-poverta-regioni");
  assert.equal(parsed.territories.length, 30);
  assert.equal(parsed.measures.map((entry) => entry.key).join(","), "households,individuals");

  const totali = parsed.reconciliation.byMeasure;
  assert.equal(totali.households.published, 310);
  assert.equal(totali.households.undiffused, 19);
  assert.equal(totali.households.missing, 1);
  assert.equal(totali.individuals.published, 326);
  assert.equal(totali.individuals.undiffused, 3);
  assert.equal(totali.individuals.missing, 1);
  assert.equal(parsed.observations.length, 636);
  assert.equal(parsed.undiffused.length, 22);
  assert.equal(parsed.missingRows.length, 2);

  // La griglia torna misura per misura: nessuna cella sparisce senza essere dichiarata.
  for (const [chiave, attesi] of Object.entries(totali)) {
    const conta = (righe) => righe.filter((row) => row.measure === chiave).length;
    assert.equal(
      conta(parsed.observations) + conta(parsed.undiffused) + conta(parsed.missingRows),
      parsed.reconciliation.grid.cells,
      chiave,
    );
    assert.equal(conta(parsed.observations), attesi.published, chiave);
  }

  // Un'incidenza non e' un importo, e la fetta lo dichiara.
  assert.equal(parsed.scale.factor, 100);
  const lombardia2024 = parsed.observations.find((row) =>
    row.territory === "ITC4" && row.year === 2024 && row.measure === "households");
  assert.equal(lombardia2024.valueHundredths, 670);
});

test("le celle non diffuse restano dichiarate e non valgono zero", () => {
  const [data, metadata] = bundle();
  const { data: parsed } = validateIstatPovertaRegioniBundle(data, metadata);

  // Bolzano non ha alcun valore familiare in undici anni: dichiarato, non mostrato spezzato.
  const bolzanoFamiglie = parsed.observations.filter((row) =>
    row.territory === "ITD1" && row.measure === "households");
  assert.equal(bolzanoFamiglie.length, 0);
  assert.equal(
    parsed.undiffused.filter((row) => row.territory === "ITD1" && row.measure === "households").length,
    10,
  );
  assert.ok(parsed.undiffused.every((row) => row.flag === "0"));

  // Riga assente e cella non diffusa sono due assenze diverse e restano separate.
  assert.deepEqual(
    parsed.missingRows.map((row) => `${row.measure}/${row.territory}/${row.year}`).sort(),
    ["households/ITD1/2016", "individuals/ITD1/2016"],
  );
  const dichiarate = new Set([...parsed.undiffused, ...parsed.missingRows]
    .map((row) => `${row.measure}/${row.territory}/${row.year}`));
  for (const row of parsed.observations) {
    assert.ok(!dichiarate.has(`${row.measure}/${row.territory}/${row.year}`));
    assert.ok(row.valueHundredths > 0);
  }
});

test("l'invariante sul rapporto e' vincolata nel payload e nel lock", () => {
  const [data, metadata] = bundle();
  const { data: parsed } = validateIstatPovertaRegioniBundle(data, metadata);

  // CL_FLAG leggerebbe "0" come «meno della meta' della cifra minima»: sulle coppie valide
  // il rapporto individui/famiglie non esce da [0,903 ; 1,919], quindi quella lettura non regge.
  assert.deepEqual(parsed.ratioBounds, { pairs: 310, min: 9030, max: 19189 });
  const umbria2015 = parsed.observations.find((row) =>
    row.territory === "ITE2" && row.year === 2015 && row.measure === "individuals");
  assert.equal(umbria2015.valueHundredths, 1340);
  // Promuovere quella cella familiare a "quasi zero" richiederebbe un rapporto di 268.
  assert.ok(Math.floor((1340 * 10_000) / 4) > parsed.ratioBounds.max * 10);

  // Qui la difesa che scatta e' la lunghezza dichiarata degli elenchi: spostare una cella
  // dalle non diffuse ai valori cambia due conti su tre. L'invariante del rapporto morde
  // prima, in fase di costruzione, ed e' verificata in tests/etl/test_istat_poverta_regioni.py.
  const manomesso = structuredClone(data);
  manomesso.undiffused = manomesso.undiffused.filter((row) =>
    !(row.territory === "ITE2" && row.year === 2015 && row.measure === "households"));
  manomesso.observations.push({ territory: "ITE2", measure: "households", year: 2015, valueHundredths: 4 });
  assert.throws(() => validateIstatPovertaRegioniBundle(manomesso, metadata), /expected array to have exactly/);
});

test("il contratto rifiuta una manomissione coerente di un valore pubblicato", () => {
  const [data, metadata] = bundle();
  const manomesso = structuredClone(data);
  const indice = manomesso.observations.findIndex((row) =>
    row.territory === "ITC4" && row.year === 2024 && row.measure === "households");
  assert.ok(indice >= 0);
  manomesso.observations[indice].valueHundredths += 1;
  assert.throws(() => validateIstatPovertaRegioniBundle(manomesso, metadata), /hash o dimensione/);

  const metadatiAlterati = structuredClone(metadata);
  metadatiAlterati.acquiredAt = "2020-01-01";
  assert.throws(() => validateIstatPovertaRegioniBundle(data, metadatiAlterati), /metadati diversi/);
});

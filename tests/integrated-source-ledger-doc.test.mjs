import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), "utf8");
const catalog = JSON.parse(read("src/data/generated/integrated/catalog.json"));
const ledger = read("docs/INTEGRATED_SOURCE_LEDGER.md");

// Each data PR appends its own row to the per-dataset table; the closed
// contract at the top is easy to forget, so it is checked against the catalog.
// The ledger groups every thousand ("2.841"); it-IT leaves four digits ungrouped.
const italian = (value) => String(value).replace(/\B(?=(\d{3})+$)/g, ".");

function contractRow(label) {
  const row = ledger.split("\n").find((line) => line.startsWith(`| ${label} |`));
  assert.ok(row, `riga «${label}» assente dal contratto chiuso`);
  return row;
}

test("the closed contract of the ledger matches the published catalog totals", () => {
  const { totals, datasets } = catalog;
  const count = (publication) => datasets.filter((dataset) => dataset.publication === publication).length;
  const queryable = count("rows") + count("source-index");
  assert.equal(queryable + count("catalog-only") + count("derived-only"), totals.datasets);

  assert.equal(
    contractRow("Dataset correnti"),
    `| Dataset correnti | ${italian(totals.datasets)} | ${italian(queryable)} interrogabili + ` +
      `${italian(count("catalog-only"))} \`catalog-only\` + ${italian(count("derived-only"))} \`derived-only\` |`,
  );
  assert.equal(
    contractRow("Righe sorgente"),
    `| Righe sorgente | ${italian(totals.sourceRows)} | ${italian(totals.publicRows)} pubbliche + ` +
      `${italian(totals.catalogOnlyRows)} \`catalog-only\` + ${italian(totals.derivedOnlyRows)} \`derived-only\` |`,
  );
  assert.equal(
    contractRow("Byte delle sorgenti selezionate"),
    `| Byte delle sorgenti selezionate | ${italian(totals.sourceBytes)} | ` +
      `somma dei byte impegnati nelle ${italian(totals.datasets)} ricevute |`,
  );
  assert.match(ledger, new RegExp(`catalogo delle identità di fonte e ${totals.datasets} ricevute dataset\\.`));
  assert.match(ledger, new RegExp(`Le ${italian(totals.publicRows).replaceAll(".", "\\.")} righe della proiezione pubblica`));
});

test("the ledger lists every catalog dataset once, with the catalog values", () => {
  const listed = new Map();
  for (const line of ledger.split("\n")) {
    const match = /^\| `([^`]+)` \| (.*) \|$/.exec(line);
    if (!match) continue;
    assert.ok(!listed.has(match[1]), `${match[1]}: riga duplicata nel registro`);
    listed.set(match[1], match[2].split(" | "));
  }
  assert.deepEqual([...listed.keys()].sort(), catalog.datasets.map((dataset) => dataset.id).sort());
  for (const dataset of catalog.datasets) {
    assert.deepEqual(listed.get(dataset.id), [
      dataset.title,
      dataset.domain,
      italian(dataset.rows),
      italian(dataset.publicRows),
      italian(dataset.rowsWithPublicSource),
      dataset.publication,
      dataset.evidenceLabel,
      dataset.licenseStatus,
    ], `${dataset.id}: riga del registro divergente dal catalogo`);
  }
});

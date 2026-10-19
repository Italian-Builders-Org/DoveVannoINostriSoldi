import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parseDocumentiDeclassificatiSnapshot } = await import(
  "../src/lib/data/documenti-declassificati-contract.ts"
);
const snapshot = (
  await import("../src/data/generated/documenti-declassificati.json", { with: { type: "json" } })
).default;

function clone() {
  return structuredClone(snapshot);
}

test("the committed snapshot satisfies the contract", () => {
  const parsed = parseDocumentiDeclassificatiSnapshot(clone());
  assert.equal(parsed.dataset, "documenti-declassificati");
  assert.ok(parsed.documents.length >= 8);
  assert.ok(parsed.caveats.length > 0);
  assert.equal(parsed.coverage.documentsPublished, parsed.documents.length);
  assert.ok(parsed.semantics.soldi.length > 0);
  assert.ok(parsed.semantics.periodo.length > 0);
  assert.ok(parsed.semantics.provenance.length > 0);
});

test("every document declares soldi explicitly and keeps 3–7 key points", () => {
  const parsed = parseDocumentiDeclassificatiSnapshot(clone());
  for (const doc of parsed.documents) {
    assert.ok("soldi" in doc, `${doc.id} senza soldi esplicito`);
    assert.ok(doc.keyPoints.length >= 3 && doc.keyPoints.length <= 7);
    assert.ok(doc.sourceUrls.every((url) => url.startsWith("https://")));
  }
});

test("unofficial or non-HTTPS source hosts are refused", () => {
  const payload = clone();
  payload.documents[0].sourceUrls = ["https://example.com/not-official"];
  assert.throws(() => parseDocumentiDeclassificatiSnapshot(payload), /URL fonte|non ufficiale/u);
});

test("coverage.documentsPublished must match the published list", () => {
  const payload = clone();
  payload.coverage.documentsPublished = payload.documents.length + 1;
  assert.throws(() => parseDocumentiDeclassificatiSnapshot(payload), /documentsPublished/u);
});

test("duplicate document ids are refused", () => {
  const payload = clone();
  payload.documents.push(structuredClone(payload.documents[0]));
  payload.coverage.documentsPublished = payload.documents.length;
  assert.throws(() => parseDocumentiDeclassificatiSnapshot(payload), /duplicato/u);
});

test("unknown fields are refused instead of being carried through", () => {
  const payload = clone();
  payload.documents[0].giudizioEditoriale = "importante";
  assert.throws(() => parseDocumentiDeclassificatiSnapshot(payload));
});

test("fewer than three key points are refused", () => {
  const payload = clone();
  payload.documents[0].keyPoints = ["troppo corto", "ancora corto"];
  assert.throws(() => parseDocumentiDeclassificatiSnapshot(payload));
});

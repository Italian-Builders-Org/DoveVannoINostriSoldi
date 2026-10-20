import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const hub = await readFile(new URL("../src/app/documenti/page.tsx", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/app/documenti/[id]/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/app/documenti/documenti.module.css", import.meta.url), "utf8");
const adapter = await readFile(new URL("../src/lib/documenti-declassificati.ts", import.meta.url), "utf8");
const navigation = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../src/app/api/documenti/route.ts", import.meta.url), "utf8");

const { GET } = await import("../src/app/api/documenti/route.ts");

test("hub and detail pages go through the adapter, not the raw JSON", () => {
  assert.match(adapter, /parseDocumentiDeclassificatiSnapshot/);
  assert.match(adapter, /^import "server-only";/m);
  assert.doesNotMatch(hub, /@\/data\/generated\/documenti-declassificati\.json/u);
  assert.doesNotMatch(detail, /@\/data\/generated\/documenti-declassificati\.json/u);
  assert.match(hub, /getDocumentiDeclassificati|listDocumentiDeclassificati/u);
  assert.match(detail, /getDocumentoDeclassificato/u);
});

test("hub declares the declassify ≠ online caveat and filters", () => {
  assert.match(hub, /Declassificare non significa pubblicare online/u);
  assert.match(hub, /name="tema"/u);
  assert.match(hub, /name="ente"/u);
  assert.match(hub, /name="accesso"/u);
  assert.match(hub, /data-testid="documenti-hub"/u);
  assert.match(detail, /data-testid="documenti-detail"/u);
  assert.match(detail, /Leggi sulla fonte ufficiale/u);
});

test("public pages avoid developer semantics and raw enum codes", () => {
  assert.doesNotMatch(hub, /semantics\.(periodo|provenance)/u);
  assert.doesNotMatch(detail, /semantics\.(periodo|provenance)/u);
  assert.doesNotMatch(
    `${hub}\n${detail}`,
    /eventPeriod\*|declassifiedAt\/releasedAt|amountEuroCents centesimi|authority secondary:|"not-declared"/u,
  );
  assert.match(hub, /formatIsoDateIt\(doc\.verifiedAt\)/u);
  assert.match(hub, /formatIsoDateIt\(snapshot\.coverage\.checkedAt\)/u);
  assert.match(detail, /formatLicenseLabel\(snapshot\.source\.license\)/u);
  assert.match(detail, /formatProvenanceForReaders\(snapshot\.source\.authority\)/u);
  assert.match(detail, /PERIODO_READER_HELP/u);
});

test("navigation exposes Documenti under Istituzioni", () => {
  assert.match(navigation, /href: "\/documenti", label: "Documenti declassificati"/u);
  assert.match(navigation, /aliases: \[[^\]]*\/documenti/u);
});

test("detail CSS keeps a single reading composition without card clutter", () => {
  assert.match(css, /\.detail\s*\{/u);
  assert.match(css, /\.cta\s*\{/u);
  assert.doesNotMatch(css, /box-shadow|linear-gradient|rounded-full/u);
});

test("API lists curated documents with filters and nosniff", async () => {
  assert.match(api, /listDocumentiDeclassificati/u);
  const response = await GET(new Request("http://localhost/api/documenti"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.dataset, "documenti-declassificati");
  assert.ok(payload.documents.length >= 8);
  assert.ok(payload.caveats.length > 0);

  const filtered = await (
    await GET(new Request("http://localhost/api/documenti?ente=camera"))
  ).json();
  assert.ok(filtered.documents.every((doc) => doc.issuingBody === "camera"));
  assert.ok(filtered.documents.length > 0);
});

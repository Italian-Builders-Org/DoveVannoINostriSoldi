import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  EDITORIAL_SURFACE_PREVIEWS,
  EDITORIAL_TOPICS,
} from "../src/lib/integrated-editorial.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const catalog = JSON.parse(
  readFileSync(path.join(repositoryRoot, "src/data/generated/integrated/catalog.json"), "utf8"),
);
const catalogById = new Map(catalog.datasets.map((dataset) => [dataset.id, dataset]));

test("the editorial hierarchy reaches every curated dataset without changing its identity", () => {
  assert.equal(EDITORIAL_TOPICS.length, 21);
  const catalogIds = new Set(catalog.datasets.map((dataset) => dataset.id));
  const routes = EDITORIAL_TOPICS.map((topic) => `/${topic.section}/${topic.slug}`);
  assert.equal(new Set(routes).size, routes.length, "rotte editoriali duplicate");

  const represented = new Set();
  const representationCounts = new Map();
  const registerDataset = (dataset, owner) => {
    assert.ok(catalogIds.has(dataset.id), `${owner}: dataset sconosciuto ${dataset.id}`);
    const headers = new Set(catalogById.get(dataset.id).headers);
    for (const column of dataset.columns ?? []) {
      assert.equal(typeof column.key, "string", `${dataset.id}: chiave colonna non esplicita`);
      assert.ok(column.label.trim().length > 0, `${dataset.id}.${column.key}: etichetta assente`);
      assert.ok(
        headers.has(column.key),
        `${dataset.id}: colonna configurata sconosciuta ${column.key}`,
      );
    }
    represented.add(dataset.id);
    representationCounts.set(dataset.id, (representationCounts.get(dataset.id) ?? 0) + 1);
  };

  for (const topic of EDITORIAL_TOPICS) {
    assert.ok(topic.facts.length > 0, `${topic.slug}: fatti assenti`);
    assert.ok(topic.readingNotes.length > 0, `${topic.slug}: limiti assenti`);
    assert.ok(topic.datasets.length > 0, `${topic.slug}: dataset assenti`);
    assert.equal(
      new Set(topic.datasets.map((dataset) => dataset.id)).size,
      topic.datasets.length,
      `${topic.slug}: dataset duplicati`,
    );
    for (const dataset of topic.datasets) {
      registerDataset(dataset, topic.slug);
    }
  }

  for (const preview of EDITORIAL_SURFACE_PREVIEWS) {
    assert.ok(preview.datasets.length > 0, `${preview.surface}: dataset assenti`);
    assert.ok(preview.datasets.length <= 3, `${preview.surface}: preview oltre tre dataset`);
    assert.equal(
      new Set(preview.datasets.map((dataset) => dataset.id)).size,
      preview.datasets.length,
      `${preview.surface}: dataset duplicati`,
    );
    for (const dataset of preview.datasets) {
      registerDataset(dataset, preview.surface);
    }
  }

  assert.deepEqual([...represented].sort(), [...catalogIds].sort());
  for (const datasetId of catalogIds) {
    assert.equal(
      representationCounts.get(datasetId),
      1,
      `${datasetId}: deve comparire in un solo percorso editoriale canonico`,
    );
  }
});

test("every editorial section has a concise hub preview and a real topic route", () => {
  const previewStrategies = new Map([
    ["appalti", "IntegratedSectionPreview"],
    ["incarichi", "IntegratedSectionPreview"],
    ["spese", "IntegratedSectionPreview"],
    ["controlli", "IntegratedSectionPreview"],
    ["confronti", "IntegratedSectionPreview"],
    ["trasparenza", "IntegratedDomainHub"],
  ]);

  for (const [section, component] of previewStrategies) {
    const hubPath = path.join(repositoryRoot, "src", "app", section, "page.tsx");
    const topicRoutePath = path.join(repositoryRoot, "src", "app", section, "[topic]", "page.tsx");
    assert.ok(existsSync(hubPath), `${section}: hub assente`);
    assert.ok(existsSync(topicRoutePath), `${section}: route tematica assente`);
    const hubSource = readFileSync(hubPath, "utf8");
    assert.match(hubSource, new RegExp(component));
    assert.doesNotMatch(hubSource, /limit=\{(?:[4-9]|[1-9]\d+)\}/, `${section}: preview oltre tre righe`);
    assert.match(readFileSync(topicRoutePath, "utf8"), /EditorialTopicPage/);
  }

  const concisePreview = readFileSync(
    path.join(repositoryRoot, "src", "components", "integrated-section-preview.tsx"),
    "utf8",
  );
  assert.match(concisePreview, /limit = 3/);
  assert.match(concisePreview, /slice\(0, limit\)/);
});

test("every curated dataset drills down from its topic to a complete or explanatory detail", () => {
  const topicPage = readFileSync(
    path.join(repositoryRoot, "src", "components", "editorial-topic-page.tsx"),
    "utf8",
  );
  const detailPage = readFileSync(
    path.join(repositoryRoot, "src", "app", "dati", "[dataset]", "page.tsx"),
    "utf8",
  );

  assert.match(topicPage, /href={`\/dati\/\$\{result\.dataset\.id\}`}/);
  assert.match(topicPage, /Anteprima dei record/);
  assert.match(topicPage, /limit: 3/);
  assert.doesNotMatch(topicPage, /limit: 5/);
  assert.match(topicPage, /configured\.catalogBoundary/);
  assert.match(detailPage, /dataset\.queryable/);
  assert.match(detailPage, /materiale è contato nel catalogo senza righe pubbliche/);

  for (const dataset of catalog.datasets) {
    if (dataset.publication === "rows" || dataset.publication === "source-index") {
      assert.ok(dataset.publicRows > 0, `${dataset.id}: proiezione interrogabile senza righe`);
    } else {
      assert.equal(dataset.publicRows, 0, `${dataset.id}: stato non interrogabile con righe pubbliche`);
    }
  }
});

test("the participation page keeps the MEF census primary and previews three focused datasets", () => {
  const page = readFileSync(
    path.join(repositoryRoot, "src", "app", "partecipazioni", "page.tsx"),
    "utf8",
  );
  const previewComponent = readFileSync(
    path.join(repositoryRoot, "src", "components", "integrated-surface-preview.tsx"),
    "utf8",
  );
  const preview = EDITORIAL_SURFACE_PREVIEWS.find(
    (candidate) => candidate.surface === "/partecipazioni",
  );

  assert.ok(preview);
  assert.deepEqual(
    preview.datasets.map((dataset) => dataset.id),
    ["partecipate-statali-focus", "partecipate-statali-perimetro", "partecipate-at-focus"],
  );
  assert.match(page, /Partecipazioni dichiarate/);
  assert.match(page, /IntegratedSurfacePreview/);
  assert.match(previewComponent, /slice\(0, 3\)/);
  assert.match(previewComponent, /href={`\/dati\/\$\{dataset\.id\}`}/);
  assert.match(preview.description, /senza sostituirne il totale/i);
});

test("catalog-only datasets explain a structural boundary, never a licensing decision", () => {
  const mappings = new Map();
  for (const topic of EDITORIAL_TOPICS) {
    for (const dataset of topic.datasets) mappings.set(dataset.id, dataset);
  }
  for (const preview of EDITORIAL_SURFACE_PREVIEWS) {
    for (const dataset of preview.datasets) mappings.set(dataset.id, dataset);
  }

  for (const dataset of catalog.datasets) {
    if (dataset.publication !== "catalog-only") continue;
    const configured = mappings.get(dataset.id);
    assert.ok(configured?.catalogBoundary?.trim(), `${dataset.id}: blocco strutturale assente`);
    assert.doesNotMatch(
      configured.catalogBoundary,
      /licen[sz]|riuso|copyright/i,
      `${dataset.id}: il catalog-only non deve essere motivato dalla licenza`,
    );
  }
});

test("public editorial copy contains no package or workstation provenance", () => {
  const copy = JSON.stringify([EDITORIAL_TOPICS, EDITORIAL_SURFACE_PREVIEWS]);
  assert.doesNotMatch(copy, /\.tar\.gz|\/Users\/|\/private\/tmp\/|Downloads\//i);
});

test("signals remain questions unless a competent source has made a finding", () => {
  const allowedStatuses = new Set(["Fatto documentato", "Dato mancante", "Richiede una spiegazione"]);
  for (const topic of EDITORIAL_TOPICS) {
    assert.ok(allowedStatuses.has(topic.status), `${topic.slug}: stato probatorio non consentito`);
  }
});

test("the affitti claim matches the checked-in row projection", () => {
  const plain = Buffer.concat([0, 1].map((ordinal) => gunzipSync(readFileSync(
    path.join(
      repositoryRoot,
      `src/data/generated/integrated/rows/affitti-immobili.part-${String(ordinal).padStart(5, "0")}.jsonl.gz`,
    ),
  ))));
  const rows = plain
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const isPositive = (value) => Number.parseFloat(String(value ?? "").replace(",", ".")) > 0;
  const rowsWithCanoneAndMq = rows.filter(
    (row) => isPositive(row.cells.canone_annuo_eur) && isPositive(row.cells.mq),
  );
  assert.equal(rowsWithCanoneAndMq.length, 1);

  const topic = EDITORIAL_TOPICS.find((candidate) => candidate.slug === "affitti");
  assert.ok(topic);
  assert.ok(
    topic.facts.some((fact) => fact.value === "1" && /canone e superficie/i.test(fact.label)),
    "la pagina deve dichiarare l'unica riga con canone e superficie positivi",
  );
  assert.match(topic.hubSummary, /un solo record/i);
  assert.ok(
    topic.facts.some((fact) => /benchmark €\/m² generali/i.test(fact.label) && fact.value === "0"),
    "la pagina deve distinguere il singolo rapporto da un benchmark generale",
  );
});

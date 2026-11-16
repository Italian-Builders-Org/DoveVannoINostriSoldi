import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const { dedupeContextSources } = await import("../src/app/governi/_components/context-sources.ts");

test("dedupeContextSources removes only repeated URLs", () => {
  const sources = [
    { owner: "Banca centrale europea", type: "official", url: "https://www.ecb.europa.eu/stats/rates.html" },
    { owner: "Banca centrale europea", type: "official", url: "https://www.ecb.europa.eu/stats/rates.html" },
    { owner: "Banca centrale europea", type: "official", url: "https://www.ecb.europa.eu/press/release.pdf" },
  ];
  const deduped = dedupeContextSources(sources);
  assert.equal(deduped.length, 2);
  assert.deepEqual(
    deduped.map((source) => source.url),
  [...new Set(sources.map((source) => source.url))],
  );
});

test("dedupeContextSources keeps distinct official URLs with the same owner", () => {
  const sources = [
    { owner: "Eurostat", type: "official", url: "https://ec.europa.eu/eurostat/api/dataset/a" },
    { owner: "Eurostat", type: "official", url: "https://ec.europa.eu/eurostat/api/dataset/b" },
    { owner: "Camera dei deputati", type: "official", url: "https://temi.camera.it/leg19/one" },
    { owner: "Camera dei deputati", type: "official", url: "https://temi.camera.it/leg19/two/" },
  ];
  const deduped = dedupeContextSources(sources);
  assert.equal(deduped.length, 4);
  assert.ok(deduped.every((source) => sources.some((candidate) => candidate.url === source.url)));
});

test("dedupeContextSources normalizes trailing slashes on the same URL", () => {
  const sources = [
    { owner: "Camera dei deputati", type: "official", url: "https://temi.camera.it/leg19/path" },
    { owner: "Camera dei deputati", type: "official", url: "https://temi.camera.it/leg19/path/" },
  ];
  assert.equal(dedupeContextSources(sources).length, 1);
});
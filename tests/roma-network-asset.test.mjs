import "./helpers/register-ts-alias.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { ROMA_NETWORK_ASSET, ROMA_COVERAGE_ASSET } = await import(
  pathToFileURL(join(root, "src/lib/mobilita/roma-network-asset.ts")).href
);
const model = await import(pathToFileURL(join(root, "src/lib/mobilita/roma-live-model.ts")).href);

// The browser verifies size and SHA-256 before using the network: a
// regenerated asset with a stale manifest would leave the live map without
// routes, so the pair must stay in sync in the repository.
test("published Roma network matches its manifest byte for byte", () => {
  assert.match(ROMA_NETWORK_ASSET.path, /^\/mappe\/mobilita\/roma\/network-[0-9a-f]{12}\.json$/);
  const bytes = readFileSync(join(root, "public", ROMA_NETWORK_ASSET.path));
  assert.equal(bytes.byteLength, ROMA_NETWORK_ASSET.bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha, ROMA_NETWORK_ASSET.sha256);
  assert.ok(ROMA_NETWORK_ASSET.path.includes(sha.slice(0, 12)), "nome file non legato all'hash");
  assert.match(ROMA_NETWORK_ASSET.gtfs.sha256, /^[0-9a-f]{64}$/);
});

test("published Roma network builds with in-range indexes and real geometry", () => {
  const raw = JSON.parse(readFileSync(join(root, "public", ROMA_NETWORK_ASSET.path), "utf8"));
  assert.equal(raw.source.sha256, ROMA_NETWORK_ASSET.gtfs.sha256);
  const network = model.buildNetwork(raw);
  // buildNetwork silently skips broken patterns: none may be lost here.
  assert.equal(network.patterns.length, raw.patterns.length);
  assert.ok(network.routes.size > 300, "rete incompleta");
  for (const pattern of network.patterns) {
    assert.ok(pattern.coords.length >= 2, `pattern ${pattern.index} senza geometria`);
    for (const [lon, lat] of [pattern.coords[0], pattern.coords.at(-1)]) {
      assert.ok(lon > 11.9 && lon < 13.1 && lat > 41.4 && lat < 42.4, `pattern ${pattern.index} fuori area`);
    }
  }
});

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The browser loads the coverage index, then today's and yesterday's
// profiles, verifying each hash: every referenced file must exist and match.
test("coverage index and every profile match their hashes and the same GTFS", () => {
  const indexBytes = readFileSync(join(root, "public", ROMA_COVERAGE_ASSET.path));
  assert.equal(indexBytes.byteLength, ROMA_COVERAGE_ASSET.bytes);
  assert.equal(sha(indexBytes), ROMA_COVERAGE_ASSET.sha256);
  assert.equal(ROMA_COVERAGE_ASSET.gtfsSha256, ROMA_NETWORK_ASSET.gtfs.sha256);
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.equal(index.schema, 1);
  assert.equal(index.bins * index.binMinutes, 30 * 60, "le corse dopo mezzanotte devono restare nel giorno di servizio");
  const dates = Object.keys(index.dates).sort();
  assert.equal(dates[0], ROMA_COVERAGE_ASSET.firstDate);
  assert.equal(dates.at(-1), ROMA_COVERAGE_ASSET.lastDate);
  const network = model.buildNetwork(
    JSON.parse(readFileSync(join(root, "public", ROMA_NETWORK_ASSET.path), "utf8")),
  );
  for (const [date, entry] of Object.entries(index.dates)) {
    const bytes = readFileSync(join(root, "public", entry.path));
    assert.equal(bytes.byteLength, entry.bytes, date);
    assert.equal(sha(bytes), entry.sha256, date);
    const profile = JSON.parse(bytes.toString("utf8"));
    for (const [routeId, series] of Object.entries(profile)) {
      assert.ok(network.routes.has(routeId), `${date}: linea ${routeId} assente dalla rete`);
      assert.equal(series.length, index.bins, `${date}: serie ${routeId}`);
    }
  }
});

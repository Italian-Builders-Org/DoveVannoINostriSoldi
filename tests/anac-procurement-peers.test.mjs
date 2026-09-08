import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import "./helpers/register-ts-alias.mjs";

const peers = await import("../src/lib/data/anac-procurement-peers.ts");
const domain = await import("../src/lib/data/anac-entity-procurement-page.ts");
const r = (n, d = 1) => ({ numerator: String(n), denominator: String(d) });
function row(i, overrides = {}) {
  return { codiceIpa: `c_${i}`, istatCode: String(i).padStart(6, "0"), name: `Comune ${i}`,
    population: 1000, procedures: 100, awards: 100, stableAwards: 100,
    positiveAwards: 100, valueObservations: 100, awardValue: "100", attributedValue: "100", mix: { "45": 100 },
    count: { top1Share: r(1, 2), top10Share: r(1), hhi10000: r(5000) },
    value: { top1Share: r(1, 2), top10Share: r(1), hhi10000: r(5000) }, ...overrides };
}
const snapshot = await peers.loadAnacPeerSnapshot();

test("peer selection excludes the target and applies inclusive size, activity and CPV boundaries", () => {
  const target = row(1);
  const included = row(2, { population: 500, procedures: 200, mix: { "45": 160, "85": 40 } });
  // 69% CPV overlap stays below the 70% floor; 79% would pass after the v1.1 revision.
  const excluded = [row(3, { population: 499 }), row(4, { population: 2001 }), row(5, { procedures: 49, mix: { "45": 49 } }), row(6, { procedures: 201, mix: { "45": 201 } }), row(7, { mix: { "45": 69, "85": 31 } }), row(8, { istatCode: target.istatCode })];
  const result = peers.selectAnacPeers([included, ...excluded, target], target.codiceIpa, "count");
  assert.deepEqual(result.peers.map((p) => p.codiceIpa), [included.codiceIpa]);
  assert.deepEqual(peers.peerCpvOverlap(target, included), r(4, 5));
  assert.equal(peers.comparePeerRatios(peers.peerCpvOverlap(target, excluded[4]), peers.ANAC_PEER_CPV_MINIMUM), -1);
  assert.equal(result.publish, false);
  assert.equal(peers.selectAnacPeers([target], "absent", "count").target, null);
});

test("unknown CPV observations stay in the denominator; counts and value coverage are independent", () => {
  const partial = row(1, { mix: { "45": 90 }, stableAwards: 90 });
  assert.deepEqual(peers.peerCpvOverlap(partial, partial), r(9, 10));
  assert.deepEqual(peers.peerExclusions(partial, "count"), []);
  for (const overrides of [{ mix: { "45": 89 } }, { stableAwards: 89 }, { awards: 29 }, { count: null }, { population: null }]) assert.ok(peers.peerExclusions({ ...partial, ...overrides }, "count").length);
  const valuePartial = row(2, { valueObservations: 90, attributedValue: "90" });
  assert.deepEqual(peers.peerExclusions(valuePartial, "value"), []);
  for (const overrides of [{ valueObservations: 89 }, { attributedValue: "89.999999999999999999" }, { value: null }, { awardValue: "0", attributedValue: "0" }]) {
    assert.deepEqual(peers.peerExclusions({ ...valuePartial, ...overrides }, "count"), []);
    assert.ok(peers.peerExclusions({ ...valuePartial, ...overrides }, "value").length);
  }
});

test("medians and midrank percentiles exclude the target, preserve ties and require ten other municipalities", () => {
  const target = row(0), group = Array.from({ length: 10 }, (_, i) => row(i + 1, { count: { top1Share: r(i < 3 ? 1 : i < 7 ? 2 : 3, 4), top10Share: r(1), hhi10000: r(5000) } }));
  const result = peers.summarizeAnacPeers(target, group, "count", "top1Share");
  assert.deepEqual(result.median, r(1, 2));
  assert.deepEqual(result.percentile, r(1, 2));
  assert.equal(peers.selectAnacPeers([target, ...group], target.codiceIpa, "count").publish, true);
  assert.equal(peers.summarizeAnacPeers(target, group.slice(1), "count", "top1Share"), null);
  assert.equal(peers.summarizeAnacPeers(target, [target, ...group], "count", "top1Share"), null);
  assert.equal(peers.summarizeAnacPeers(target, [...group, group[0]], "count", "top1Share"), null);
  assert.equal(peers.summarizeAnacPeers(row(0, { population: null }), group, "count", "top1Share"), null);
  const allTied = group.map((p) => ({ ...p, count: target.count }));
  assert.deepEqual(peers.summarizeAnacPeers(target, allTied, "count", "hhi10000").percentile, r(1, 2));
});

test("exact rational ordering and the even median retain differences beyond floating-point precision", () => {
  const low = r("9007199254740992", "9007199254740994"), high = r("9007199254740993", "9007199254740994");
  assert.equal(peers.comparePeerRatios(low, high), -1);
  const group = Array.from({ length: 10 }, (_, i) => row(i + 1, { count: { top1Share: i < 5 ? low : high, top10Share: r(1), hhi10000: r(100) } }));
  const result = peers.summarizeAnacPeers(row(0, { count: { top1Share: high, top10Share: r(1), hhi10000: r(100) } }), group, "count", "top1Share");
  assert.deepEqual(result.median, r("18014398509481985", "18014398509481988"));
  assert.deepEqual(result.percentile, r(3, 4));
});

test("committed Veroli cohort reconciles every indicator with the original ANAC profiles", async () => {
  assert.equal(snapshot.municipalProfiles, 7850);
  assert.equal(snapshot.ambiguousProfilesExcluded, 0);
  const group = peers.selectAnacPeers(snapshot.rows, "c_l780", "count");
  assert.equal(group.eligibleCount, 3418);
  assert.equal(group.peers.length, 221);
  assert.equal(group.publish, true);
  assert.equal(peers.selectAnacPeers(snapshot.rows, "c_l780", "value").publish, false);
  // Spot-check the selected Comune and a stable peer against the live profile shard.
  for (const record of [group.target, group.peers.find((row) => row.codiceIpa === "c_h477") ?? group.peers[0]]) {
    const state = await domain.loadAnacEntityProcurementPage({ codiceIpa: record.codiceIpa, currentEntityCf: null, verifyLiveFiscalCode: false });
    assert.equal(state.status, "available");
    assert.equal(record.procedures, state.profile.summary.procedureCount);
    assert.equal(record.awards, state.profile.summary.awardCount);
    for (const dimension of ["count", "value"]) {
      const original = state.profile.concentration[dimension];
      if (original.status === "withheld") assert.equal(record[dimension], null);
      else for (const metric of ["top1Share", "top10Share", "hhi10000"]) assert.equal(peers.comparePeerRatios(record[dimension][metric], original[metric]), 0, `${record.codiceIpa}/${dimension}/${metric}`);
    }
  }
  assert.deepEqual(peers.summarizeAnacPeers(group.target, group.peers, "count", "hhi10000"), {
    value: r(30000, 169), median: r(2830000, 16641), percentile: r(126, 221),
  });
  const rodengo = peers.selectAnacPeers(snapshot.rows, "c_h477", "count");
  assert.equal(rodengo.peers.length, 201);
  assert.equal(rodengo.publish, true);
  const thin = peers.selectAnacPeers(snapshot.rows, "C_A403", "count");
  assert.equal(thin.peers.length, 1);
  assert.equal(thin.publish, false);
});

test("snapshot identity and coverage validation reject duplicates, impossible totals and invalid ratios", () => {
  for (const mutation of [
    (s) => s.rows.push(s.rows[0]),
    (s) => { s.rows[1].istatCode = s.rows[0].istatCode; },
    (s) => { s.rows[1].codiceIpa = s.rows[0].codiceIpa; },
    (s) => { s.rows[0].stableAwards = s.rows[0].awards + 1; },
    (s) => { s.rows[0].mix = { "45": s.rows[0].procedures + 1 }; },
    (s) => { s.rows[0].attributedValue = "9999999999999999999999999"; },
    (s) => { s.rows[0].count = { top1Share: r(1, 0), top10Share: r(1), hhi10000: r(10000) }; },
  ]) { const changed = structuredClone(snapshot); mutation(changed); assert.throws(() => peers.validateAnacPeerSnapshot(changed)); }
});

test("loader rejects a damaged index and a changed parent after a successful read", async () => {
  const root = mkdtempSync(join(tmpdir(), "dvns-peers-"));
  try {
    const files = ["scripts/etl/specs/anac-procurement-peers.source.json", "src/data/generated/anac-procurement-peers/meta.json", "src/data/generated/anac-procurement-peers/snapshot.json.gz", ...Object.values(peers.anacPeerSource.inputs).map((v) => v.path)];
    for (const path of files) { mkdirSync(join(root, path, ".."), { recursive: true }); copyFileSync(path, join(root, path)); }
    await peers.loadAnacPeerSnapshot(root);
    const path = join(root, files[2]), original = readFileSync(path);
    const damaged = Buffer.from(original); damaged[damaged.length - 1] ^= 1; writeFileSync(path, damaged);
    await assert.rejects(peers.loadAnacPeerSnapshot(root), /Hash indice confronti/);
    writeFileSync(path, original);
    const parent = join(root, peers.anacPeerSource.inputs.geography.path);
    writeFileSync(parent, readFileSync(parent).toString() + " ");
    await assert.rejects(peers.loadAnacPeerSnapshot(root), /Provenienza indice confronti/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { operatorHistoryFixture } from "./helpers/operator-history-fixture.mjs";
const { getOperatorHistory, readOperatorHistoryAwards } = await import(
  "../src/lib/data/anac-operator-history.ts"
);

const fixture = operatorHistoryFixture();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("il lettore legge pagine arbitrarie, applica limiti e rifiuta blocchi alterati", () => {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "dvns-history-reader-"));
  try {
    const directory = join(root, "src/data/generated/anac-operator-history");
    mkdirSync(directory, { recursive: true });
    mkdirSync(join(root, "src/data/generated/anac-operator-awards-index"), {
      recursive: true,
    });
    mkdirSync(join(root, "scripts/etl/specs"), { recursive: true });
    const source = "{}";
    writeFileSync(
      join(root, "src/data/generated/anac-operator-awards-index/meta.json"),
      source,
    );
    writeFileSync(
      join(root, "scripts/etl/specs/anac-cig-2007-2025.source.json"),
      source,
    );
    const bucket = digest(fixture.summary.ref).slice(0, 2);
    const pack = Buffer.from(fixture.pack, "base64");
    const shards = [],
      packs = [];
    for (let i = 0; i < 256; i++) {
      const id = i.toString(16).padStart(2, "0");
      const compressed = gzipSync(
        id === bucket ? JSON.stringify(fixture.summary) + "\n" : "",
      );
      const data = id === bucket ? pack : Buffer.alloc(0);
      writeFileSync(join(directory, id + ".jsonl.gz"), compressed);
      writeFileSync(join(directory, id + ".pack"), data);
      shards.push({ id, bytes: compressed.length, sha256: digest(compressed) });
      packs.push({ id, bytes: data.length, sha256: digest(data) });
    }
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        dataset: "anac-operator-history",
        observedAt: "2026-09-08T10:30:00Z",
        generatedAt: "2026-09-12T17:54:59Z",
        totals: { operators: 1, awardRelations: 205 },
        coverage: {
          rows: 0,
          prevalentRows: 0,
          matchedCigs: 0,
          conflictingCigs: 0,
        },
        sourceIndexSha256: digest(source),
        sourceCigSpecSha256: digest(source),
        shards,
        packs,
      }),
    );
    process.chdir(root);
    assert.equal(getOperatorHistory("../not-an-operator"), null);
    const history = getOperatorHistory(fixture.summary.ref);
    assert.equal(history.awardCount, 205);
    const positions = [0, 99, 100, 199, 204];
    const awards = readOperatorHistoryAwards(history, positions);
    assert.equal(awards.length, positions.length);
    assert.equal(new Set(awards.map((row) => row.awardId)).size, 5);
    assert.ok(
      awards.every((row) => row.amount === "0" && row.procedure === null),
    );
    assert.throws(() => readOperatorHistoryAwards(history, [205]));
    assert.throws(() => readOperatorHistoryAwards(history, [0, 0]));
    assert.throws(() =>
      readOperatorHistoryAwards(
        history,
        Array.from({ length: 26 }, (_, i) => i),
      ),
    );
    const tampered = Buffer.from(pack);
    tampered[history.detail.blocks[1].offset + 12] ^= 1;
    writeFileSync(join(directory, bucket + ".pack"), tampered);
    assert.throws(() => readOperatorHistoryAwards(history, [100]), /Hash/);
    assert.equal(readOperatorHistoryAwards(history, [0]).length, 1);
    writeFileSync(
      join(directory, bucket + ".pack"),
      pack.subarray(0, pack.length - 1),
    );
    assert.throws(() => readOperatorHistoryAwards(history, [0]), /Dimensioni/);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

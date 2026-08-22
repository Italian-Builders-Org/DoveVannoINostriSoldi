import assert from "node:assert/strict";
import test from "node:test";
import { INSTITUTIONAL_SOURCE_REGISTRY } from "../src/lib/data/institutional-source-registry.ts";

test("institutional source registry keeps stable IDs, dates and publication readiness", () => {
  assert.equal(new Set(INSTITUTIONAL_SOURCE_REGISTRY.map((source) => source.id)).size, INSTITUTIONAL_SOURCE_REGISTRY.length);
  assert.ok(INSTITUTIONAL_SOURCE_REGISTRY.every((source) => source.sourceRecordId && source.sourceUrl.startsWith("https://")));
  assert.ok(INSTITUTIONAL_SOURCE_REGISTRY.every((source) => source.licenseStatus === "not-declared"));

  const parliament = INSTITUTIONAL_SOURCE_REGISTRY.filter((source) => source.domain === "parliament");
  assert.ok(parliament.every((source) => source.readiness === "metadata-only"));
  const pcm = INSTITUTIONAL_SOURCE_REGISTRY.find((source) => source.id === "pcm-rendiconto-2024");
  assert.equal(pcm?.readiness, "pending-download-validation");
  const ministries = INSTITUTIONAL_SOURCE_REGISTRY.filter((source) => source.domain === "ministry");
  assert.deepEqual(ministries.map((source) => source.sourceRecordId).sort(), [
    "2024_RND_SPE_ELB_CAP_001",
    "2025_RND_SPE_ELB_CAP_001",
  ]);
  assert.ok(ministries.every((source) => source.downloadUrl?.startsWith("https://bdap-opendata.rgs.mef.gov.it/")));
  assert.ok(ministries.every((source) => source.assetId?.endsWith("@rgs")));
  assert.deepEqual(ministries.map((source) => source.expectedSchema?.fieldCount), [41, 41]);
});

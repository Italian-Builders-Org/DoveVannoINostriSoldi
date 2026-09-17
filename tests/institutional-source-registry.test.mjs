import assert from "node:assert/strict";
import test from "node:test";
import { INSTITUTIONAL_SOURCE_REGISTRY } from "../src/lib/data/institutional-source-registry.ts";

test("institutional source registry keeps stable IDs, dates and publication readiness", () => {
  assert.equal(new Set(INSTITUTIONAL_SOURCE_REGISTRY.map((source) => source.id)).size, INSTITUTIONAL_SOURCE_REGISTRY.length);
  assert.ok(INSTITUTIONAL_SOURCE_REGISTRY.every((source) => source.sourceRecordId && source.sourceUrl.startsWith("https://")));
  assert.ok(INSTITUTIONAL_SOURCE_REGISTRY.every((source) =>
    source.licenseStatus === "declared" ? Boolean(source.licenseName) : source.licenseName === null,
  ));

  const parliament = INSTITUTIONAL_SOURCE_REGISTRY.filter((source) => source.domain === "parliament");
  assert.ok(parliament.every((source) => source.readiness === "metadata-only"));
  const pcm = INSTITUTIONAL_SOURCE_REGISTRY.find((source) => source.id === "pcm-rendiconto-2024");
  assert.equal(pcm?.readiness, "verified-data");
  assert.deepEqual(pcm?.expectedSchema, { fieldCount: 32, rowCount: 572 });
  const ministries = INSTITUTIONAL_SOURCE_REGISTRY.filter((source) => source.domain === "ministry");
  assert.deepEqual(ministries.map((source) => source.sourceRecordId).sort(), [
    "2024_RND_SPE_ELB_CAP_001",
    "2025_RND_SPE_ELB_CAP_001",
  ]);
  assert.ok(ministries.every((source) => source.downloadUrl?.startsWith("https://bdap-opendata.rgs.mef.gov.it/")));
  assert.ok(ministries.every((source) => source.assetId?.endsWith("@rgs")));
  assert.deepEqual(ministries.map((source) => source.expectedSchema?.fieldCount), [41, 41]);
  const ministries2025 = ministries.find((source) => source.referencePeriod === "2025");
  assert.equal(ministries2025?.readiness, "verified-data");
  assert.equal(ministries2025?.licenseName, "CC BY 3.0");
  const regions = INSTITUTIONAL_SOURCE_REGISTRY.find((source) => source.domain === "region");
  assert.equal(regions?.sourceRecordId, "istat:125266");
  assert.equal(regions?.readiness, "verified-data");
  assert.deepEqual(regions?.expectedSchema, { fieldCount: 4, rowCount: 22 });
  assert.equal(regions?.createdAt, null);
  assert.equal(regions?.updatedAt, null);
});

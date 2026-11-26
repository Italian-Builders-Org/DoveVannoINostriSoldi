import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { isInSwissBorderZone, swissBorderZoneSource, swissBorderZoneSize } = await import("../src/lib/swiss-border-zone.ts");
const { queryMefMunicipalIrpef } = await import("../src/lib/mef-irpef-snapshot.ts");

test("the official list flags border Comuni by ISTAT code, including merged ones", () => {
  assert.equal(swissBorderZoneSize(), 517);
  assert.equal(isInSwissBorderZone("012086"), true); // Lavena Ponte Tresa
  assert.equal(isInSwissBorderZone("013075"), true); // Como
  assert.equal(isInSwissBorderZone("013256"), true); // Uggiate con Ronago
  // Codes before the merger of Ronago and Uggiate-Trevano still resolve.
  assert.equal(isInSwissBorderZone("013199"), true);
  assert.equal(isInSwissBorderZone("013228"), true);
  assert.equal(isInSwissBorderZone("015146"), false); // Milano
  assert.equal(isInSwissBorderZone("058091"), false); // Roma
  assert.equal(isInSwissBorderZone(" 012086 "), true);
  for (const bad of ["", "12086", "abcdef", "0120860"]) assert.equal(isInSwissBorderZone(bad), false, bad);
  assert.match(swissBorderZoneSource.url, /^https:\/\/www\.estv\.admin\.ch\//);
  assert.equal(swissBorderZoneSource.effectiveFrom, "2024-01-01");
});

test("IRPEF municipality records carry the flag only for listed Comuni", () => {
  const border = queryMefMunicipalIrpef({ year: 2024, level: "municipality", code: "012086" });
  assert.equal(border.data[0].territory.swissBorderZone, true);
  const elsewhere = queryMefMunicipalIrpef({ year: 2024, level: "municipality", code: "001019" });
  assert.equal("swissBorderZone" in elsewhere.data[0].territory, false);
  // Regions and provinces never carry it: the list is per Comune.
  const region = queryMefMunicipalIrpef({ year: 2024, level: "region", region: "03" });
  assert.equal("swissBorderZone" in region.data[0].territory, false);
  // Every listed Comune present in the MEF release is flagged, and nothing else.
  const flagged = [];
  for (let offset = 0; ; offset += 100) {
    const page = queryMefMunicipalIrpef({ year: 2024, level: "municipality", limit: 100, offset, region: "03" });
    flagged.push(...page.data.filter((record) => record.territory.swissBorderZone).map((record) => record.territory.code));
    if (offset + 100 >= page.pagination.total) break;
  }
  // 386 rows of the list are in Lombardy, Ronago and Uggiate-Trevano now one Comune.
  assert.equal(flagged.length, 385, `Comuni lombardi segnalati: ${flagged.length}`);
  assert.ok(flagged.every((code) => isInSwissBorderZone(code)));
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildEpeaView, parseEpeaSelection, EPEA_SECTORS, EPEA_YEARS } from "../src/lib/istat-epea-view.ts";

const { rows } = JSON.parse(readFileSync(new URL("../src/data/generated/istat-epea-2016-2022.data.json", import.meta.url)));

test("EPEA: default e query ambigue non diventano un altro perimetro", () => {
  assert.deepEqual(parseEpeaSelection({}), { year: 2022, sector: "S13_15" });
  assert.deepEqual(parseEpeaSelection({ anno: "2016", settore: "S1" }), { year: 2016, sector: "S1" });
  for (const params of [{ anno: ["2021", "2022"] }, { settore: ["S1", "S14"] }, { anno: "2023" }, { anno: "2016x" }, { anno: "" }, { settore: "S2" }, { settore: "S13" }]) {
    assert.equal(parseEpeaSelection(params), null);
  }
});

test("EPEA: valori ufficiali, aggregati e settori separati", () => {
  const economy = buildEpeaView(rows, 2022, "S1");
  assert.equal(economy.totalCents, 5_143_440_000_000);
  assert.equal(economy.classes.find((item) => item.code === "CEPA3").amountCents, 2_357_600_000_000);
  assert.equal(buildEpeaView(rows, 2022, "S13_15").totalCents, 1_413_470_000_000);
  for (const sector of EPEA_SECTORS) {
    for (const year of EPEA_YEARS) {
      const view = buildEpeaView(rows, year, sector.code);
      assert.equal(view.history.length, 7);
      assert.equal(view.classes.length, 7);
      assert.ok(view.totalCents > 0);
      assert.ok(view.classes.every((item) => item.amountCents !== null));
    }
  }
});

test("EPEA: il totale pubblicato non viene ricostruito dalle parti", () => {
  const fixture = rows.filter((row) => row.dataTypeAggr === "EPS_NEXP" && row.institutionalSector === "S1");
  const unrelated = { ...fixture[0], dataTypeAggr: "EPS_P1", amountCents: 900_000_000, obsValueMillions: "9" };
  assert.deepEqual(buildEpeaView([...fixture, unrelated], 2022, "S1"), buildEpeaView(fixture, 2022, "S1"));
  const withoutClasses = fixture.filter((row) => row.cepaClass === "TOT_CEPA");
  assert.equal(buildEpeaView(withoutClasses, 2022, "S1").totalCents, 5_143_440_000_000);
  assert.ok(buildEpeaView(withoutClasses, 2022, "S1").classes.every((item) => item.amountCents === null));
});

test("EPEA: zero, assenza e null restano distinti dai valori positivi", () => {
  const row = rows.find((row) => row.dataTypeAggr === "EPS_NEXP" && row.year === 2022 && row.institutionalSector === "S1" && row.cepaClass === "TOT_CEPA");
  assert.equal(buildEpeaView([], 2022, "S1").totalCents, null);
  assert.equal(buildEpeaView([{ ...row, amountCents: null, obsValueMillions: null }], 2022, "S1").totalCents, null);
  assert.equal(buildEpeaView([{ ...row, amountCents: 0, obsValueMillions: "0" }], 2022, "S1").totalCents, 0);
  for (const patch of [{ amountCents: -1 }, { amountCents: null }, { amountCents: Number.MAX_SAFE_INTEGER + 1 }, { obsValueMillions: "1" }, { refArea: "FR" }, { valuation: "L" }]) {
    assert.throws(() => buildEpeaView([{ ...row, ...patch }], 2022, "S1"));
  }
  assert.throws(() => buildEpeaView([row, row], 2022, "S1"), /duplicata/);
});

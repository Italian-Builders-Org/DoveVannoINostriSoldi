import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  MOP_DATASET_ID,
  MOP_SCHEMA,
  normalizeCup,
  normalizeMopRow,
  parseMopDatasetMetadata,
  parseMopSchema,
} from "../src/lib/data/bdap-public-works-contract.ts";

function schemaFixture() {
  return {
    d: {
      results: Object.entries(MOP_SCHEMA).map(([field, [physicalName, logicalName, dbType]], index) => ({
        id: index,
        physicalName,
        logicalName,
        dbType,
        colUniqueId: `C${field}Fixture`,
        cardinality: field === "localCode" ? 560_245 : field === "cup" ? 541_539 : 0,
      })),
    },
  };
}

function rowFixture(fields) {
  const row = {};
  const strings = {
    localCode: "17EM#2010-00005/BO",
    cup: "I39B05000060005",
    description: "PALAZZETTO DELLO SPORT E DELLA CULTURA",
    statusCode: "A",
    status: "ATTIVO",
    holderName: "COMUNE DI ESEMPIO",
    holderTaxCode: "01025300375",
    entityCode: "123456789",
    entityName: "COMUNE DI ESEMPIO",
    nature: "REALIZZAZIONE DI LAVORI PUBBLICI",
    interventionType: "NUOVA REALIZZAZIONE",
    sector: "INFRASTRUTTURE SOCIALI",
    subsector: "SPORT",
    category: "IMPIANTI SPORTIVI",
    plannedExecutionStart: "2020-01-01",
    plannedExecutionEnd: "2022-12-31",
    actualExecutionStart: "2020-02-01",
    actualExecutionEnd: "",
    plannedOperationStart: "2023-01-01",
    actualOperationStart: "0023-01-01",
  };
  const money = {
    plannedWorksCost: "1000000.00",
    plannedAvailableSums: "100000.00",
    plannedInvestmentCharges: "0.00",
    actualWorksCost: "1250000.00",
    actualAvailableSums: "100000.00",
    actualInvestmentCharges: "0.00",
    stateFunding: "500000.00",
    europeanFunding: "300000.00",
    territorialFunding: "100000.00",
    privateFunding: "0.00",
    otherFunding: "0.00",
    fundingToFind: "200000.00",
    economies: "0.00",
  };
  for (const [field, value] of Object.entries({ ...strings, ...money })) row[fields[field]] = value;
  return row;
}

test("MOP metadata and schema fail closed on upstream drift", () => {
  const metadata = parseMopDatasetMetadata({
    d: {
      id: MOP_DATASET_ID,
      inferredDataType: "STATISTIC",
      isReady: true,
      lastUpdate: "03/08/2026 13:34:51",
    },
  });
  assert.equal(metadata.referenceDate, "2026-08-03");

  const schema = parseMopSchema(schemaFixture());
  assert.equal(schema.localProjectCardinality, 560_245);
  assert.equal(schema.cupCardinality, 541_539);
  assert.equal(Object.keys(schema.fields).length, Object.keys(MOP_SCHEMA).length);

  const drifted = schemaFixture();
  drifted.d.results.find((column) => column.physicalName === MOP_SCHEMA.cup[0]).logicalName = "Identificativo";
  assert.throws(() => parseMopSchema(drifted), /definizione cambiata/);
  assert.throws(
    () => parseMopDatasetMetadata({ d: { id: "other", inferredDataType: "STATISTIC", isReady: true, lastUpdate: "03/08/2026 13:34:51" } }),
    /identificativo dataset inatteso/,
  );
});

test("MOP records preserve money, flag bad dates and create explainable screening signals", () => {
  const schema = parseMopSchema(schemaFixture());
  const work = normalizeMopRow(rowFixture(schema.fields), schema.fields, "2026-08-20");

  assert.equal(work.cup, "I39B05000060005");
  assert.equal(work.costs.plannedTotalCents, 110_000_000);
  assert.equal(work.costs.actualTotalCents, 135_000_000);
  assert.equal(work.costs.changeBasisPoints, 2_273);
  assert.equal(work.funding.securedTotalCents, 90_000_000);
  assert.equal(work.funding.toFindCents, 20_000_000);
  assert.equal(work.dates.actualOperationStart, null);
  assert.ok(work.dataQualityWarnings.some((warning) => warning.includes("0023-01-01")));
  assert.deepEqual(
    work.signals.map((signal) => signal.code),
    ["data-quality", "schedule-check", "cost-growth", "funding-gap"],
  );
  assert.ok(work.signals.every((signal) => signal.verificationUse === "screening-only"));
  assert.ok(work.signals.every((signal) => signal.benignExplanations.length >= 2));
});

test("MOP input and monetary fields reject unsafe values", () => {
  assert.equal(normalizeCup(" i39b05000060005 "), "I39B05000060005");
  assert.throws(() => normalizeCup("non-valido"), /CUP non valido/);
  const schema = parseMopSchema(schemaFixture());
  const row = rowFixture(schema.fields);
  row[schema.fields.actualWorksCost] = "non disponibile";
  assert.throws(() => normalizeMopRow(row, schema.fields, "2026-08-20"), /importo non valido/);
});

test("MOP preserves the published negative funding balance instead of rejecting CUP J84C20001920001", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/bdap-mop-negative-balance.json", import.meta.url), "utf8"));
  const fields = Object.fromEntries(Object.entries(MOP_SCHEMA).map(([field, [physical]]) => [field, fixture.aliases[physical]]));
  const work = normalizeMopRow(fixture.row, fields, fixture.source.observedAt);
  assert.equal(work.cup, "J84C20001920001");
  assert.equal(work.funding.toFindCents, -6_065_244);
  assert.equal(work.funding.stateCents, 356_065_244);
  assert.equal(work.funding.otherCents, 488_000_000);
  assert.ok(work.dataQualityWarnings.some((warning) => /finanziamenti da reperire.*negativo/i.test(warning)));
  assert.ok(work.signals.some((signal) => signal.code === "data-quality"));
  assert.ok(work.signals.every((signal) => signal.code !== "funding-gap"));
});

test("MOP accepts signed funding balances only and keeps malformed amounts fail closed", () => {
  const schema = parseMopSchema(schemaFixture());
  for (const [value, expected] of [["-0.00", 0], ["-0.01", -1], ["-60652.44", -6_065_244], ["0.00", 0], ["20.50", 2050]]) {
    const row = rowFixture(schema.fields);
    row[schema.fields.fundingToFind] = value;
    assert.equal(normalizeMopRow(row, schema.fields, "2026-10-15").funding.toFindCents, expected);
  }
  for (const value of ["--1", "1e3", "-1.001", "NaN", "", null, 0, "-90071992547409.92"]) {
    const row = rowFixture(schema.fields);
    row[schema.fields.fundingToFind] = value;
    assert.throws(() => normalizeMopRow(row, schema.fields, "2026-10-15"), /importo/);
  }
  for (const field of ["plannedWorksCost", "stateFunding", "economies"]) {
    const row = rowFixture(schema.fields);
    row[schema.fields[field]] = "-1.00";
    assert.throws(() => normalizeMopRow(row, schema.fields, "2026-10-15"), /importo non valido/);
  }
});

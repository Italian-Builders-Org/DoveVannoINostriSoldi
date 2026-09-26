import { createHash } from "node:crypto";
import sourceLock from "../../../scripts/etl/specs/istat-population-grid-2021.source.json";

const OFFICIAL_HOST = "www.istat.it";
const BAND_IDS = [
  "0",
  "1-9",
  "10-49",
  "50-99",
  "100-499",
  "500-999",
  "1000-4999",
  "5000+",
] as const;

export type IstatPopulationGridBandId = (typeof BAND_IDS)[number];

export type IstatPopulationGrid2021Data = {
  schemaVersion: 1;
  transformVersion: 1;
  datasetId: "istat-population-grid-2021";
  observedAt: string;
  unit: "person-and-cell-count";
  reference: {
    censusYear: 2021;
    cellSizeSquareKilometres: 1;
    gridSystem: string;
    title: string;
  };
  totals: {
    cells: number;
    cellsWithPopulation: number;
    cellsWithZeroPopulation: number;
    residentPopulation: number;
    malePopulation: number;
    femalePopulation: number;
    populationFieldPop0_15: number;
    populationAge15to64: number;
    populationAge65plus: number;
    bornInItaly: number;
    bornInOtherEuCountry: number;
    bornOutsideEu: number;
    employed: number;
    sameResidenceOneYearEarlier: number;
    otherResidenceInItalyOneYearEarlier: number;
    otherResidenceAbroadOneYearEarlier: number;
  };
  populationBands: Array<{ id: IstatPopulationGridBandId; label: string; cells: number }>;
  borderCells: Array<{ id: string; cells: number }>;
  economicJoins: Array<{
    id: string;
    label: string;
    joinKey: string;
    href: string;
    note: string;
  }>;
  caveats: string[];
  provenance: {
    holder: string;
    landingUrl: string;
    assetUrl: string;
    methodologyUrl: string;
    licenseId: "not-declared";
    asset: {
      bytes: number;
      sha256: string;
      member: { path: string; bytes: number; sha256: string };
    };
    methodology: { bytes: number; sha256: string };
    acquiredAt: string;
  };
};

export type IstatPopulationGrid2021Metadata = {
  schemaVersion: 1;
  datasetId: "istat-population-grid-2021";
  generatedAt: string;
  observedAt: string;
  source: {
    holder: string;
    landingUrl: string;
    assetUrl: string;
    methodologyUrl: string;
    licenseId: "not-declared";
    acquiredAt: string;
    asset: IstatPopulationGrid2021Data["provenance"]["asset"];
    methodology: IstatPopulationGrid2021Data["provenance"]["methodology"];
  };
  semantics: {
    soldi: { present: false; note: string };
    periodo: {
      referencePeriod: string;
      censusYear: number;
      publicationDate: string;
      updateDate: string;
    };
    provenance: { holder: string };
  };
  artifact: { path: string; bytes: number; sha256: string };
  refreshWorkflow: null;
  runtimeNetwork: false;
};

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: oggetto atteso`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field}: testo non vuoto atteso`);
  }
  return value.trim();
}

function nonNegInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field}: intero non negativo atteso`);
  }
  return value;
}

function sha256Hex(value: unknown, field: string): string {
  const digest = text(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${field}: SHA-256 atteso`);
  }
  return digest;
}

function officialUrl(value: unknown, field: string): string {
  const raw = text(value, field);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== OFFICIAL_HOST ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error(`${field}: URL ufficiale ISTAT atteso`);
  }
  return raw;
}

function timestamp(value: unknown, field: string): string {
  const raw = text(value, field);
  if (Number.isNaN(new Date(raw).getTime())) {
    throw new Error(`${field}: timestamp non valido`);
  }
  return raw;
}

export function assertIstatPopulationGrid2021Data(value: unknown): IstatPopulationGrid2021Data {
  const record = object(value, "data");
  if (record.schemaVersion !== 1 || record.transformVersion !== 1) {
    throw new Error("data: versione 1 attesa");
  }
  if (record.datasetId !== "istat-population-grid-2021") {
    throw new Error("data.datasetId inatteso");
  }
  if (record.unit !== "person-and-cell-count") {
    throw new Error("data.unit inattesa");
  }

  const reference = object(record.reference, "data.reference");
  if (reference.censusYear !== 2021 || reference.cellSizeSquareKilometres !== 1) {
    throw new Error("data.reference: censimento 2021 / 1 km² attesi");
  }

  const totals = object(record.totals, "data.totals");
  const pins = (
    sourceLock as unknown as {
      expected: { pins: Record<string, number> & { bands: Record<string, number> } };
    }
  ).expected.pins;
  const checkedTotals = {
    cells: nonNegInt(totals.cells, "data.totals.cells"),
    cellsWithPopulation: nonNegInt(totals.cellsWithPopulation, "data.totals.cellsWithPopulation"),
    cellsWithZeroPopulation: nonNegInt(
      totals.cellsWithZeroPopulation,
      "data.totals.cellsWithZeroPopulation",
    ),
    residentPopulation: nonNegInt(totals.residentPopulation, "data.totals.residentPopulation"),
    malePopulation: nonNegInt(totals.malePopulation, "data.totals.malePopulation"),
    femalePopulation: nonNegInt(totals.femalePopulation, "data.totals.femalePopulation"),
    populationFieldPop0_15: nonNegInt(
      totals.populationFieldPop0_15,
      "data.totals.populationFieldPop0_15",
    ),
    populationAge15to64: nonNegInt(totals.populationAge15to64, "data.totals.populationAge15to64"),
    populationAge65plus: nonNegInt(totals.populationAge65plus, "data.totals.populationAge65plus"),
    bornInItaly: nonNegInt(totals.bornInItaly, "data.totals.bornInItaly"),
    bornInOtherEuCountry: nonNegInt(
      totals.bornInOtherEuCountry,
      "data.totals.bornInOtherEuCountry",
    ),
    bornOutsideEu: nonNegInt(totals.bornOutsideEu, "data.totals.bornOutsideEu"),
    employed: nonNegInt(totals.employed, "data.totals.employed"),
    sameResidenceOneYearEarlier: nonNegInt(
      totals.sameResidenceOneYearEarlier,
      "data.totals.sameResidenceOneYearEarlier",
    ),
    otherResidenceInItalyOneYearEarlier: nonNegInt(
      totals.otherResidenceInItalyOneYearEarlier,
      "data.totals.otherResidenceInItalyOneYearEarlier",
    ),
    otherResidenceAbroadOneYearEarlier: nonNegInt(
      totals.otherResidenceAbroadOneYearEarlier,
      "data.totals.otherResidenceAbroadOneYearEarlier",
    ),
  };

  for (const key of [
    "cells",
    "residentPopulation",
    "malePopulation",
    "femalePopulation",
    "populationFieldPop0_15",
    "populationAge15to64",
    "populationAge65plus",
    "bornInItaly",
    "employed",
    "cellsWithZeroPopulation",
  ] as const) {
    if (checkedTotals[key] !== pins[key]) {
      throw new Error(`data.totals.${key}: pin ufficiale divergente`);
    }
  }
  if (checkedTotals.malePopulation + checkedTotals.femalePopulation !== checkedTotals.residentPopulation) {
    throw new Error("data.totals: sesso non riconciliato");
  }
  if (
    checkedTotals.populationFieldPop0_15 +
      checkedTotals.populationAge15to64 +
      checkedTotals.populationAge65plus !==
    checkedTotals.residentPopulation
  ) {
    throw new Error("data.totals: età non riconciliata");
  }
  if (
    checkedTotals.bornInItaly +
      checkedTotals.bornInOtherEuCountry +
      checkedTotals.bornOutsideEu !==
    checkedTotals.residentPopulation
  ) {
    throw new Error("data.totals: luogo di nascita non riconciliato");
  }
  if (
    checkedTotals.cellsWithPopulation + checkedTotals.cellsWithZeroPopulation !==
    checkedTotals.cells
  ) {
    throw new Error("data.totals: celle zero/positive non riconciliate");
  }

  if (!Array.isArray(record.populationBands) || record.populationBands.length !== BAND_IDS.length) {
    throw new Error("data.populationBands: otto bande attese");
  }
  const populationBands = record.populationBands.map((item, index) => {
    const band = object(item, `data.populationBands[${index}]`);
    const id = text(band.id, `data.populationBands[${index}].id`) as IstatPopulationGridBandId;
    if (id !== BAND_IDS[index]) {
      throw new Error(`data.populationBands[${index}].id inatteso`);
    }
    const cells = nonNegInt(band.cells, `data.populationBands[${index}].cells`);
    if (cells !== pins.bands[id]) {
      throw new Error(`data.populationBands[${index}].cells: pin ufficiale divergente`);
    }
    return {
      id,
      label: text(band.label, `data.populationBands[${index}].label`),
      cells,
    };
  });

  if (!Array.isArray(record.borderCells) || record.borderCells.length < 1) {
    throw new Error("data.borderCells: lista non vuota attesa");
  }
  const borderCells = record.borderCells.map((item, index) => {
    const cell = object(item, `data.borderCells[${index}]`);
    return {
      id: text(cell.id, `data.borderCells[${index}].id`),
      cells: nonNegInt(cell.cells, `data.borderCells[${index}].cells`),
    };
  });
  const borderTotal = borderCells.reduce((sum, item) => sum + item.cells, 0);
  if (borderTotal !== checkedTotals.cells) {
    throw new Error("data.borderCells: somma celle non riconciliata");
  }

  if (!Array.isArray(record.economicJoins) || record.economicJoins.length < 1) {
    throw new Error("data.economicJoins: join economici attesi");
  }
  const economicJoins = record.economicJoins.map((item, index) => {
    const join = object(item, `data.economicJoins[${index}]`);
    return {
      id: text(join.id, `data.economicJoins[${index}].id`),
      label: text(join.label, `data.economicJoins[${index}].label`),
      joinKey: text(join.joinKey, `data.economicJoins[${index}].joinKey`),
      href: text(join.href, `data.economicJoins[${index}].href`),
      note: text(join.note, `data.economicJoins[${index}].note`),
    };
  });

  if (!Array.isArray(record.caveats) || record.caveats.length < 3) {
    throw new Error("data.caveats: limiti semantici richiesti");
  }
  const caveats = record.caveats.map((item, index) => text(item, `data.caveats[${index}]`));

  const provenance = object(record.provenance, "data.provenance");
  const asset = object(provenance.asset, "data.provenance.asset");
  const member = object(asset.member, "data.provenance.asset.member");
  const methodology = object(provenance.methodology, "data.provenance.methodology");
  const lockSource = (sourceLock as unknown as { source: Record<string, unknown> }).source;
  if (sha256Hex(asset.sha256, "data.provenance.asset.sha256") !== lockSource.sha256) {
    throw new Error("data.provenance.asset.sha256: divergente dal lock");
  }
  if (nonNegInt(asset.bytes, "data.provenance.asset.bytes") !== lockSource.bytes) {
    throw new Error("data.provenance.asset.bytes: divergente dal lock");
  }

  return {
    schemaVersion: 1,
    transformVersion: 1,
    datasetId: "istat-population-grid-2021",
    observedAt: timestamp(record.observedAt, "data.observedAt"),
    unit: "person-and-cell-count",
    reference: {
      censusYear: 2021,
      cellSizeSquareKilometres: 1,
      gridSystem: text(reference.gridSystem, "data.reference.gridSystem"),
      title: text(reference.title, "data.reference.title"),
    },
    totals: checkedTotals,
    populationBands,
    borderCells,
    economicJoins,
    caveats,
    provenance: {
      holder: text(provenance.holder, "data.provenance.holder"),
      landingUrl: officialUrl(provenance.landingUrl, "data.provenance.landingUrl"),
      assetUrl: officialUrl(provenance.assetUrl, "data.provenance.assetUrl"),
      methodologyUrl: officialUrl(provenance.methodologyUrl, "data.provenance.methodologyUrl"),
      licenseId: "not-declared",
      asset: {
        bytes: nonNegInt(asset.bytes, "data.provenance.asset.bytes"),
        sha256: sha256Hex(asset.sha256, "data.provenance.asset.sha256"),
        member: {
          path: text(member.path, "data.provenance.asset.member.path"),
          bytes: nonNegInt(member.bytes, "data.provenance.asset.member.bytes"),
          sha256: sha256Hex(member.sha256, "data.provenance.asset.member.sha256"),
        },
      },
      methodology: {
        bytes: nonNegInt(methodology.bytes, "data.provenance.methodology.bytes"),
        sha256: sha256Hex(methodology.sha256, "data.provenance.methodology.sha256"),
      },
      acquiredAt: timestamp(provenance.acquiredAt, "data.provenance.acquiredAt"),
    },
  };
}

export function assertIstatPopulationGrid2021Metadata(
  value: unknown,
  data: IstatPopulationGrid2021Data,
  rawDataBytes: Uint8Array,
): IstatPopulationGrid2021Metadata {
  const record = object(value, "metadata");
  if (record.schemaVersion !== 1 || record.datasetId !== "istat-population-grid-2021") {
    throw new Error("metadata: identità inattesa");
  }
  if (record.refreshWorkflow !== null) {
    throw new Error("metadata.refreshWorkflow: deve restare null (niente bot di refresh)");
  }
  if (record.runtimeNetwork !== false) {
    throw new Error("metadata.runtimeNetwork: deve essere false");
  }

  const source = object(record.source, "metadata.source");
  const artifact = object(record.artifact, "metadata.artifact");
  const digest = createHash("sha256").update(rawDataBytes).digest("hex");
  if (sha256Hex(artifact.sha256, "metadata.artifact.sha256") !== digest) {
    throw new Error("metadata.artifact.sha256: non riconciliato con i byte dei dati");
  }
  if (nonNegInt(artifact.bytes, "metadata.artifact.bytes") !== rawDataBytes.byteLength) {
    throw new Error("metadata.artifact.bytes: non riconciliato");
  }
  if (text(artifact.path, "metadata.artifact.path") !== "src/data/generated/istat-population-grid-2021.data.json") {
    throw new Error("metadata.artifact.path inatteso");
  }

  const semantics = object(record.semantics, "metadata.semantics");
  const soldi = object(semantics.soldi, "metadata.semantics.soldi");
  if (soldi.present !== false) {
    throw new Error("metadata.semantics.soldi.present deve essere false");
  }
  const periodo = object(semantics.periodo, "metadata.semantics.periodo");
  const provenance = object(semantics.provenance, "metadata.semantics.provenance");

  return {
    schemaVersion: 1,
    datasetId: "istat-population-grid-2021",
    generatedAt: timestamp(record.generatedAt, "metadata.generatedAt"),
    observedAt: timestamp(record.observedAt, "metadata.observedAt"),
    source: {
      holder: text(source.holder, "metadata.source.holder"),
      landingUrl: officialUrl(source.landingUrl, "metadata.source.landingUrl"),
      assetUrl: officialUrl(source.assetUrl, "metadata.source.assetUrl"),
      methodologyUrl: officialUrl(source.methodologyUrl, "metadata.source.methodologyUrl"),
      licenseId: "not-declared",
      acquiredAt: timestamp(source.acquiredAt, "metadata.source.acquiredAt"),
      asset: data.provenance.asset,
      methodology: data.provenance.methodology,
    },
    semantics: {
      soldi: {
        present: false,
        note: text(soldi.note, "metadata.semantics.soldi.note"),
      },
      periodo: {
        referencePeriod: text(periodo.referencePeriod, "metadata.semantics.periodo.referencePeriod"),
        censusYear: nonNegInt(periodo.censusYear, "metadata.semantics.periodo.censusYear"),
        publicationDate: text(periodo.publicationDate, "metadata.semantics.periodo.publicationDate"),
        updateDate: text(periodo.updateDate, "metadata.semantics.periodo.updateDate"),
      },
      provenance: {
        holder: text(provenance.holder, "metadata.semantics.provenance.holder"),
      },
    },
    artifact: {
      path: "src/data/generated/istat-population-grid-2021.data.json",
      bytes: rawDataBytes.byteLength,
      sha256: digest,
    },
    refreshWorkflow: null,
    runtimeNetwork: false,
  };
}

export function validateIstatPopulationGrid2021Bundle(
  dataValue: unknown,
  metadataValue: unknown,
  rawDataBytes: Uint8Array,
): { data: IstatPopulationGrid2021Data; metadata: IstatPopulationGrid2021Metadata } {
  const data = assertIstatPopulationGrid2021Data(dataValue);
  const metadata = assertIstatPopulationGrid2021Metadata(metadataValue, data, rawDataBytes);
  return { data, metadata };
}

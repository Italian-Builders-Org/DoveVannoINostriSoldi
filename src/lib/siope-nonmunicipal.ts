import "server-only";

import { createHash } from "node:crypto";
import rawDetail from "@/data/generated/siope-nonmunicipal-detail.json";
import nativeProvenance from "@/data/generated/siope-nonmunicipal-provenance.json";
import viewProof from "@/data/generated/siope-nonmunicipal-view-proof.json";
import integratedCatalog from "@/data/generated/integrated/catalog.json";
import datasetProof from "../../data/source-ledger/dataset-proof.json";
import integratedReleaseProof from "../../data/source-ledger/release-proof.json";
import inventoryReceipt from "../../data/source-ledger/datasets/siope-inventario-enti.receipt.json";
import metroReceipt from "../../data/source-ledger/datasets/siope-uscite-citta-metropolitane.receipt.json";
import provinceReceipt from "../../data/source-ledger/datasets/siope-uscite-province.receipt.json";
import regionReceipt from "../../data/source-ledger/datasets/siope-uscite-regioni.receipt.json";

export type NonMunicipalYear = {
  year: 2024 | 2025 | 2026;
  status: "available" | "no_movements" | "outside_period";
  amountCents: number | null;
  monthsObserved: readonly number[];
  monthly: readonly { month: number; amountCents: number }[];
  titles: readonly { code: string; label: string; amountCents: number }[];
  provenance: {
    siopeOwner: string;
    siopeMovementsUrl: string;
    siopeMovementsSha256: string;
    siopeRegistryUrl: string;
    siopeRegistrySha256: string;
    ipaUrl: string;
    ipaSha256: string;
    acquisitionDate: string;
    publicationDate: null;
    license: "not-declared";
  };
  caveats: readonly string[];
};

export type SiopeNonMunicipalEntity = {
  codiceIpa: string;
  taxCode: string;
  entityType: "PROVINCIA" | "REGIONE" | "CITTA_METROP";
  entityName: string;
  includedCodes: readonly string[];
  years: readonly NonMunicipalYear[];
};

type Detail = { schemaVersion: number; scope: string; flow: string; unit: string; accountingBasis: string; releaseId: string; entities: unknown };

const siopeBase = "https://www.siope.it/documenti/siope2/open/last";
const ipaUrl = "https://indicepa.gov.it/ipa-dati/dataset/502ff370-1b2c-4310-94c7-f39ceb7500e3/resource/3ed63523-ff9c-41f6-a6fe-980f3d9e501f/download/amministrazioni.txt";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("SIOPE non comunale: valore non canonico");
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(`${canonicalJson(value)}\n`, "utf8").digest("hex");
}

function validAcquisitionDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return false;
  const today = new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10) <= today;
}

function assertReleaseBinding(value: Detail): void {
  const native = nativeProvenance as { schemaVersion: number; attestation?: string; detailSha256?: string; releaseId: string; sources: Record<string, NonMunicipalYear["provenance"]>; projections: Record<string, { bytes: number; sha256: string; rows: number }>; inputReceiptSha256?: string; inputReceipt?: unknown };
  if (viewProof.nativeProvenanceSha256 !== sha256Canonical(native) || native.releaseId !== value.releaseId) throw new Error("SIOPE non comunale: manifest provenienza divergente");
  if (native.schemaVersion === 1) {
    if (native.attestation !== "historical-not-reattested" || native.detailSha256 !== sha256Canonical(value)) throw new Error("SIOPE non comunale: vista storica divergente");
  } else if (native.schemaVersion === 2) {
    if (native.inputReceiptSha256 !== sha256Canonical(native.inputReceipt) || native.releaseId !== createHash("sha256").update(canonicalJson({ inputReceiptSha256: native.inputReceiptSha256, projections: native.projections, sources: native.sources })).digest("hex")) throw new Error("SIOPE non comunale: ricevuta della release divergente");
  } else throw new Error("SIOPE non comunale: attestazione sconosciuta");
  for (const entity of value.entities as SiopeNonMunicipalEntity[]) for (const year of entity.years) {
    if (canonicalJson(year.provenance) !== canonicalJson(native.sources[String(year.year)])) throw new Error("SIOPE non comunale: provenienza divergente fra enti");
  }
  const receipts = {
    "siope-inventario-enti": inventoryReceipt,
    "siope-uscite-citta-metropolitane": metroReceipt,
    "siope-uscite-province": provinceReceipt,
    "siope-uscite-regioni": regionReceipt,
  } as const;
  if (viewProof.schemaVersion !== 1 || viewProof.scope !== "non-municipal-payments-view" || viewProof.releaseId !== value.releaseId || viewProof.detailSha256 !== sha256Canonical(value) || viewProof.catalogSha256 !== sha256Canonical(integratedCatalog) || viewProof.datasetProofSha256 !== sha256Canonical(datasetProof) || viewProof.integratedReleaseSetSha256 !== integratedReleaseProof.releaseSetSha256 || datasetProof.catalogSha256 !== viewProof.catalogSha256) throw new Error("SIOPE non comunale: proof della release divergente");
  const catalogEntries = new Map(integratedCatalog.datasets.map((entry) => [entry.id, entry]));
  for (const [datasetId, receipt] of Object.entries(receipts)) {
    const receiptSha256 = sha256Canonical(receipt);
    const projection = { bytes: receipt.source.bytes, sha256: receipt.source.sha256, rows: receipt.source.rows };
    if (canonicalJson(native.projections[datasetId]) !== canonicalJson(projection)) throw new Error("SIOPE non comunale: proiezione divergente dal manifest");
    if (viewProof.datasetReceipts[datasetId as keyof typeof viewProof.datasetReceipts] !== receiptSha256 || viewProof.canonicalRowsSha256[datasetId as keyof typeof viewProof.canonicalRowsSha256] !== receipt.rowsSha256 || catalogEntries.get(datasetId)?.receiptSha256 !== receiptSha256) throw new Error("SIOPE non comunale: ricevuta/corpus della release divergenti");
  }
}

export function assertSiopeNonMunicipalDetail(value: Detail): asserts value is Detail & { entities: SiopeNonMunicipalEntity[] } {
  if (value.schemaVersion !== 1 || value.scope !== "non-municipal-payments" || value.flow !== "uscite" || value.unit !== "EUR-cent" || value.accountingBasis !== "cash" || !/^[a-f0-9]{64}$/.test(value.releaseId) || !Array.isArray(value.entities)) throw new Error("SIOPE non comunale: contratto release non valido");
  const ipa = new Set<string>();
  const entities = value.entities as SiopeNonMunicipalEntity[];
  for (const entity of entities) {
    if (!/^[A-Za-z0-9_]+$/.test(entity.codiceIpa) || ipa.has(entity.codiceIpa) || !/^\d{11}$/.test(entity.taxCode) || !["PROVINCIA", "REGIONE", "CITTA_METROP"].includes(entity.entityType) || !entity.entityName || !Array.isArray(entity.includedCodes) || entity.includedCodes.length === 0 || [...entity.includedCodes].join("\n") !== [...new Set(entity.includedCodes)].sort().join("\n") || !Array.isArray(entity.years) || entity.years.length !== 3 || entity.years.map((year: NonMunicipalYear) => year.year).join(",") !== "2026,2025,2024") throw new Error("SIOPE non comunale: identità non valida");
    ipa.add(entity.codiceIpa);
    for (const year of entity.years) {
      const provenance = year.provenance as NonMunicipalYear["provenance"] & Record<string, unknown>;
      const expectedUrl = `${siopeBase}/SIOPE_USCITE.${year.year}.zip`;
      if (![2024, 2025, 2026].includes(year.year) || !["available", "no_movements", "outside_period"].includes(year.status) || (year.status === "available") !== (year.amountCents !== null) || (year.amountCents !== null && !Number.isSafeInteger(year.amountCents)) || !Array.isArray(year.monthly) || !Array.isArray(year.titles) || !Array.isArray(year.monthsObserved) || year.monthsObserved.join(",") !== year.monthly.map((point: { month: number }) => point.month).join(",") || provenance.siopeMovementsUrl !== expectedUrl || provenance.siopeRegistryUrl !== `${siopeBase}/SIOPE_ANAGRAFICHE.zip` || provenance.ipaUrl !== ipaUrl || !validAcquisitionDate(provenance.acquisitionDate) || provenance.publicationDate !== null || provenance.license !== "not-declared") throw new Error("SIOPE non comunale: periodo o provenienza non validi");
      for (const field of ["siopeMovementsSha256", "siopeRegistrySha256", "ipaSha256"] as const) {
        const digest = provenance[field];
        if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) || new Set(digest).size === 1) throw new Error("SIOPE non comunale: hash provenienza non valido");
      }
      if (year.status !== "available" && (year.monthly.length !== 0 || year.titles.length !== 0)) throw new Error("SIOPE non comunale: assenza non vuota");
      if (year.monthly.some((point: { month: number; amountCents: number }) => !Number.isInteger(point.month) || point.month < 1 || point.month > 12 || !Number.isSafeInteger(point.amountCents)) || year.titles.some((item: { code: string; label: string; amountCents: number }) => !item.code || !item.label || !Number.isSafeInteger(item.amountCents))) throw new Error("SIOPE non comunale: aggregato non valido");
      const monthlyTotal = year.monthly.reduce((sum: number, point: { amountCents: number }) => sum + point.amountCents, 0);
      const titleTotal = year.titles.reduce((sum: number, point: { amountCents: number }) => sum + point.amountCents, 0);
      if (!Number.isSafeInteger(monthlyTotal) || !Number.isSafeInteger(titleTotal) || (year.amountCents !== null && (monthlyTotal !== year.amountCents || titleTotal !== year.amountCents))) throw new Error("SIOPE non comunale: riconciliazione non valida");
    }
  }
  assertReleaseBinding(value);
}

const detail = rawDetail as Detail & { entities: SiopeNonMunicipalEntity[] };
assertSiopeNonMunicipalDetail(detail);

export const siopeNonMunicipalReleaseId = detail.releaseId;
export const siopeNonMunicipalEntities = detail.entities;
export function getSiopeNonMunicipalEntityByIpaCode(codiceIpa: string): SiopeNonMunicipalEntity | null {
  return detail.entities.find((entity) => entity.codiceIpa === codiceIpa.trim()) ?? null;
}

export function findSiopeNonMunicipalEntities(query = ""): readonly SiopeNonMunicipalEntity[] {
  const term = query.trim().toLocaleLowerCase("it-IT");
  return detail.entities.filter((entity) => !term || [entity.codiceIpa, entity.entityName, entity.entityType]
    .some((value) => value.toLocaleLowerCase("it-IT").includes(term)));
}

export function selectSiopeNonMunicipalYear(entity: SiopeNonMunicipalEntity, requestedYear: string | string[] | undefined): { selected: NonMunicipalYear; invalidYear: boolean } {
  const selected = typeof requestedYear === "string"
    ? entity.years.find((item) => String(item.year) === requestedYear)
    : undefined;
  return {
    selected: selected ?? entity.years[0],
    invalidYear: requestedYear !== undefined && selected === undefined,
  };
}

export function getSiopeNonMunicipalPeriodStatus(year: NonMunicipalYear): { status: "partial-revisionable" | "complete-revisionable"; latestObservedMonthMayBeIncomplete: boolean } {
  const acquisitionYear = new Date(year.provenance.acquisitionDate).getUTCFullYear();
  const partial = year.year >= acquisitionYear || year.monthsObserved.length < 12;
  return {
    status: partial ? "partial-revisionable" : "complete-revisionable",
    latestObservedMonthMayBeIncomplete: partial && year.year === acquisitionYear,
  };
}

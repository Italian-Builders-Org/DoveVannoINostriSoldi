import "server-only";

import { selectSortedRows } from "@/lib/integrated-sorted-lookup";
import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";

export const realEstateSource = {
  beniDatasetId: "mef-patrimonio-beni-2023",
  contrattiDatasetId: "mef-patrimonio-contratti-2023",
  adempimentoDatasetId: "mef-patrimonio-adempimento-2023",
  landingUrl:
    "https://www.de.mef.gov.it/it/attivita_istituzionali/patrimonio_pubblico/censimento_immobili_pubblici/open_data_immobili/dati_immobili_2023.html",
  release: "2023",
} as const;

// Titles the source uses for ownership and other real rights; everything else is held from third parties.
const OWNED_TITLES = new Set([
  "Proprietà",
  "Proprietà per l'area",
  "Nuda proprietà",
  "Proprietà superficiaria",
  "Usufrutto",
]);
export const USE_ORDER = [
  "Utilizzato direttamente",
  "Non utilizzato",
  "Inutilizzabile",
  "In ristrutturazione/manutenzione",
  "Non indicato",
] as const;
const ERP = "Edilizia residenziale pubblica";
const TOP = 5;

const BENI_COLUMNS = [
  "Codice fiscale ente", "Titolo", "Utilizzo del bene", "Dato a terzi", "Tipologia bene", "Beni",
  "Comune del bene", "Codice catastale comune del bene", "Codice catastale comune ente",
];
const COMMUNICATION_COLUMNS = ["Invio comunicazione 2023", "Dichiarazione negativa", "Dichiarazione di completezza"];
const CONTRATTI_COLUMNS = [
  "Codice fiscale ente", "Tipo detenzione", "Finalità persona fisica", "Contratti",
  "Contratti con canone zero", "Contratti per rapporto canone/superficie",
  "Canone annuo per rapporto (EUR)", "Superficie per rapporto (m²)",
];

export type Count = Readonly<{ label: string; count: number }>;
export type RentRatio = Readonly<{
  contracts: number;
  ratioContracts: number;
  annualRentEur: number;
  surfaceM2: number;
  /** Declared annual rent over declared surface, per month; null without a usable denominator. */
  eurPerM2Month: number | null;
}>;

export type RealEstateSummary = Readonly<{
  owned: Readonly<{
    total: number;
    byUse: readonly Count[];
    /** Of the owned assets with no declared use, those the source flags as given to third parties. */
    unstatedGivenToThirdParties: number;
    unusedByType: readonly Count[];
    elsewhere: number;
    elsewhereMunicipalities: number;
    locations: readonly Readonly<{ municipality: string; cadastralCode: string; count: number }>[];
  }>;
  heldFromOthers: number;
  contracts: Readonly<{
    total: number;
    byType: readonly Count[];
    zeroRent: number;
    leasedNonErp: RentRatio;
    leasedErp: RentRatio;
  }>;
}>;

/** 2023 communication from the MEF compliance file; negative and complete are null when nothing was sent. */
export type Communication = Readonly<{ sent: boolean; negative: boolean | null; complete: boolean | null }>;

export type MunicipalityRealEstate =
  | Readonly<{
      status: "available";
      data: RealEstateSummary & Readonly<{ taxCode: string }>;
      /** Null when the entity is not in the compliance file. */
      communication: Communication | null;
    }>
  | Readonly<{ status: "not_found"; reason: "no_matching_record"; message: string; communication: Communication | null }>;

function count(value: string | null | undefined, label: string): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Conteggio del patrimonio non valido: ${label}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Conteggio del patrimonio fuori limite: ${label}.`);
  return parsed;
}

function surface(value: string | null | undefined): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new Error("Superficie del patrimonio non valida.");
  }
  return Number(value);
}

function tally(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function ranked(map: Map<string, number>, limit = Infinity): Count[] {
  return [...map].map(([label, value]) => ({ label, count: value }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "it"))
    .slice(0, limit);
}

function ratio(rows: readonly IntegratedPublicRow[]): RentRatio {
  let contracts = 0, ratioContracts = 0, annualRentEur = 0, surfaceM2 = 0;
  for (const row of rows) {
    contracts += count(row.cells["Contratti"], "contratti");
    ratioContracts += count(row.cells["Contratti per rapporto canone/superficie"], "contratti per rapporto");
    annualRentEur += count(row.cells["Canone annuo per rapporto (EUR)"], "canone per rapporto");
    surfaceM2 += surface(row.cells["Superficie per rapporto (m²)"]);
  }
  return {
    contracts, ratioContracts, annualRentEur, surfaceM2,
    eurPerM2Month: surfaceM2 > 0 ? annualRentEur / surfaceM2 / 12 : null,
  };
}

function yesNo(value: string | null | undefined, label: string): boolean {
  if (value === "Si") return true;
  if (value === "No") return false;
  throw new Error(`${label} fuori dominio: ${value}.`);
}

// The declarations exist only for entities that sent the communication; the ETL enforces the same rule.
export function readCommunication(cells: Readonly<Record<string, string | null>>): Communication {
  const sent = yesNo(cells["Invio comunicazione 2023"], "Invio comunicazione");
  if (!sent) {
    if (cells["Dichiarazione negativa"] || cells["Dichiarazione di completezza"]) {
      throw new Error("Dichiarazioni fuori dominio senza invio della comunicazione.");
    }
    return { sent, negative: null, complete: null };
  }
  return {
    sent,
    negative: yesNo(cells["Dichiarazione negativa"], "Dichiarazione negativa"),
    complete: yesNo(cells["Dichiarazione di completezza"], "Dichiarazione di completezza"),
  };
}

function emptyStateMessage(communication: Communication | null): string {
  if (communication?.negative) return "Nessun bene nel censimento MEF 2023: il Comune ha dichiarato di non avere beni da comunicare.";
  if (communication && !communication.sent) {
    return "Nessun bene nel censimento MEF 2023 e il Comune non ha inviato la comunicazione 2023: la fonte non dice se possieda immobili.";
  }
  return "Nessun bene di questo Comune nel censimento MEF 2023. Non significa che il Comune non possieda immobili: può non averli comunicati.";
}

/** Pure summary of one entity's rows; independent from how the rows are loaded. */
export function summarizeRealEstate(
  beni: readonly IntegratedPublicRow[],
  contratti: readonly IntegratedPublicRow[],
): RealEstateSummary {
  const byUse = new Map<string, number>(USE_ORDER.map((use) => [use, 0]));
  const unusedByType = new Map<string, number>();
  const locations = new Map<string, { municipality: string; cadastralCode: string; count: number }>();
  let owned = 0, heldFromOthers = 0, elsewhere = 0, unstatedGivenToThirdParties = 0;
  for (const row of beni) {
    const amount = count(row.cells["Beni"], "beni");
    const title = row.cells["Titolo"] ?? "";
    if (!OWNED_TITLES.has(title)) {
      heldFromOthers += amount;
      continue;
    }
    owned += amount;
    const use = row.cells["Utilizzo del bene"] ?? "";
    if (!byUse.has(use)) throw new Error(`Stato d'uso fuori dominio: ${use}.`);
    tally(byUse, use, amount);
    const thirdParty = row.cells["Dato a terzi"];
    if (use === "Non indicato" && (thirdParty === "Interamente" || thirdParty === "Parzialmente")) {
      unstatedGivenToThirdParties += amount;
    }
    if (use === "Non utilizzato") tally(unusedByType, row.cells["Tipologia bene"] || "Tipologia non indicata", amount);
    const code = row.cells["Codice catastale comune del bene"] ?? "";
    if (code !== row.cells["Codice catastale comune ente"]) {
      elsewhere += amount;
      const place = locations.get(code) ?? { municipality: row.cells["Comune del bene"] ?? code, cadastralCode: code, count: 0 };
      place.count += amount;
      locations.set(code, place);
    }
  }

  const byType = new Map<string, number>();
  let total = 0, zeroRent = 0;
  for (const row of contratti) {
    const amount = count(row.cells["Contratti"], "contratti");
    total += amount;
    zeroRent += count(row.cells["Contratti con canone zero"], "canone zero");
    tally(byType, row.cells["Tipo detenzione"] ?? "", amount);
  }
  const leased = contratti.filter((row) => row.cells["Tipo detenzione"] === "in locazione");
  return {
    owned: {
      total: owned,
      byUse: USE_ORDER.map((use) => ({ label: use, count: byUse.get(use) ?? 0 })),
      unstatedGivenToThirdParties,
      unusedByType: ranked(unusedByType, TOP),
      elsewhere,
      elsewhereMunicipalities: locations.size,
      locations: [...locations.values()].sort((a, b) => b.count - a.count || a.municipality.localeCompare(b.municipality, "it")).slice(0, TOP),
    },
    heldFromOthers,
    contracts: {
      total,
      byType: ranked(byType),
      zeroRent,
      leasedNonErp: ratio(leased.filter((row) => row.cells["Finalità persona fisica"] !== ERP)),
      leasedErp: ratio(leased.filter((row) => row.cells["Finalità persona fisica"] === ERP)),
    },
  };
}

// The three datasets are published sorted by fiscal code, so an entity is a binary search away.
async function entityRows(datasetId: string, taxCode: string, columns: readonly string[]) {
  const { rows, headers } = await selectSortedRows(datasetId, "Codice fiscale ente", taxCode);
  if (columns.some((column) => !headers.includes(column))) {
    throw new Error(`Schema divergente nel dataset ${datasetId}.`);
  }
  return { rows };
}

export async function getMunicipalityRealEstate(taxCode: string): Promise<MunicipalityRealEstate> {
  if (!/^[0-9]{11}$/.test(taxCode)) {
    return {
      status: "not_found",
      reason: "no_matching_record",
      message: "Codice fiscale dell’ente non valido: il censimento MEF non è collegabile.",
      communication: null,
    };
  }
  const [beni, contratti, adempimento] = await Promise.all([
    entityRows(realEstateSource.beniDatasetId, taxCode, BENI_COLUMNS),
    entityRows(realEstateSource.contrattiDatasetId, taxCode, CONTRATTI_COLUMNS),
    entityRows(realEstateSource.adempimentoDatasetId, taxCode, COMMUNICATION_COLUMNS),
  ]);
  if (adempimento.rows.length > 1) throw new Error("Ente ripetuto nel file di adempimento MEF.");
  const communication = adempimento.rows[0] ? readCommunication(adempimento.rows[0].cells) : null;
  if (beni.rows.length === 0 && contratti.rows.length === 0) {
    return { status: "not_found", reason: "no_matching_record", message: emptyStateMessage(communication), communication };
  }
  return {
    status: "available",
    data: { taxCode, ...summarizeRealEstate(beni.rows, contratti.rows) },
    communication,
  };
}

import { mefParticipationsSnapshot } from "@/lib/mef-participations-snapshot";
import { openCoesioneSnapshot } from "@/lib/opencoesione-snapshot";
import { consulentiSnapshot } from "@/lib/consulenti-snapshot";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";
import parliamentManifest from "@/data/generated/parliament-source-manifest.json";
import pcmMetadata from "@/data/generated/pcm-financial-2024.meta.json";
import pcmData from "@/data/generated/pcm-financial-2024.data.json";
import { anacCigSnapshot } from "@/lib/anac-cig-snapshot";
import { inpsCivilInvaliditySnapshot } from "@/lib/inps-invalidity-snapshot";
import { cptRegionalFiscalSnapshot } from "@/lib/cpt-regional-fiscal-snapshot";
import { istatPensionsSnapshot } from "@/lib/istat-pensions-snapshot";
import { consipOrdiniData, consipOrdiniMetadata } from "@/lib/consip-ordini-snapshot";
import { eurostatCofogData, eurostatCofogMetadata } from "@/lib/eurostat-cofog-snapshot";
import { eurostatGovMainData, eurostatGovMainMetadata } from "@/lib/eurostat-gov-main-snapshot";
import { inpsNaspiData, inpsNaspiMetadata } from "@/lib/inps-naspi-snapshot";
import { inpsAssegnoUnicoData, inpsAssegnoUnicoMetadata } from "@/lib/inps-assegno-unico-snapshot";
import {
  inpsIntegrazioniSalarialiData,
  inpsIntegrazioniSalarialiMetadata,
} from "@/lib/inps-integrazioni-salariali-snapshot";
import {
  inpsCigFondiSolidarietaData,
  inpsCigFondiSolidarietaMetadata,
} from "@/lib/inps-cig-fondi-solidarieta-snapshot";
import {
  inlVigilanzaData,
  inlVigilanzaMetadata,
} from "@/lib/inl-vigilanza-snapshot";
import { mefIvaData, mefIvaMetadata } from "@/lib/mef-iva-snapshot";
import { euVatGapItalyData, euVatGapItalyMetadata } from "@/lib/eu-vat-gap-italy-snapshot";
import { mefTaxGapNazionaleData, mefTaxGapNazionaleMetadata } from "@/lib/mef-tax-gap-nazionale-snapshot";
import { eurostatTaxagData, eurostatTaxagMetadata } from "@/lib/eurostat-taxag-snapshot";
import { eurostatShaHealthData, eurostatShaHealthMetadata } from "@/lib/eurostat-sha-health-snapshot";
import { mefIrpefDettaglioData, mefIrpefDettaglioMetadata } from "@/lib/mef-irpef-dettaglio-snapshot";
import { istatCofogData, istatCofogMetadata } from "@/lib/istat-cofog-snapshot";
import { istatEpeaData, istatEpeaMetadata } from "@/lib/istat-epea-snapshot";
import { istatPovertaData, istatPovertaMetadata } from "@/lib/istat-poverta-snapshot";
import { istatPovertaRelativaData, istatPovertaRelativaMetadata } from "@/lib/istat-poverta-relativa-snapshot";
import { istatBesData, istatBesMetadata } from "@/lib/istat-bes-snapshot";
import { istatBesSaluteData, istatBesSaluteMetadata } from "@/lib/istat-bes-salute-snapshot";
import { istatBesIstruzioneData, istatBesIstruzioneMetadata } from "@/lib/istat-bes-istruzione-snapshot";
import { istatBesLavoroData, istatBesLavoroMetadata } from "@/lib/istat-bes-lavoro-snapshot";
import { istatBesRelazioniData, istatBesRelazioniMetadata } from "@/lib/istat-bes-relazioni-snapshot";
import { istatBesPoliticaData, istatBesPoliticaMetadata } from "@/lib/istat-bes-politica-snapshot";
import { istatBesSicurezzaData, istatBesSicurezzaMetadata } from "@/lib/istat-bes-sicurezza-snapshot";
import { istatBesPaesaggioData, istatBesPaesaggioMetadata } from "@/lib/istat-bes-paesaggio-snapshot";
import { istatBesServiziData, istatBesServiziMetadata } from "@/lib/istat-bes-servizi-snapshot";
import { MEF_IRPEF_SOURCE } from "@/lib/data/mef-irpef-source";
import pnrrProjectsMetadata from "@/data/generated/pnrr-projects-index/meta.json";
import { PNRR_CHILDCARE_SOURCE } from "@/lib/data/pnrr-childcare-source";
import { getPublicDebtSnapshot } from "@/lib/public-debt";
import { eurostatHicpData, eurostatHicpMetadata } from "@/lib/eurostat-hicp-snapshot";
import { eurostatGdpData, eurostatGdpMetadata } from "@/lib/eurostat-gdp-snapshot";
import { oecdTaxingWagesData, oecdTaxingWagesMetadata } from "@/lib/oecd-taxing-wages-snapshot";
import { getGovernmentScorecardSourceSummary } from "@/lib/government-scorecard-governments";
import istatMunicipalityGeographyMetadata from "@/data/generated/istat-municipality-geography.meta.json";

import { SOURCE_IDS, type SourceId } from "@/lib/data/source-policy";
import { baseHealth, freshnessFor, type SourceHealth } from "@/lib/data/source-health-common";

type IstatMunicipalityGeographyMetadata = Readonly<{
  schemaVersion: 1;
  datasetId: "istat-municipality-geography";
  generatedAt: string;
  availableYears: number[];
  latest: Readonly<{
    year: number;
    sourceTimestamp: string;
    municipalities: number;
  }>;
}>;

export function validateIstatMunicipalityGeographyMetadata(
  value: unknown,
): IstatMunicipalityGeographyMetadata {
  const metadata = value as Partial<IstatMunicipalityGeographyMetadata>;
  const years = metadata.availableYears;
  const latest = metadata.latest;
  const validIsoDate = (date: unknown) =>
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
    !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf());

  if (
    metadata.schemaVersion !== 1 ||
    metadata.datasetId !== "istat-municipality-geography" ||
    typeof metadata.generatedAt !== "string" ||
    Number.isNaN(new Date(metadata.generatedAt).valueOf()) ||
    !Array.isArray(years) ||
    years.length === 0 ||
    !years.every((year, index) =>
      Number.isSafeInteger(year) && (index === 0 || year > years[index - 1]!),
    ) ||
    !latest ||
    latest.year !== years.at(-1) ||
    !validIsoDate(latest.sourceTimestamp) ||
    !Number.isSafeInteger(latest.municipalities) ||
    latest.municipalities < 7_800
  ) {
    throw new Error("Metadati health ISTAT SITUAS non validi");
  }

  return metadata as IstatMunicipalityGeographyMetadata;
}

function snapshotManagedOpenCoesione(): SourceHealth {
  return {
    ...baseHealth("opencoesione"),
    reachability: "not-probed",
    freshness: freshnessFor("opencoesione", openCoesioneSnapshot.referenceDate),
    latencyMs: null,
    detail:
      "Snapshot ETL attivo; reachability controllata dal workflow dedicato, non da questo endpoint.",
    recordCount: openCoesioneSnapshot.totals.projects,
  };
}

function snapshotManagedPnrr(): SourceHealth {
  return {
    ...baseHealth(PNRR_CHILDCARE_SOURCE.id),
    reachability: "not-probed",
    freshness: freshnessFor(PNRR_CHILDCARE_SOURCE.id, pnrrProjectsMetadata.referenceDate),
    latencyMs: null,
    detail: `Catalogo nazionale ReGiS: ${pnrrProjectsMetadata.coverage.projectRows} registrazioni, ${pnrrProjectsMetadata.coverage.uniqueCups} CUP validi distinti al 13/06/2026; progetti e localizzazioni, senza pagamenti. Il verticale asili conserva un rilascio distinto. Reachability non verificata da questo endpoint.`,
    recordCount: pnrrProjectsMetadata.coverage.projectRows,
  };
}

function snapshotManagedAnac(): SourceHealth {
  const latestSourceModified = anacCigSnapshot.inputs
    .map((input) => input.sourceLastModified)
    .sort()
    .at(-1) ?? null;
  return {
    ...baseHealth("anac"),
    reachability: "not-probed",
    freshness: freshnessFor("anac", latestSourceModified),
    latencyMs: null,
    detail: `Snapshot verificato il ${anacCigSnapshot.observedAt} · CIG ${anacCigSnapshot.referenceYear} · 12 distribuzioni mensili`,
    recordCount: anacCigSnapshot.population.records,
  };
}

function snapshotManagedInps(): SourceHealth {
  const latestSourceDate = inpsCivilInvaliditySnapshot.sources
    .map((source) => source.documentDate)
    .sort()
    .at(-1) ?? null;
  const regionalRecords =
    inpsCivilInvaliditySnapshot.regionalNewPensions.regions.length *
    inpsCivilInvaliditySnapshot.regionalNewPensions.years.length;
  return {
    ...baseHealth("inps"),
    reachability: "not-probed",
    freshness: freshnessFor("inps", latestSourceDate),
    latencyMs: null,
    detail:
      "Snapshot verificato · spesa nazionale 2021-2025 · nuove pensioni per regione 2016-2024 · pensioni vigenti INPS 2026",
    recordCount: regionalRecords + inpsCivilInvaliditySnapshot.spending.series.length,
  };
}

function snapshotManagedCpt(): SourceHealth {
  return {
    ...baseHealth("cpt"),
    reachability: "not-probed",
    freshness: freshnessFor("cpt", null),
    latencyMs: null,
    detail: `Snapshot verificato il ${cptRegionalFiscalSnapshot.provenance.observedAt.slice(0, 10)} · dati ${cptRegionalFiscalSnapshot.referenceYears.at(0)}-${cptRegionalFiscalSnapshot.referenceYears.at(-1)} · 21 territori`,
    recordCount: cptRegionalFiscalSnapshot.rows.length,
  };
}

function snapshotManagedMefIrpef(): SourceHealth {
  return {
    ...baseHealth(MEF_IRPEF_SOURCE.id),
    reachability: "not-probed",
    freshness: freshnessFor(MEF_IRPEF_SOURCE.id, MEF_IRPEF_SOURCE.health.publishedAt),
    latencyMs: null,
    detail: MEF_IRPEF_SOURCE.health.detail,
    recordCount: MEF_IRPEF_SOURCE.health.recordCount,
  };
}

function snapshotManagedIstat(): SourceHealth {
  const metadata = validateIstatMunicipalityGeographyMetadata(
    istatMunicipalityGeographyMetadata,
  );
  return {
    ...baseHealth("istat"),
    reachability: "not-probed",
    freshness: freshnessFor("istat", metadata.latest.sourceTimestamp),
    latencyMs: null,
    detail: `Snapshot SITUAS generato il ${metadata.generatedAt.slice(0, 10)} · dati al ${metadata.latest.sourceTimestamp} · geografia comunale ${metadata.latest.year} · ${metadata.latest.municipalities.toLocaleString("it-IT")} comuni · serie ${metadata.availableYears.at(0)}-${metadata.latest.year}`,
    recordCount: metadata.latest.municipalities,
  };
}

function snapshotManagedIstatCasellarioPensioni(): SourceHealth {
  const { data, metadata } = istatPensionsSnapshot;
  const pensionBenefits = data.pensionBenefits.observations;
  const pensioners = data.pensioners.observations;
  const benefitsObservedAt = metadata.source.assets.pensionBenefits.observedAt;
  const pensionersObservedAt = metadata.source.assets.pensioners.observedAt;
  const observedAt = benefitsObservedAt === pensionersObservedAt ? benefitsObservedAt : null;
  const artifact = metadata.integrity.dataArtifact;
  return {
    ...baseHealth("istat-casellario-pensioni"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-casellario-pensioni", observedAt),
    latencyMs: null,
    detail: `Snapshot ISTAT Casellario dei pensionati verificato · dati ${data.period.from}-${data.period.to} · pensioni e pensionati separati · ${data.territories.length} territori, di cui ${data.territories.filter((entry) => entry.kind === "provincia").length} province · ${artifact.bytes.toLocaleString("it-IT")} byte · check offline-source-lock-and-snapshot-contract`,
    recordCount: pensionBenefits.length + pensioners.length,
  };
}

function snapshotManagedConsip(): SourceHealth {
  const artifact = consipOrdiniMetadata.integrity.dataArtifact;
  return {
    ...baseHealth("consip"),
    reachability: "not-probed",
    freshness: freshnessFor("consip", consipOrdiniMetadata.suppression.observedAt),
    latencyMs: null,
    detail: `Snapshot Consip ordini verificato · Convenzioni e MEPA ${consipOrdiniData.period.from}-${consipOrdiniData.period.to} · importi come limiti inferiori con soppressioni dichiarate · ${artifact.bytes.toLocaleString("it-IT")} byte · check offline-source-lock-and-snapshot-contract`,
    recordCount: consipOrdiniData.byRegion.length + consipOrdiniData.byAdministrationType.length,
  };
}

function snapshotManagedMefParticipations(): SourceHealth {
  return {
    ...baseHealth("partecipazioni-pubbliche"),
    reachability: "not-probed",
    freshness: freshnessFor("partecipazioni-pubbliche", mefParticipationsSnapshot.publishedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · rilevazione ${mefParticipationsSnapshot.referenceYear}`,
    recordCount: mefParticipationsSnapshot.totals.participationRecords,
  };
}

function snapshotManagedConsulenti(): SourceHealth {
  const latest = consulentiSnapshot.externalAppointments.at(-1);
  return {
    ...baseHealth("consulenti"),
    reachability: "not-probed",
    freshness: freshnessFor("consulenti", null),
    latencyMs: null,
    detail: `Snapshot estratto il ${consulentiSnapshot.source.observedAt.slice(0, 10)} · ultimo anno disponibile ${consulentiSnapshot.latestYear}, parziale`,
    recordCount: latest?.assignments ?? null,
  };
}

function snapshotManagedOpenCivitas(): SourceHealth {
  return {
    ...baseHealth("opencivitas"),
    reachability: "not-probed",
    freshness: freshnessFor("opencivitas", openCivitasSnapshot.publishedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · dati ${openCivitasSnapshot.referenceYear}`,
    recordCount: openCivitasSnapshot.coverage.municipalities,
  };
}

function snapshotManagedCamera(): SourceHealth {
  const camera = parliamentSnapshot.chambers.find((chamber) => chamber.id === "camera");
  return {
    ...baseHealth("camera"),
    reachability: "not-probed",
    freshness: freshnessFor("camera", null),
    latencyMs: null,
    detail: `Snapshot verificato il ${parliamentSnapshot.observedAt.slice(0, 10)} · consuntivo e bilancio collegati ai documenti ufficiali della Camera.`,
    recordCount: camera?.statements.length ?? null,
  };
}

function snapshotManagedSenate(): SourceHealth {
  return {
    ...baseHealth("senato"),
    reachability: "not-probed",
    freshness: freshnessFor("senato", null),
    latencyMs: null,
    detail: `Metadati verificati il ${parliamentManifest.verifiedAt.slice(0, 10)} · importi esclusi finché i PDF contabili non sono acquisiti e verificati.`,
    recordCount: parliamentManifest.senato.latestDocuments.length,
  };
}

function snapshotManagedPcm(): SourceHealth {
  return {
    ...baseHealth("pcm"),
    reachability: "not-probed",
    freshness: freshnessFor("pcm", pcmMetadata.source.publishedAt),
    latencyMs: null,
    detail: `Rendiconto PCM ${pcmData.referenceYear} · workbook XLSX verificato e ${pcmData.coverage.sourceRows} righe riconciliate.`,
    recordCount: pcmData.coverage.sourceRows,
  };
}

function snapshotManagedPublicDebt(sourceId: "bancaditalia" | "eurostat"): SourceHealth {
  const snapshot = getPublicDebtSnapshot();
  const isBank = sourceId === "bancaditalia";
  return {
    ...baseHealth(sourceId),
    reachability: "not-probed",
    freshness: freshnessFor(sourceId, isBank ? snapshot.stock.referenceDate : `${snapshot.annualInterest.referenceYear}-12-31`),
    latencyMs: null,
    detail: isBank
      ? `Snapshot ETL attivo · stock al ${snapshot.stock.referenceDate} · quattro cubi BDS riconciliati.`
      : `Snapshot ETL attivo · interessi e spesa totale ${snapshot.annualInterest.referenceYear} riconciliati.`,
    recordCount: isBank ? snapshot.stock.history.length : snapshot.annualInterest.history.length,
  };
}

function snapshotManagedEurostatHicp(): SourceHealth {
  const latestSourceUpdate = Object.values(eurostatHicpMetadata.source.assets)
    .map((asset) => asset.sourceUpdated)
    .sort()
    .at(-1) ?? null;
  return {
    ...baseHealth("eurostat-hicp"),
    reachability: "not-probed",
    freshness: freshnessFor("eurostat-hicp", latestSourceUpdate),
    latencyMs: null,
    detail: `Snapshot Eurostat HICP verificato · totale Italia ${eurostatHicpData.period.total.from}/${eurostatHicpData.period.total.to} · divisioni e confronto ${eurostatHicpData.period.divisions} · pesi ${eurostatHicpData.period.weightYears.at(-1)} · prezzi, non spesa pubblica.`,
    recordCount: eurostatHicpData.coverage.observedCells,
  };
}

function snapshotManagedEurostatGdp(): SourceHealth {
  return {
    ...baseHealth("eurostat-gdp"),
    reachability: "not-probed",
    freshness: freshnessFor("eurostat-gdp", eurostatGdpMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot Eurostat PIL verificato · trimestrale Italia ${eurostatGdpData.period.quarterly.from}/${eurostatGdpData.period.quarterly.to} · annuale ${eurostatGdpData.period.annual.from}-${eurostatGdpData.period.annual.to} · peer ${eurostatGdpData.period.peers.from}/${eurostatGdpData.period.peers.to} · conti nazionali, non cassa pubblica.`,
    recordCount: eurostatGdpData.coverage.observedCells,
  };
}

function snapshotManagedOecdTaxingWages(): SourceHealth {
  return {
    ...baseHealth("oecd-taxing-wages"),
    reachability: "not-probed",
    freshness: freshnessFor("oecd-taxing-wages", oecdTaxingWagesMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot OECD Taxing Wages verificato · Italia ${oecdTaxingWagesData.period.from}-${oecdTaxingWagesData.period.to} profilo S_C0 AW100 · confronto peer ${oecdTaxingWagesData.period.peersFrom}-${oecdTaxingWagesData.period.peersTo} · aliquote su profilo tipo, non spesa pubblica.`,
    recordCount: oecdTaxingWagesData.coverage.observedCells,
  };
}

function snapshotManagedEurostatCofog(): SourceHealth {
  const artifact = eurostatCofogMetadata.integrity.dataArtifact;
  const { flagged, observedCells } = eurostatCofogData.coverage;
  const detailCells = Object.values(eurostatCofogData.details).reduce(
    (total, detail) => total + detail.coverage.observedCells,
    0,
  );
  return {
    ...baseHealth("eurostat-cofog"),
    reachability: "not-probed",
    freshness: freshnessFor("eurostat-cofog", eurostatCofogMetadata.coverage.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · spesa per funzione COFOG ${eurostatCofogData.period.from}-${eurostatCofogData.period.to} (${eurostatCofogMetadata.source.datasetCode}) · livello principale ${observedCells}/${observedCells} celle, dettaglio Italia GF01–GF10 ${detailCells}/${detailCells}, ${flagged} flag sul livello principale · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: eurostatCofogData.observations.length + detailCells,
  };
}

function snapshotManagedEurostatGovMain(): SourceHealth {
  const artifact = eurostatGovMainMetadata.integrity.dataArtifact;
  const { flagged, observedCells } = eurostatGovMainData.coverage;
  return {
    ...baseHealth("eurostat-gov-main"),
    reachability: "not-probed",
    freshness: freshnessFor("eurostat-gov-main", eurostatGovMainMetadata.coverage.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · entrate e uscite PA ${eurostatGovMainData.period.from}-${eurostatGovMainData.period.to} (${eurostatGovMainMetadata.source.datasetCode}) · ${eurostatGovMainData.items.length} voci, ${observedCells}/${observedCells} celle, ${flagged} flag · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: eurostatGovMainData.observations.length,
  };
}

function snapshotManagedIstatCofog(): SourceHealth {
  const artifact = istatCofogMetadata.integrity.dataArtifact;
  const { observedCells } = istatCofogData.coverage;
  return {
    ...baseHealth("istat-cofog"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-cofog", istatCofogMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · consumi finali della PA per funzione ${istatCofogData.period.from}-${istatCofogData.period.to} (${istatCofogMetadata.source.dataflowId}, edizione ${istatCofogData.measure.edition}) · copertura piena ${observedCells} celle · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: istatCofogData.observations.length,
  };
}

function snapshotManagedInpsNaspi(): SourceHealth {
  const artifact = inpsNaspiMetadata.integrity.dataArtifact;
  const { observedObservations, suppressed } = inpsNaspiData.coverage;
  return {
    ...baseHealth("inps-naspi"),
    reachability: "not-probed",
    freshness: freshnessFor("inps-naspi", inpsNaspiMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · NASpI beneficiari e trattamenti ${inpsNaspiData.period.from}-${inpsNaspiData.period.to} · ${inpsNaspiData.tables.length} tabelle SDMX, ${observedObservations.toLocaleString("it-IT")} osservazioni di cui ${suppressed} soppresse per privacy · riconciliazioni esatte · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: observedObservations,
  };
}

function snapshotManagedInpsAssegnoUnico(): SourceHealth {
  const artifact = inpsAssegnoUnicoMetadata.integrity.dataArtifact;
  return {
    ...baseHealth("inps-assegno-unico"),
    reachability: "not-probed",
    freshness: freshnessFor("inps-assegno-unico", inpsAssegnoUnicoMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · Assegno Unico ${inpsAssegnoUnicoData.period.from}-${inpsAssegnoUnicoData.period.to} · ${inpsAssegnoUnicoData.coverage.observedRows.toLocaleString("it-IT")} righe provinciali (AUU a domanda, esclusi RdC) · importi in millesimi · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: inpsAssegnoUnicoData.coverage.observedRows,
  };
}

function snapshotManagedInpsIntegrazioniSalariali(): SourceHealth {
  const artifact = inpsIntegrazioniSalarialiMetadata.integrity.dataArtifact;
  return {
    ...baseHealth("inps-integrazioni-salariali"),
    reachability: "not-probed",
    freshness: freshnessFor("inps-integrazioni-salariali", inpsIntegrazioniSalarialiMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · integrazioni salariali ${inpsIntegrazioniSalarialiData.period.from} · ${inpsIntegrazioniSalarialiData.coverage.observedRows.toLocaleString("it-IT")} righe (lavoratori/domande/mensilità) · conteggi, non euro · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: inpsIntegrazioniSalarialiData.coverage.observedRows,
  };
}


function snapshotManagedInlVigilanza(): SourceHealth {
  const artifact = inlVigilanzaMetadata.integrity.dataArtifact;
  return {
    ...baseHealth("inl-vigilanza"),
    reachability: "not-probed",
    freshness: freshnessFor("inl-vigilanza", inlVigilanzaMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · vigilanza INL ${inlVigilanzaData.period.from} · ${inlVigilanzaData.coverage.observedRows.toLocaleString("it-IT")} righe · ${inlVigilanzaData.coverage.territories} territori · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: inlVigilanzaData.coverage.observedRows,
  };
}

function snapshotManagedInpsCigFondiSolidarieta(): SourceHealth {
  const artifact = inpsCigFondiSolidarietaMetadata.integrity.dataArtifact;
  return {
    ...baseHealth("inps-cig-fondi-solidarieta"),
    reachability: "not-probed",
    freshness: freshnessFor("inps-cig-fondi-solidarieta", inpsCigFondiSolidarietaMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · CIG Fondi di Solidarietà ${inpsCigFondiSolidarietaData.period.from}-${inpsCigFondiSolidarietaData.period.to} · ${inpsCigFondiSolidarietaData.coverage.observedRows.toLocaleString("it-IT")} righe · ore autorizzate, non euro · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: inpsCigFondiSolidarietaData.coverage.observedRows,
  };
}

function snapshotManagedIstatEpea(): SourceHealth {
  const { source, edition, referencePeriod } = istatEpeaMetadata;
  return {
    ...baseHealth("istat-epea"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-epea", source.acquiredAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · EPEA protezione ambiente ${referencePeriod.from}-${referencePeriod.to} (edizione ${edition}, ${source.dataflowId}) · ${istatEpeaData.rows.length.toLocaleString("it-IT")} osservazioni · ${source.bytes.toLocaleString("it-IT")} byte CSV pinnato.`,
    recordCount: istatEpeaData.rows.length,
  };
}

function snapshotManagedMefIva(): SourceHealth {
  const publicationDate = mefIvaData.tables.map((table) => table.publicationDate).sort().at(-1)!;
  return {
    ...baseHealth("mef-iva"),
    reachability: "not-probed",
    freshness: freshnessFor("mef-iva", publicationDate),
    latencyMs: null,
    detail: `Snapshot IVA dichiarazioni 2024–2025 (imposta 2023–2024): ${mefIvaMetadata.coverage.tables} tabelle e ${mefIvaMetadata.coverage.rows} righe per regione e attività, senza incrocio. Ultima pubblicazione ${publicationDate}; acquisito ${mefIvaMetadata.source.acquiredAt}; controllato ${mefIvaMetadata.source.checkedAt}.`,
    recordCount: mefIvaMetadata.coverage.rows,
  };
}

function snapshotManagedEuVatGapItaly(): SourceHealth {
  return {
    ...baseHealth("eu-vat-gap-italy"),
    reachability: "not-probed",
    freshness: freshnessFor("eu-vat-gap-italy", euVatGapItalyMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot DG TAXUD VAT gap Italia ${euVatGapItalyData.period.from}–${euVatGapItalyData.period.to} (2024 stima rapida): ${euVatGapItalyMetadata.coverage.years} anni, ${euVatGapItalyMetadata.coverage.coreMeasures} misure core e ${euVatGapItalyMetadata.coverage.compositionRows} componenti VTTL. Pubblicato ${euVatGapItalyMetadata.source.publicationDate}; acquisito ${euVatGapItalyMetadata.source.acquiredAt}; controllato ${euVatGapItalyMetadata.source.checkedAt}.`,
    recordCount: euVatGapItalyMetadata.coverage.years,
  };
}

function snapshotManagedMefTaxGapNazionale(): SourceHealth {
  return {
    ...baseHealth("mef-tax-gap-nazionale"),
    reachability: "not-probed",
    freshness: freshnessFor("mef-tax-gap-nazionale", mefTaxGapNazionaleMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot MEF tax gap nazionale ${mefTaxGapNazionaleData.period.from}–${mefTaxGapNazionaleData.period.to} (Tab. I.1/I.2 Relazione 2025): ${mefTaxGapNazionaleMetadata.coverage.taxRows} voci e ${mefTaxGapNazionaleMetadata.coverage.years} anni. Versione file ${mefTaxGapNazionaleMetadata.source.versionDate}; data di pubblicazione non verificata; acquisito ${mefTaxGapNazionaleMetadata.source.acquiredAt}; controllato ${mefTaxGapNazionaleMetadata.source.checkedAt}.`,
    recordCount: mefTaxGapNazionaleMetadata.coverage.taxRows * mefTaxGapNazionaleMetadata.coverage.years,
  };
}

function snapshotManagedEurostatTaxag(): SourceHealth {
  return {
    ...baseHealth("eurostat-taxag"),
    reachability: "not-probed",
    freshness: freshnessFor("eurostat-taxag", eurostatTaxagMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot Eurostat gov_10a_taxag ${eurostatTaxagData.period.from}–${eurostatTaxagData.period.to}: ${eurostatTaxagData.coverage.publishedItems} voci, ${eurostatTaxagData.coverage.observedCells} celle osservate su ${eurostatTaxagData.coverage.totalCells}. Pubblicato ${eurostatTaxagMetadata.source.publicationDate}; acquisito ${eurostatTaxagMetadata.source.acquiredAt}; controllato ${eurostatTaxagMetadata.source.checkedAt}.`,
    recordCount: eurostatTaxagData.coverage.observedCells,
  };
}

function snapshotManagedEurostatShaHealth(): SourceHealth {
  return {
    ...baseHealth("eurostat-sha-health"),
    reachability: "not-probed",
    freshness: freshnessFor("eurostat-sha-health", eurostatShaHealthMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot Eurostat SHA hlth_sha11_hf ${eurostatShaHealthData.period.from}–${eurostatShaHealthData.period.to}: ${eurostatShaHealthData.coverage.publishedSchemes} schemi e ${eurostatShaHealthData.coverage.observedCells} celle (2025 provvisorio). Pubblicato ${eurostatShaHealthMetadata.source.publicationDate}; acquisito ${eurostatShaHealthMetadata.source.acquiredAt}; controllato ${eurostatShaHealthMetadata.source.checkedAt}.`,
    recordCount: eurostatShaHealthData.coverage.observedCells,
  };
}

function snapshotManagedMefIrpefDettaglio(): SourceHealth {
  const artifact = mefIrpefDettaglioMetadata.integrity.dataArtifact;
  const { observedFiles, observedRows, emptyCells } = mefIrpefDettaglioData.coverage;
  return {
    ...baseHealth("mef-irpef-dettaglio"),
    reachability: "not-probed",
    freshness: freshnessFor("mef-irpef-dettaglio", mefIrpefDettaglioMetadata.observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · dettaglio IRPEF dichiarazioni ${mefIrpefDettaglioData.period.from}-${mefIrpefDettaglioData.period.to}, anni di imposta ${mefIrpefDettaglioData.taxPeriod.from}-${mefIrpefDettaglioData.taxPeriod.to} · ${observedFiles} file su nove famiglie, ${observedRows.toLocaleString("it-IT")} righe e ${emptyCells.toLocaleString("it-IT")} celle vuote distinte dagli zeri · ${artifact.bytes.toLocaleString("it-IT")} byte.`,
    recordCount: observedRows,
  };
}

function snapshotManagedIstatPoverta(): SourceHealth {
  const { source, period, observedAt } = istatPovertaMetadata;
  const asset = Object.values(source.assets)[0];
  return {
    ...baseHealth("istat-poverta"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-poverta", observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · povertà assoluta ${period.from}-${period.to} (serie corrente post-revisione, ${source.dataflowId}) · ${istatPovertaData.observations.length.toLocaleString("it-IT")} osservazioni su ${istatPovertaData.territories.length} territori e ${istatPovertaData.measures.length} misure · ${asset.bytes.toLocaleString("it-IT")} byte CSV pinnato. Non è spesa pubblica.`,
    recordCount: istatPovertaData.observations.length,
  };
}

function snapshotManagedIstatPovertaRelativa(): SourceHealth {
  const { source, period, observedAt } = istatPovertaRelativaMetadata;
  const asset = Object.values(source.assets)[0];
  return {
    ...baseHealth("istat-poverta-relativa"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-poverta-relativa", observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · povertà relativa ${period.from}-${period.to} (serie corrente post-revisione, ${source.dataflowId}) · ${istatPovertaRelativaData.observations.length.toLocaleString("it-IT")} osservazioni su ${istatPovertaRelativaData.territories.length} territori e ${istatPovertaRelativaData.measures.length} misure · ${asset.bytes.toLocaleString("it-IT")} byte CSV pinnato. Non è spesa pubblica e non si somma alla povertà assoluta.`,
    recordCount: istatPovertaRelativaData.observations.length,
  };
}

function snapshotManagedIstatBesEconomico(): SourceHealth {
  const { source, observedAt } = istatBesMetadata;
  const asset = Object.values(source.assets)[0];
  const provinces = istatBesData.territories.filter((entry) => entry.kind === "provincia").length;
  return {
    ...baseHealth("istat-bes-economico"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-economico", observedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · BES dei territori, benessere economico (edizione ${istatBesData.domain.edition}, ${source.dataflowId}) · ${istatBesData.observations.length.toLocaleString("it-IT")} osservazioni su ${istatBesData.indicators.length} indicatori e ${istatBesData.territories.length} territori, di cui ${provinces} province · ${asset.bytes.toLocaleString("it-IT")} byte CSV pinnato. Medie pro capite, non spesa pubblica e non sommabili fra territori.`,
    recordCount: istatBesData.observations.length,
  };
}

function snapshotManagedIstatBesSalute(): SourceHealth {
  const { source } = istatBesSaluteMetadata;
  return {
    ...baseHealth("istat-bes-salute"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-salute", source.publicationDate),
    latencyMs: null,
    detail: "BES Salute, edizione 2025: 46.157 osservazioni, sei indicatori e 135 territori, di cui 107 province. Periodi e unità distinti per indicatore; una cella statisticamente non significativa. Non è spesa pubblica né dato comunale.",
    recordCount: istatBesSaluteData.observations.length,
  };
}

function snapshotManagedIstatBesIstruzione(): SourceHealth {
  const { source } = istatBesIstruzioneMetadata;
  return {
    ...baseHealth("istat-bes-istruzione"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-istruzione", source.publicationDate),
    latencyMs: null,
    detail: "Nove indicatori BES_02 Istruzione e formazione, edizione 2025; 14.952 osservazioni e 139 territori, di cui 111 province. Periodi e disponibilità per sesso distinti per indicatore fra 2004 e 2024. Non è spesa pubblica né dato comunale; 76 celle ignote.",
    recordCount: istatBesIstruzioneData.observations.length,
  };
}

function snapshotManagedIstatBesLavoro(): SourceHealth {
  const { source } = istatBesLavoroMetadata;
  return {
    ...baseHealth("istat-bes-lavoro"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-lavoro", source.publicationDate),
    latencyMs: null,
    detail: "Sei indicatori BES_03 Lavoro e conciliazione, edizione 2025; 19.120 osservazioni e 135 territori, di cui 107 province. Periodi distinti fra 2008 e 2024; 122 celle ignote. Tassi non sommabili, non spesa pubblica né dato comunale.",
    recordCount: istatBesLavoroData.observations.length,
  };
}

function snapshotManagedIstatBesRelazioni(): SourceHealth {
  const { source } = istatBesRelazioniMetadata;
  return {
    ...baseHealth("istat-bes-relazioni"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-relazioni", source.publicationDate),
    latencyMs: null,
    detail: "Due indicatori BES_05 Relazioni sociali, edizione 2025; 1.330 osservazioni e 135 territori, di cui 107 province. Periodi distinti fra 2011 e 2024; 8 celle non significative. Solo SEX=T; indicatori non sommabili, non spesa pubblica né dato comunale.",
    recordCount: istatBesRelazioniData.observations.length,
  };
}

function snapshotManagedIstatBesPolitica(): SourceHealth {
  const { source } = istatBesPoliticaMetadata;
  return {
    ...baseHealth("istat-bes-politica"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-politica", source.publicationDate),
    latencyMs: null,
    detail: "Sette indicatori BES_06 Politica e istituzioni, edizione 2025; 15.818 osservazioni e 139 territori, di cui 111 province. Periodi distinti fra 2004 e 2024; 2.115 celle senza valore. Solo SEX=T; indicatori non sommabili, non spesa pubblica né dato comunale.",
    recordCount: istatBesPoliticaData.observations.length,
  };
}

function snapshotManagedIstatBesSicurezza(): SourceHealth {
  const { source } = istatBesSicurezzaMetadata;
  return {
    ...baseHealth("istat-bes-sicurezza"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-sicurezza", source.publicationDate),
    latencyMs: null,
    detail: "Sei indicatori BES_07 Sicurezza, edizione 2025; 14.481 osservazioni e 139 territori, di cui 111 province. Periodi distinti fra 2004 e 2023; 1 cella ignota. Solo SEX=T; indicatori non sommabili, non spesa COFOG GF03 né dato comunale.",
    recordCount: istatBesSicurezzaData.observations.length,
  };
}

function snapshotManagedIstatBesPaesaggio(): SourceHealth {
  const { source } = istatBesPaesaggioMetadata;
  return {
    ...baseHealth("istat-bes-paesaggio"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-paesaggio", source.publicationDate),
    latencyMs: null,
    detail: "Tre indicatori BES_09 Paesaggio e patrimonio culturale, edizione 2025; 3.760 osservazioni e 139 territori, di cui 111 province. Periodi distinti fra 2004 e 2023; 3 celle non disponibili. Solo SEX=T; indicatori non sommabili, non spesa pubblica né dato comunale.",
    recordCount: istatBesPaesaggioData.observations.length,
  };
}

function snapshotManagedIstatBesServizi(): SourceHealth {
  const { source } = istatBesServiziMetadata;
  return {
    ...baseHealth("istat-bes-servizi"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-bes-servizi", source.publicationDate),
    latencyMs: null,
    detail: "Otto indicatori BES_12 Qualità dei servizi, edizione 2025; 15.858 osservazioni e 139 territori, di cui 111 province. Periodi distinti fra 2004 e 2024; 76 celle non disponibili. Solo SEX=T; indicatori non sommabili, non spesa pubblica né dato comunale.",
    recordCount: istatBesServiziData.observations.length,
  };
}

function snapshotManagedGovernmentScorecard(
  sourceId: "ameco" | "governi-presidenza",
): SourceHealth {
  const snapshot = getGovernmentScorecardSourceSummary();
  const isAmeco = sourceId === "ameco";

  return {
    ...baseHealth(sourceId),
    reachability: "not-probed",
    freshness: freshnessFor(sourceId, isAmeco ? snapshot.retrievedAt : snapshot.chronologyVerifiedAt),
    latencyMs: null,
    detail: isAmeco
      ? `Snapshot ${snapshot.release} verificato · osservazioni fino al ${snapshot.observedThrough} · previsioni ${snapshot.forecastFrom}-${snapshot.forecastThrough} escluse dal voto.`
      : `Cronologia Quirinale verificata · ${snapshot.governmentCount} governi dal ${snapshot.firstGovernmentYear} · mandato corrente identificato esplicitamente.`,
    recordCount: isAmeco ? snapshot.observedCells : snapshot.governmentCount,
  };
}

const SNAPSHOT_ADAPTERS: Partial<Record<SourceId, () => SourceHealth>> = {
  ameco: () => snapshotManagedGovernmentScorecard("ameco"),
  "governi-presidenza": () => snapshotManagedGovernmentScorecard("governi-presidenza"),
  anac: snapshotManagedAnac,
  inps: snapshotManagedInps,
  cpt: snapshotManagedCpt,
  "mef-irpef": snapshotManagedMefIrpef,
  istat: snapshotManagedIstat,
  "istat-casellario-pensioni": snapshotManagedIstatCasellarioPensioni,
  consip: snapshotManagedConsip,
  opencoesione: snapshotManagedOpenCoesione,
  italiadomani: snapshotManagedPnrr,
  opencivitas: snapshotManagedOpenCivitas,
  consulenti: snapshotManagedConsulenti,
  camera: snapshotManagedCamera,
  senato: snapshotManagedSenate,
  pcm: snapshotManagedPcm,
  "partecipazioni-pubbliche": snapshotManagedMefParticipations,
  bancaditalia: () => snapshotManagedPublicDebt("bancaditalia"),
  eurostat: () => snapshotManagedPublicDebt("eurostat"),
  "eurostat-hicp": snapshotManagedEurostatHicp,
  "eurostat-gdp": snapshotManagedEurostatGdp,
  "oecd-taxing-wages": snapshotManagedOecdTaxingWages,
  "eurostat-cofog": snapshotManagedEurostatCofog,
  "eurostat-gov-main": snapshotManagedEurostatGovMain,
  "istat-cofog": snapshotManagedIstatCofog,
  "istat-epea": snapshotManagedIstatEpea,
  "istat-poverta": snapshotManagedIstatPoverta,
  "istat-poverta-relativa": snapshotManagedIstatPovertaRelativa,
  "istat-bes-economico": snapshotManagedIstatBesEconomico,
  "istat-bes-salute": snapshotManagedIstatBesSalute,
  "istat-bes-istruzione": snapshotManagedIstatBesIstruzione,
  "istat-bes-lavoro": snapshotManagedIstatBesLavoro,
  "istat-bes-relazioni": snapshotManagedIstatBesRelazioni,
  "istat-bes-politica": snapshotManagedIstatBesPolitica,
  "istat-bes-sicurezza": snapshotManagedIstatBesSicurezza,
  "istat-bes-paesaggio": snapshotManagedIstatBesPaesaggio,
  "istat-bes-servizi": snapshotManagedIstatBesServizi,
  "inps-naspi": snapshotManagedInpsNaspi,
  "inps-assegno-unico": snapshotManagedInpsAssegnoUnico,
  "inps-integrazioni-salariali": snapshotManagedInpsIntegrazioniSalariali,
  "inps-cig-fondi-solidarieta": snapshotManagedInpsCigFondiSolidarieta,
  "inl-vigilanza": snapshotManagedInlVigilanza,
  "mef-irpef-dettaglio": snapshotManagedMefIrpefDettaglio,
  "mef-iva": snapshotManagedMefIva,
  "eu-vat-gap-italy": snapshotManagedEuVatGapItaly,
  "mef-tax-gap-nazionale": snapshotManagedMefTaxGapNazionale,
  "eurostat-taxag": snapshotManagedEurostatTaxag,
  "eurostat-sha-health": snapshotManagedEurostatShaHealth,
};

export function buildSourceHealthSnapshots() {
  return SOURCE_IDS.flatMap((sourceId) => {
    const health = SNAPSHOT_ADAPTERS[sourceId]?.();
    if (!health) return [];
    return [{ sourceId, sourceTimestamp: health.freshness.sourceTimestamp,
      detail: health.detail, recordCount: health.recordCount }];
  });
}

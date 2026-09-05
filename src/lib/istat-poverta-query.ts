import type {
  IstatPovertaData,
  IstatPovertaMeasure,
  IstatPovertaMetadata,
  IstatPovertaObservation,
  IstatPovertaTerritory,
} from "@/lib/data/istat-poverta-contract";

/**
 * Motore di query condiviso fra le due famiglie di povertà (assoluta e relativa).
 *
 * I dati restano separati — ogni famiglia importa i propri artefatti e li valida
 * col proprio contratto — ma il modo di interrogarli è identico, e duplicarlo
 * significherebbe correggerlo due volte.
 */

export type IstatPovertaQuery = Readonly<{ territory?: string; year?: number; measure?: string }>;

export type IstatPovertaQueryResult = Readonly<{
  datasetId: string;
  period: IstatPovertaData["period"];
  caveats: readonly string[];
  scale: IstatPovertaData["scale"];
  flags: IstatPovertaData["flags"];
  measures: readonly IstatPovertaMeasure[];
  territories: readonly IstatPovertaTerritory[];
  observations: readonly IstatPovertaObservation[];
  reconciliation: IstatPovertaData["reconciliation"];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    dataflowId: string;
    licenseId: string;
    seriesNote: string;
    observedAt: string;
  }>;
}>;

export function createPovertaQuery(data: IstatPovertaData, metadata: IstatPovertaMetadata) {
  const territoryCodes = new Set(data.territories.map((entry) => entry.code));
  const measureCodes = new Set(data.measures.map((entry) => entry.code));
  const territoryList = [...territoryCodes].join(", ");

  const normalizeYear = (year: number | undefined): number | undefined => {
    if (year === undefined) return undefined;
    const { from, to } = data.period;
    if (!Number.isSafeInteger(year) || year < from || year > to) {
      throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
    }
    return year;
  };

  const normalizeTerritory = (territory: string | undefined): string | undefined => {
    if (territory === undefined) return undefined;
    const code = territory.toUpperCase();
    if (!territoryCodes.has(code)) {
      // Il dettaglio regionale non è pubblicato in questo dataflow: chi lo chiede
      // deve sapere che non esiste qui, non che ha sbagliato a scrivere.
      throw new Error(
        `Territorio non riconosciuto: questa serie è pubblicata solo per Italia e ripartizioni (${territoryList}).`,
      );
    }
    return code;
  };

  const normalizeMeasure = (measure: string | undefined): string | undefined => {
    if (measure === undefined) return undefined;
    const code = measure.toUpperCase();
    if (!measureCodes.has(code)) {
      throw new Error(
        `Misura non riconosciuta: usare uno dei codici pubblicati da ${data.datasetId}, per esempio ${data.measures[0].code}.`,
      );
    }
    return code;
  };

  return function query(input: IstatPovertaQuery = {}): IstatPovertaQueryResult {
    const territory = normalizeTerritory(input.territory);
    const year = normalizeYear(input.year);
    const measure = normalizeMeasure(input.measure);

    const observations = data.observations.filter(
      (observation) =>
        (territory === undefined || observation.territory === territory) &&
        (year === undefined || observation.year === year) &&
        (measure === undefined || observation.measure === measure),
    );

    return {
      datasetId: data.datasetId,
      period: data.period,
      caveats: data.caveats,
      scale: data.scale,
      flags: data.flags,
      // Le misure restano esposte anche quando se ne filtra una: unità e
      // sommabilità dichiarate servono a leggere il numero, non solo a trovarlo.
      measures: measure === undefined ? data.measures : data.measures.filter((entry) => entry.code === measure),
      territories:
        territory === undefined ? data.territories : data.territories.filter((entry) => entry.code === territory),
      observations,
      reconciliation: data.reconciliation,
      source: {
        owner: metadata.source.owner,
        landingUrl: metadata.source.landingUrl,
        dataflowId: metadata.source.dataflowId,
        licenseId: metadata.source.licenseId,
        seriesNote: metadata.source.seriesNote,
        observedAt: metadata.observedAt,
      },
    };
  };
}

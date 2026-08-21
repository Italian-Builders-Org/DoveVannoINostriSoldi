import { datasetCatalog, type DatasetQuery } from "@/lib/mcp/catalog";

const datasetFilters = new Map(datasetCatalog.map((dataset) => [dataset.id, new Set(dataset.filters)]));

function rejectUnsupportedFilters(query: DatasetQuery) {
  const supported = datasetFilters.get(query.dataset) ?? new Set<string>();
  const provided = Object.entries(query)
    .filter(([key, value]) => key !== "dataset" && value !== undefined)
    .map(([key]) => key);
  const unsupported = provided.filter((key) => !supported.has(key));
  if (unsupported.length > 0) {
    const accepted = [...supported];
    throw new Error(
      `Filtri non supportati per ${query.dataset}: ${unsupported.join(", ")}. ` +
      `Filtri ammessi: ${accepted.length > 0 ? accepted.join(", ") : "nessuno"}.`,
    );
  }
}

function rejectAmbiguousFilters(query: DatasetQuery) {
  if (query.dataset === "ipa_enti" && query.code !== undefined && query.query !== undefined) {
    throw new Error("Per ipa_enti usa code oppure query, non entrambi.");
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function requireText(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Il filtro ${label} è obbligatorio per questo dataset.`);
  return normalized;
}

function referencePeriod(query: DatasetQuery) {
  if (query.month !== undefined && query.year === undefined) {
    throw new Error("Per scegliere il mese devi indicare anche l’anno.");
  }
  return {
    year: query.year,
    month: query.month,
  };
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function queryPublicDataset(query: DatasetQuery): Promise<unknown> {
  rejectUnsupportedFilters(query);
  rejectAmbiguousFilters(query);
  const limit = boundedInteger(query.limit, 50, 1, 100);
  const offset = boundedInteger(query.offset, 0, 0, 100_000);

  switch (query.dataset) {
    case "siope_comuni": {
      const { availableSiopeYears, getSiopeMunicipalSnapshot } = await import("@/lib/siope-snapshot");
      const year = query.year ?? availableSiopeYears[0];
      if (!availableSiopeYears.includes(year)) {
        throw new Error(`Anno SIOPE non disponibile. Anni validi: ${availableSiopeYears.join(", ")}.`);
      }
      const snapshot = getSiopeMunicipalSnapshot(year);
      const region = query.region?.trim().toLocaleLowerCase("it-IT");
      if (!region) return jsonSafe(snapshot);
      return jsonSafe({
        ...snapshot,
        regions: snapshot.regions.filter((item) => item.region.toLocaleLowerCase("it-IT") === region),
        topMunicipalities: snapshot.topMunicipalities.filter((item) => item.region.toLocaleLowerCase("it-IT") === region),
        topMunicipalitiesByValue: snapshot.topMunicipalitiesByValue.filter((item) => item.region.toLocaleLowerCase("it-IT") === region),
        topMunicipalitiesByPerCapita: snapshot.topMunicipalitiesByPerCapita.filter((item) => item.region.toLocaleLowerCase("it-IT") === region),
        queryLimitations: {
          regionAggregateComplete: true,
          municipalityLists:
            "Sottoinsieme dei primi 100 Comuni nazionali per totale o pro capite, non elenco completo della regione.",
        },
      });
    }
    case "openbdap_spesa_stato": {
      const period = referencePeriod(query);
      const { getStateSpendingSnapshot } = await import("@/lib/bdap-payments");
      return jsonSafe(await getStateSpendingSnapshot(period));
    }
    case "openbdap_amministrazione": {
      const code = requireText(query.code, "code");
      const period = referencePeriod(query);
      const { getStateAdministrationSpending } = await import("@/lib/bdap-payments");
      return jsonSafe(await getStateAdministrationSpending(code, period));
    }
    case "openbdap_opere_pubbliche": {
      const cup = requireText(query.cup, "cup");
      const { getPublicWorksByCup } = await import("@/lib/bdap-public-works");
      return jsonSafe(await getPublicWorksByCup(cup));
    }
    case "opencivitas_fabbisogni": {
      const { openCivitasSnapshot } = await import("@/lib/opencivitas-snapshot");
      if (query.year && query.year !== openCivitasSnapshot.referenceYear) {
        throw new Error(`OpenCivitas è disponibile per il ${openCivitasSnapshot.referenceYear}.`);
      }
      const region = query.region?.trim().toLocaleUpperCase("it-IT");
      const code = query.code?.trim();
      const matches = openCivitasSnapshot.municipalities.filter((item) =>
        (!region || item.region === region) && (!code || item.istatCode === code));
      return jsonSafe({
        referenceYear: openCivitasSnapshot.referenceYear,
        publishedAt: openCivitasSnapshot.publishedAt,
        pagination: { total: matches.length, offset, limit, returned: matches.slice(offset, offset + limit).length },
        data: matches.slice(offset, offset + limit),
        coverage: openCivitasSnapshot.coverage,
        methodology: openCivitasSnapshot.methodology,
        provenance: openCivitasSnapshot.source,
      });
    }
    case "opencoesione_progetti": {
      const {
        deriveOpenCoesioneDimension,
        openCoesionePaymentCostRatio,
        openCoesioneSnapshot,
      } = await import("@/lib/opencoesione-snapshot");
      const derive = (items: typeof openCoesioneSnapshot.themes) =>
        items.map((item) =>
          deriveOpenCoesioneDimension(item, openCoesioneSnapshot.totals.publicCostCents),
        );
      return jsonSafe({
        ...openCoesioneSnapshot,
        derived: {
          paymentCostRatio: openCoesionePaymentCostRatio,
          themes: derive(openCoesioneSnapshot.themes),
          natures: derive(openCoesioneSnapshot.natures),
          statuses: derive(openCoesioneSnapshot.statuses),
          definitions: {
            costPaymentDifferenceCents:
              "Differenza contabile fra costo pubblico e pagamenti: non è debito né arretrato e può essere negativa.",
          },
          caveat:
            "Le medie per progetto sono rapporti contabili fra record eterogenei; non misurano qualità, risultato, completamento o irregolarità.",
        },
      });
    }
    case "anac_cig_snapshot": {
      const { getAnacCigSnapshot } = await import("@/lib/anac-cig-snapshot");
      return jsonSafe(getAnacCigSnapshot(query.year));
    }
    case "inps_invalidita_civile": {
      const { queryInpsCivilInvalidity } = await import("@/lib/inps-invalidity-snapshot");
      return jsonSafe(queryInpsCivilInvalidity({ year: query.year, region: query.region }));
    }
    case "cpt_finanza_regionale": {
      const { queryCptRegionalFiscal } = await import("@/lib/cpt-regional-fiscal-snapshot");
      return jsonSafe(queryCptRegionalFiscal({ year: query.year, region: query.region }));
    }
    case "mef_irpef_comunale": {
      const { queryMefMunicipalIrpef } = await import("@/lib/mef-irpef-snapshot");
      return jsonSafe(queryMefMunicipalIrpef({
        year: query.year,
        level: query.level,
        region: query.region,
        province: query.province,
        code: query.code,
        query: query.query,
        limit: query.limit,
        offset: query.offset,
      }));
    }
    case "ipa_enti": {
      const { getIpaEntityByCode, searchIpaEntities } = await import("@/lib/ipa");
      if (query.code?.trim()) {
        const record = await getIpaEntityByCode(query.code.trim());
        return jsonSafe({ record, found: record !== null });
      }
      return jsonSafe(await searchIpaEntities({ query: query.query, limit, offset }));
    }
    case "ipa_struttura": {
      const code = requireText(query.code, "code");
      const { getIpaOrganizationStructure } = await import("@/lib/ipa-structure");
      return jsonSafe(await getIpaOrganizationStructure(code, limit, offset));
    }
    case "mef_partecipazioni": {
      const { mefParticipationsSnapshot } = await import("@/lib/mef-participations-snapshot");
      return jsonSafe(mefParticipationsSnapshot);
    }
    case "consulenti_incarichi": {
      const { consulentiSnapshot } = await import("@/lib/consulenti-snapshot");
      const year = query.year;
      const filterYear = <T extends { year: number }>(items: T[]) => year ? items.filter((item) => item.year === year) : items;
      return jsonSafe({
        ...consulentiSnapshot,
        externalAppointments: filterYear(consulentiSnapshot.externalAppointments),
        employeeAppointments: filterYear(consulentiSnapshot.employeeAppointments),
      });
    }
    case "parlamento_bilanci": {
      const { parliamentSnapshot } = await import("@/lib/parliament-snapshot");
      return jsonSafe({
        ...parliamentSnapshot,
        chambers: parliamentSnapshot.chambers
          .filter((item) => !query.chamber || item.id === query.chamber)
          .map((item) => ({ ...item, statements: item.statements.filter((statement) => !query.year || statement.year === query.year) }))
          .filter((item) => item.statements.length > 0),
      });
    }
    case "controlli_segnali": {
      const {
        auditClassifications,
        auditMethodology,
        auditReviewedAt,
        auditSignals,
        procurementComparisons,
      } = await import("@/lib/audit-data");
      const area = query.area?.trim().toLocaleLowerCase("it-IT");
      return jsonSafe({
        reviewedAt: auditReviewedAt,
        signals: auditSignals.filter((signal) =>
          (!area || signal.area.toLocaleLowerCase("it-IT") === area) &&
          (!query.year || signal.referenceDate.startsWith(String(query.year)))),
        classifications: auditClassifications,
        procurementComparisons,
        methodology: auditMethodology,
      });
    }
    case "registro_fonti": {
      const { publicSources } = await import("@/lib/sources");
      const term = query.query?.trim().toLocaleLowerCase("it-IT");
      return jsonSafe(publicSources.filter((source) => !term || [source.name, source.owner, source.area, source.note]
        .some((value) => value.toLocaleLowerCase("it-IT").includes(term))));
    }
    default: {
      const unsupported: never = query.dataset;
      throw new Error(`Dataset non supportato: ${String(unsupported)}.`);
    }
  }
}

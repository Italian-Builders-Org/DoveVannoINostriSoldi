import { datasetCatalog, type DatasetQuery } from "@/lib/mcp/catalog";
import {
  formatRegionNotFoundError,
  resolveCanonicalRegionName,
  resolveOpenCivitasRegionName,
} from "@/lib/region-query";

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

export async function queryPublicDataset(
  query: DatasetQuery,
  options: { signal?: AbortSignal } = {},
): Promise<unknown> {
  rejectUnsupportedFilters(query);
  rejectAmbiguousFilters(query);
  const limit = boundedInteger(query.limit, 50, 1, 100);
  const offset = boundedInteger(query.offset, 0, 0, 100_000);

  switch (query.dataset) {
    case "siope_comuni": {
      const { availableSiopeYears, getSiopeMunicipalSnapshot } = await import("@/lib/siope-snapshot");
      const { getSiopeMunicipalityPeerObservations } = await import("@/lib/siope-municipality-detail");
      const { getRegionGeography, eurosPerSquareKilometreCents, municipalityGeographySource } = await import("@/lib/municipality-geography");
      const { istatCodeOfRegion } = await import("@/lib/italy-regions");
      const year = query.year ?? availableSiopeYears[0];
      if (!availableSiopeYears.includes(year)) {
        throw new Error(`Anno SIOPE non disponibile. Anni validi: ${availableSiopeYears.join(", ")}.`);
      }
      const snapshot = getSiopeMunicipalSnapshot(year);
      const territorialNormalization = {
        source: municipalityGeographySource,
        regions: snapshot.regions.map((item) => {
          const code = istatCodeOfRegion(item.region);
          const geography = code ? getRegionGeography(year, code) : null;
          return {
            region: item.region,
            geography,
            perSquareKmCents: eurosPerSquareKilometreCents(
              Math.round(item.value * 100),
              geography?.surfaceSquareMetres ?? null,
            ),
          };
        }),
        topMunicipalitiesByPerSquareKm: getSiopeMunicipalityPeerObservations(year)
          .slice()
          .sort((left, right) => right.perSquareKmCents - left.perSquareKmCents)
          .slice(0, 100),
        caveat: "La misura per km² è descrittiva e non misura efficienza, qualità o fabbisogno.",
      };
      const regionInput = query.region?.trim();
      if (!regionInput) return jsonSafe({ ...snapshot, territorialNormalization });
      const canonicalRegion = resolveCanonicalRegionName(regionInput);
      if (!canonicalRegion) {
        throw new Error(formatRegionNotFoundError(regionInput));
      }
      const matchesRegion = (item: { region: string }) => item.region === canonicalRegion;
      const filteredRegions = snapshot.regions.filter(matchesRegion);
      if (filteredRegions.length === 0) {
        throw new Error(formatRegionNotFoundError(regionInput));
      }
      const { distribution: nationalDistribution, ...snapshotWithoutDistribution } = snapshot;
      return jsonSafe({
        ...snapshotWithoutDistribution,
        regions: filteredRegions,
        topMunicipalities: snapshot.topMunicipalities.filter(matchesRegion),
        topMunicipalitiesByValue: snapshot.topMunicipalitiesByValue.filter(matchesRegion),
        topMunicipalitiesByPerCapita: snapshot.topMunicipalitiesByPerCapita.filter(matchesRegion),
        regionFilter: {
          requested: regionInput,
          resolved: canonicalRegion,
          matched: true,
        },
        queryLimitations: {
          regionAggregateComplete: false,
          regionAggregateCompleteDeprecated:
            "Campo legacy: false perché il totale nazionale include pagamenti non regionalizzabili. Usare regionAggregateCompleteWithinIpaJoin e regionAggregateCoverage.",
          regionAggregateCompleteWithinIpaJoin: true,
          regionAggregateCoverage:
            `Il totale nazionale include anche ${snapshot.coverage.withoutRegion} Comuni con movimenti senza Regione IPA, pari a ${snapshot.coverage.paymentsWithoutRegion} euro; non vengono distribuiti artificialmente tra le Regioni.`,
          municipalityLists:
            "Sottoinsieme dei primi 100 Comuni nazionali per totale o pro capite, non elenco completo della regione.",
          distribution:
            `La distribuzione completa ${nationalDistribution.period.year} è disponibile soltanto nella risposta nazionale senza filtro regione; qui l'aggregato regionale è in regions.`,
        },
        territorialNormalization: {
          ...territorialNormalization,
          regions: territorialNormalization.regions.filter((item) => item.region === canonicalRegion),
          topMunicipalitiesByPerSquareKm: territorialNormalization.topMunicipalitiesByPerSquareKm.filter((item) => item.region === canonicalRegion),
        },
      });
    }
    case "openbdap_spesa_stato": {
      const period = referencePeriod(query);
      const { getStateSpendingSnapshot } = await import("@/lib/bdap-payments");
      return jsonSafe(await getStateSpendingSnapshot({ ...period, signal: options.signal }));
    }
    case "openbdap_amministrazione": {
      const code = requireText(query.code, "code");
      const period = referencePeriod(query);
      const { getStateAdministrationSpending } = await import("@/lib/bdap-payments");
      return jsonSafe(await getStateAdministrationSpending(code, { ...period, signal: options.signal }));
    }
    case "openbdap_opere_pubbliche": {
      const cup = requireText(query.cup, "cup");
      const { getPublicWorksByCup } = await import("@/lib/bdap-public-works");
      return jsonSafe(await getPublicWorksByCup(cup, { signal: options.signal }));
    }
    case "openbdap_ssn_conto_economico": {
      const { querySsnCce } = await import("@/lib/ssn-cce-snapshot");
      return jsonSafe(querySsnCce({
        year: query.year,
        region: query.region,
        code: query.code,
        limit: query.limit,
        offset: query.offset,
      }));
    }
    case "openbdap_ssn_storico_nazionale": {
      const { getSsnNationalHistory } = await import("@/lib/ssn-national-history");
      return jsonSafe(await getSsnNationalHistory({ signal: options.signal }));
    }
    case "openbdap_spesa_legislature": {
      const { getLegislatureSpendingCycles } = await import("@/lib/state-spending-legislature");
      return jsonSafe({ cycles: await getLegislatureSpendingCycles({ signal: options.signal }) });
    }
    case "openbdap_legge_bilancio_storico": {
      const { getBudgetLawMissionSeries } = await import("@/lib/bdap-legge-bilancio");
      return jsonSafe(
        await getBudgetLawMissionSeries({ windowYears: query.years, signal: options.signal }),
      );
    }
    case "opencivitas_fabbisogni": {
      const { openCivitasSnapshot } = await import("@/lib/opencivitas-snapshot");
      if (query.year && query.year !== openCivitasSnapshot.referenceYear) {
        throw new Error(`OpenCivitas è disponibile per il ${openCivitasSnapshot.referenceYear}.`);
      }
      const regionInput = query.region?.trim();
      const region = regionInput ? resolveOpenCivitasRegionName(regionInput) : null;
      if (regionInput && !region) {
        throw new Error(formatRegionNotFoundError(regionInput));
      }
      const code = query.code?.trim();
      const matches = openCivitasSnapshot.municipalities.filter((item) =>
        (!region || item.region === region) && (!code || item.istatCode === code));
      if (region && matches.length === 0) {
        throw new Error(formatRegionNotFoundError(regionInput!));
      }
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
    case "pnrr_asili": {
      const { queryPnrrChildcare } = await import("@/lib/pnrr-childcare-snapshot");
      return jsonSafe(queryPnrrChildcare({
        cup: query.cup,
        query: query.query,
        region: query.region,
        province: query.province,
        limit: query.limit,
        offset: query.offset,
      }));
    }
    case "anac_cig_snapshot": {
      const { getAnacCigSnapshot } = await import("@/lib/anac-cig-snapshot");
      return jsonSafe(getAnacCigSnapshot(query.year));
    }
    case "inps_invalidita_civile": {
      const { queryInpsCivilInvalidity } = await import("@/lib/inps-invalidity-snapshot");
      return jsonSafe(queryInpsCivilInvalidity({ year: query.year, region: query.region }));
    }
    case "inps_pensioni_vigenti": {
      const { queryInpsPensionsOsservatorio } = await import("@/lib/inps-pensions-snapshot");
      return jsonSafe(queryInpsPensionsOsservatorio());
    }
    case "istat_pensioni_prestazioni":
    case "istat_pensionati_persone": {
      const { queryIstatPensions } = await import("@/lib/istat-pensions-snapshot");
      const result = queryIstatPensions({ year: query.year });
      const { pensionBenefits, pensioners, ...shared } = result;
      return query.dataset === "istat_pensioni_prestazioni"
        ? jsonSafe({ ...shared, dataset: query.dataset, pensionBenefits })
        : jsonSafe({ ...shared, dataset: query.dataset, pensioners });
    }
    case "eurostat_cofog": {
      const { queryEurostatCofog } = await import("@/lib/eurostat-cofog-snapshot");
      return jsonSafe({
        dataset: query.dataset,
        ...queryEurostatCofog({ geo: query.country, year: query.year, function: query.cofog }),
      });
    }
    case "istat_cofog": {
      const { queryIstatCofog } = await import("@/lib/istat-cofog-snapshot");
      return jsonSafe({
        dataset: query.dataset,
        ...queryIstatCofog({ area: query.territory, year: query.year, function: query.cofog }),
      });
    }
    case "consip_ordini": {
      const { queryConsipOrdini } = await import("@/lib/consip-ordini-snapshot");
      return jsonSafe({ dataset: query.dataset, ...queryConsipOrdini({ year: query.year, channel: query.channel }) });
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
        detail: query.detail,
        limit: query.limit,
        offset: query.offset,
      }));
    }
    case "ipa_enti": {
      const { getIpaEntityByCode, searchIpaEntities } = await import("@/lib/ipa");
      if (query.code?.trim()) {
        const record = await getIpaEntityByCode(query.code.trim(), options.signal);
        return jsonSafe({ record, found: record !== null });
      }
      return jsonSafe(await searchIpaEntities({ query: query.query, limit, offset, signal: options.signal }));
    }
    case "ipa_struttura": {
      const code = requireText(query.code, "code");
      const { getIpaOrganizationStructure } = await import("@/lib/ipa-structure");
      return jsonSafe(await getIpaOrganizationStructure(code, limit, offset, { signal: options.signal }));
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
      const { queryOpenCivitasSpendingOutliers } = await import("@/lib/opencivitas-outliers");
      const area = query.area?.trim().toLocaleLowerCase("it-IT");
      const result: Record<string, unknown> = {
        reviewedAt: auditReviewedAt,
        signals: auditSignals.filter((signal) =>
          (!area || signal.area.toLocaleLowerCase("it-IT") === area) &&
          (!query.year || signal.referenceDate.startsWith(String(query.year)))),
        classifications: auditClassifications,
        procurementComparisons,
        methodology: auditMethodology,
      };
      if (area === "spesa-comuni") {
        result.spendingOutliers = queryOpenCivitasSpendingOutliers({
          year: query.year,
          region: query.region,
          limit: query.limit,
          offset: query.offset,
        });
      }
      return jsonSafe(result);
    }
    case "debito_pubblico_italiano": {
      const { getPublicDebtView } = await import("@/lib/public-debt");
      return jsonSafe(getPublicDebtView());
    }
    case "registro_fonti": {
      const { publicSources } = await import("@/lib/sources");
      const term = query.query?.trim().toLocaleLowerCase("it-IT");
      return jsonSafe(publicSources.filter((source) => !term || [source.name, source.owner, source.area, source.note]
        .some((value) => value.toLocaleLowerCase("it-IT").includes(term))));
    }
    case "spesa_pa_dettaglio": {
      const code = requireText(query.code, "code");
      const { selectIntegratedDataset } = await import("@/lib/integrated-public-view");
      return jsonSafe(await selectIntegratedDataset({
        datasetId: code,
        q: query.query,
        limit,
        offset: query.offset,
        cursor: query.cursor,
        signal: options.signal,
      }));
    }
    case "company_active_enterprises":
    case "company_workforce":
    case "company_production_value_bands": {
      const { queryCompanyAtlasDataset } = await import("@/lib/company-atlas");
      return jsonSafe(queryCompanyAtlasDataset({
        dataset: query.dataset,
        period: query.period,
        region: query.region,
        sector: query.sector,
        band: query.band,
        limit,
        offset,
      }));
    }
    case "company_turnover_istat": {
      const { queryIstatTurnoverDataset } = await import("@/lib/istat-turnover");
      return jsonSafe(queryIstatTurnoverDataset({
        period: query.period,
        region: query.region,
        sector: query.sector,
        limit,
        offset,
      }));
    }
    case "education_students_by_pathway": {
      const { queryEducationAtlasDataset } = await import("@/lib/education-atlas");
      return jsonSafe(queryEducationAtlasDataset({
        dataset: query.dataset,
        period: query.period,
        region: query.region,
        schoolType: query.schoolType,
        pathway: query.pathway,
        limit,
        offset,
      }));
    }
    default: {
      const unsupported: never = query.dataset;
      throw new Error(`Dataset non supportato: ${String(unsupported)}.`);
    }
  }
}

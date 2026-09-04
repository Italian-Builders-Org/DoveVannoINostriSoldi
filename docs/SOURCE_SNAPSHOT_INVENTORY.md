# Inventario degli snapshot pubblicati

Inventario operativo richiesto da [#189](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/189).
Non è la cadenza dichiarata dalla fonte: quella resta in
[FRESHNESS_AND_REFRESH.md](FRESHNESS_AND_REFRESH.md).
Qui si vede, per ogni artefatto committato: periodo nello snapshot,
URL ufficiale, controlli, workflow, modo di aggiornamento e rollback.

Questo file è generato da `scripts/ci/source-snapshot-inventory.py`.
Dopo una modifica al registro o a un workflow di refresh:

```bash
python3 scripts/ci/source-snapshot-inventory.py --write
```

## Criterio di completamento

Un aggiornamento nuovo deve essere rilevato, rigenerato, validato e
proposto in PR senza modifiche manuali. Un errore della fonte deve
fallire in modo visibile, senza pubblicare dati parziali. Nessun
workflow scrive su `main`.

## Riepilogo

- Artefatti nel registro: 39
- PR automatica: 8 (data bot, branch `automation/data/*`, PR)
- solo rilevamento: 3 (controlla l'upstream, non pubblica)
- invalidazione cache: 3 (invalida tag, non tocca gli snapshot)
- manuale: 25 (PR umana dopo revisione)

## Rollback per modo

- **PR automatica.** Chiudere o revertire la PR del data bot. `main` resta sull'ultimo snapshot valido. Nessun push diretto su `main`.
- **solo rilevamento.** Il job fallisce e non riscrive i file. Resta pubblicato lo snapshot già committato.
- **invalidazione cache.** Non pubblica snapshot. Se il job fallisce la cache resta quella precedente fino al prossimo tentativo.
- **manuale.** PR umana dopo revisione di hash, schema e periodo. Rollback: revert del merge.

Responsabile operativo dei refresh automatici: GitHub App data bot
(`DATA_BOT_APP_CLIENT_ID` nell'environment `source-operations`).
La revisione e il merge restano umani.

## Artefatti

| Artefatto | Periodo nello snapshot | Osservazione | URL ufficiale | Controllo DVNS | Workflow | Modo | Validazione |
|---|---|---|---|---|---|---|---|
| `anac-awardees-coverage` | 2026-01-23 | 2026-08-30T18:30:00Z | https://dati.anticorruzione.it/opendata/dataset/aggiudicatari | nessuno | nessuno | manuale | `python3 scripts/etl/anac_awardees_coverage.py --check` |
| `anac-entity-procurement-coverage` | 2026-08-06T07:31:40Z | 2026-08-30T21:30:00Z | https://dati.anticorruzione.it/opendata/dataset/stazioni-appaltanti | nessuno | nessuno | manuale | `python3 scripts/etl/anac_entity_procurement_coverage.py --check` |
| `anac-entity-procurement-page` | non dichiarato nello snapshot | 2026-08-31T14:49:08Z | non dichiarato nel registro | nessuno | nessuno | manuale | `python3 scripts/etl/anac_entity_procurement_page.py --check` |
| `consulenti-pubblici` | 2026 | 2026-08-25T13:30:46Z | https://consulentipubblici.dfp.gov.it/progetto | `37 */6 * * *` | `.github/workflows/consulenti-refresh.yml` | PR automatica | `python scripts/etl/consulenti_snapshot.py --check` |
| `cpt-regional-fiscal` | non dichiarato nello snapshot | non dichiarato | non dichiarato nel registro | nessuno | nessuno | manuale | suite ETL |
| `indire-pnrr-assignments` | aggiornamento aprile 2026 | 2026-08-23 | non dichiarato nel registro | nessuno | nessuno | manuale | `python scripts/etl/indire_pnrr_assignments.py --validate-committed` |
| `inps-civil-invalidity` | non dichiarato nello snapshot | 2026-08-20T22:30:00+02:00 | non dichiarato nel registro | nessuno | nessuno | manuale | test Node |
| `inps-pensions-osservatorio` | non dichiarato nello snapshot | 2026-09-01T12:00:00+02:00 | non dichiarato nel registro | nessuno | nessuno | manuale | test Node |
| `integrated-catalog` | non dichiarato nello snapshot | 2026-08-23T00:00:00Z | non dichiarato nel registro | solo workflow_dispatch | `.github/workflows/source-refresh.yml` | invalidazione cache | suite ETL |
| `integrated-rows` | non dichiarato nello snapshot | non dichiarato | non dichiarato nel registro | solo workflow_dispatch | `.github/workflows/source-refresh.yml` | invalidazione cache | suite ETL |
| `istat-municipality-geography` | 31/12/2022 | 2026-08-25T00:00:00Z | non dichiarato nel registro | nessuno | nessuno | manuale | `python scripts/etl/istat_municipality_geography.py --validate-committed` |
| `istat-regions-2024` | 2024 | non dichiarato | non dichiarato nel registro | nessuno | nessuno | manuale | `python scripts/etl/istat_regions_account.py --validate-committed` |
| `mef-irpef-2024` | 2024 | non dichiarato | https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?tree=2025 | `17 6 * * 1` | `.github/workflows/mef-irpef-refresh.yml` | solo rilevamento | `python scripts/etl/mef_irpef_municipal_snapshot.py --check` |
| `mef-participations` | 2023-12-31 | 2026-08-20T10:12:54.480623Z | https://www.de.mef.gov.it/it/attivita_istituzionali/partecipazioni_pubbliche/open_data_partecipazioni/index.html | `23 5 * * *` | `.github/workflows/mef-participations-refresh.yml` | PR automatica | `python scripts/etl/mef_participations_snapshot.py --check` |
| `openbdap-budget-law` | non dichiarato nello snapshot | non dichiarato | non dichiarato nel registro | nessuno | nessuno | manuale | `node --experimental-strip-types --import ./tests/helpers/register-ts-alias.mjs scripts/etl/bdap_budget_law_snapshot.mjs --check` |
| `opencivitas-2022` | 2022 | 2026-08-20T12:35:16Z | https://www.opencivitas.it/it/open-data | `23 4 * * *` | `.github/workflows/opencivitas-refresh.yml` | PR automatica | `python scripts/etl/opencivitas_snapshot.py --check` |
| `opencoesione` | 2026-04-30 | 2026-08-20T08:51:13+00:00 | https://opencoesione.gov.it/it/api/aggregati/ | `17 */6 * * *` | `.github/workflows/opencoesione-refresh.yml` | PR automatica | `python scripts/etl/opencoesione_snapshot.py --check` |
| `parliament` | non dichiarato nello snapshot | 2026-08-20T14:00:00.000Z | non dichiarato nel registro | `37 */6 * * *` | `.github/workflows/parliament-sources.yml` | solo rilevamento | `python scripts/etl/parliament_sources.py --check` |
| `pcm-financial-2024` | 2024 | non dichiarato | non dichiarato nel registro | nessuno | nessuno | manuale | `python scripts/etl/pcm_financial_account.py --check` |
| `pnrr-childcare` | 2026-06-13 | 2026-08-21T12:15:00Z | https://www.italiadomani.gov.it/content/sogei-ng/it/it/catalogo-open-data.html | `37 5 * * 1` | `.github/workflows/pnrr-childcare-refresh.yml` | solo rilevamento | `python scripts/etl/pnrr_childcare_snapshot.py --check` |
| `government-scorecard` | 2024 | 2026-08-29T23:11:43Z | https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database/download-annual-data-set-macro-economic-database-ameco_en | `37 7 * * 2` | `.github/workflows/government-scorecard-refresh.yml` | PR automatica | `python3 scripts/ci/check-government-scorecard-artifacts.py` |
| `public-debt` | 2026-06-30 | 2026-08-24T09:41:59Z | https://www.bancaditalia.it/pubblicazioni/finanza-pubblica/index.html | `17 6 * * *` | `.github/workflows/public-debt-refresh.yml` | PR automatica | `python scripts/etl/public_debt_snapshot.py --check` |
| `rgs-consulting-payments` | non dichiarato nello snapshot | 2026-08-22T00:00:00Z | non dichiarato nel registro | nessuno | nessuno | manuale | suite ETL |
| `rgs-ministries-2025` | 2025 | non dichiarato | non dichiarato nel registro | nessuno | nessuno | manuale | `python scripts/etl/rgs_ministries_account.py --validate-committed` |
| `rgs-state-budget-territorial-2023` | 2023 | 2026-08-22T00:00:00Z | https://bdap-opendata.rgs.mef.gov.it/content/2023-distribuzione-territoriale-della-spesa-del-bilancio-dello-stato-spesa-statale?metadati=showall | nessuno | nessuno | manuale | suite ETL |
| `siope-municipal` | 2026 | 2026-08-25T03:31:23+00:00 | https://www.siope.it/documenti/siope2/open/last | `29 4 * * *` | `.github/workflows/siope-refresh.yml` | PR automatica | `python scripts/etl/siope_municipal_snapshot.py --check` |
| `ssn-cce-2024` | 2024 | 2026-08-22T00:00:00Z | https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn | nessuno | nessuno | manuale | `python scripts/etl/ssn_cce_snapshot.py --check` |
| `ssn-cce-national-history` | non dichiarato nello snapshot | non dichiarato | non dichiarato nel registro | nessuno | nessuno | manuale | test Node |
| `vive-roma-restoration` | non dichiarato nello snapshot | 2026-08-22 | non dichiarato nel registro | nessuno | nessuno | manuale | test Node |
| `company-atlas` | 2026-08-11 | 2026-08-26T00:00:00+02:00 | https://opendata.marche.camcom.it/data/Stock-Imprese-Attive-Italia.json | `41 5 * * *` | `.github/workflows/company-atlas-refresh.yml` | PR automatica | `node scripts/etl/company_atlas_snapshot.mjs --check` |
| `istat-pensions-2012-2022` | 2012-2022 | non dichiarato | https://esploradati.istat.it/databrowser/ | nessuno | nessuno | manuale | `python3 scripts/etl/istat_pensions_snapshot.py --check` |
| `consip-ordini-2024-2026` | 2024-2026 | non dichiarato | https://dati.consip.it/ | nessuno | nessuno | manuale | `python3 scripts/etl/consip_ordini_snapshot.py --check` |
| `eurostat-cofog-2014-2024` | 2014-2024 | 2026-09-03 | https://ec.europa.eu/eurostat/databrowser/view/gov_10a_exp/default/table?lang=en | nessuno | nessuno | manuale | `python3 scripts/etl/eurostat_cofog_snapshot.py --check` |
| `istat-cofog-1995-2023` | 1995-2023 | 2026-09-04 | https://esploradati.istat.it/databrowser/ | nessuno | nessuno | manuale | `python3 scripts/etl/istat_cofog_snapshot.py --check` |
| `inps-naspi-2018-2022` | 2018-2022 | 2026-09-04 | https://opendata.inps.it/opendata | nessuno | nessuno | manuale | `python3 scripts/etl/inps_naspi_snapshot.py --check` |
| `istat-enterprise-turnover` | 2024 | 2026-08-26T00:00:00+02:00 | non dichiarato nel registro | nessuno | nessuno | manuale | `python3 scripts/etl/istat_enterprise_turnover.py --check` |
| `education-atlas` | 2026-02-23 | 2026-08-27T00:00:00+02:00 | non dichiarato nel registro | nessuno | nessuno | manuale | `python3 scripts/etl/education_atlas_snapshot.py --check` |
| `source-ledger-proofs` | non dichiarato nello snapshot | 2026-08-23T00:00:00Z | non dichiarato nel registro | solo workflow_dispatch | `.github/workflows/source-refresh.yml` | invalidazione cache | suite ETL |
| `investigative-explorer-incarichi` | non dichiarato nello snapshot | 2026-08-26T21:45:23Z | non dichiarato nel registro | nessuno | nessuno | manuale | `python3 scripts/etl/investigative_explorer_build.py --check --output src/data/generated/investigative-explorer-incarichi.json` |

## Prossimo passo

Automatizzare una sola fonte ancora in modo **manuale**, usando il
publisher già gestito: branch dedicato, artefatti verificati, PR
automatica, mai push su `main`. Non aprire un workflow unico che
aggiorna tutto.

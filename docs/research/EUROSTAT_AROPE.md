# Eurostat · AROPE Europa 2030 (`ilc_peps01n`)

Lock della fetta nazionale Italia per chiudere [#581](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/581).

## Fonte

| Campo | Valore |
|---|---|
| Titolare | Eurostat (EU-SILC; raccolta italiana ISTAT) |
| Dataset | `ilc_peps01n` — Persons at risk of poverty or social exclusion by age and sex |
| Definizione | **Europa 2030** (grave deprivazione materiale e sociale), non la serie Europa 2020 `ilc_peps01` |
| Landing | https://ec.europa.eu/eurostat/databrowser/view/ilc_peps01n/default/table?lang=en |
| Licenza | CC BY 4.0 ([copyright notice](https://ec.europa.eu/eurostat/web/main/help/copyright-notice)) |

## Acquisizione 2026-09-21

| Asset | Byte | SHA-256 |
|---|---:|---|
| [SDMX-CSV](https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/ilc_peps01n/A.PC+THS_PER.TOTAL.T.IT?format=SDMX-CSV&startPeriod=2015&endPeriod=2025) | 1.693 | `da535984a0de6db02e995450b24f6d7daf596221cec984200933155d96ab2c8e` |

Chiave fissata: `A.PC+THS_PER.TOTAL.T.IT`, anni 2015–2025. `LAST UPDATE` nel payload: `17/09/26 23:00:00`.

## Perimetro pubblicato

- Solo **Italia**, età **TOTAL**, sesso **T**
- Misure: tasso `PC` (decimi) e persone `THS_PER` (migliaia intere)
- 11 osservazioni (una per anno)
- `soldi.present = false`

## Fuori scope

- Serie Europa 2020 (`ilc_peps01`)
- Componenti separati (rischio di povertà, SMSD, bassa intensità)
- Dettaglio regionale / età / sesso
- Somme o confronti con povertà assoluta/relativa ISTAT (`34_727`) o soglie monetarie

## Verifica numerica

I valori 2024–2025 coincidono con il comunicato ISTAT EU-SILC (23,1% / 22,6%; ~13,5 / 13,3 milioni di persone).

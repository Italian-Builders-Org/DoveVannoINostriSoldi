# OpenCivitas 2021 · Viabilità e territorio (FC70TERRVIAB)

Fetta **per funzione e annualità** della serie OpenCivitas, distinta da FC70TOT
2021 (servizi totali) e da FC80TERRVIAB 2022. Snapshot + API/MCP, senza UI.
Fetta di [#282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282).

- Fonte: [2021 Comuni - Viabilità e territorio](https://www.opencivitas.it/it/dataset/2021-comuni-viabilit%C3%A0-e-territorio-indicatori-e-determinanti)
- Famiglia: `FC70TERRVIAB` versione 1, pubblicazione 30/05/2024, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura: 6.551 Comuni delle 15 Regioni a statuto ordinario (14 esclusi per spesa storica vuota nella fonte)
- API: `/api/spese/opencivitas-2021-viabilita`
- MCP: `opencivitas_viabilita_2021`

## Lock byte (acquisizione 2026-09-22)

| File | Byte | SHA-256 |
|---|---:|---|
| `2021_Ind_FC70TERRVIAB_1_csv.zip` | 3.394.631 | `e56d93a219cc165b72309778116aed6c295fea9a843aae3780392dcd6f00b8ed` |
| `Metadati_Enti_2021_xlsx.zip` | 429.597 | `ef1a547c281b0f47ed9b5d6fd17b8919eff3ad5eaae163ed2bf108ba02eca83b` |
| `2021_Metadati_Ind_FC70TERRVIAB_1_xlsx.zip` | 8.069 | `02728f176dedbdf24c963d1f082a8234484a892337e7b33956269f423a877002` |

## Differenze da FC70TOT e da FC80TERRVIAB

- Funzione dichiarata `TERR_VIAB`, non `TOTALE`.
- Annualità 2021, famiglia `FC70TERRVIAB`: non è lo stesso contratto di FC80TERRVIAB 2022.
- CSV a cinque colonne: include `Privacy`.
- Quattordici Comuni con `SPESA_STORICA` / `SPESA_STORICA_PROAB` vuoti e FST presente restano fuori: nessuna imputazione a zero.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali 2021 o con la viabilità 2022.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2021_viabilita_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2021-viabilita-contract.test.mjs \
  tests/opencivitas-2021-viabilita-route.test.mjs
```

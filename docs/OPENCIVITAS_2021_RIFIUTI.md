# OpenCivitas 2021 · Rifiuti (FC70RIFIUTI)

Fetta **per funzione e annualità** della serie OpenCivitas, distinta da FC70TOT
2021 (servizi totali) e da FC80RIFIUTI 2022. Snapshot + API/MCP, senza UI.

- Fonte: [2021 Comuni - Rifiuti](https://www.opencivitas.it/it/dataset/2021-comuni-rifiuti-indicatori-e-determinanti)
- Famiglia: `FC70RIFIUTI` versione 1, pubblicazione 30/05/2024, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura: 6.565 Comuni delle 15 Regioni a statuto ordinario
- API: `/api/spese/opencivitas-2021-rifiuti`
- MCP: `opencivitas_rifiuti_2021`

## Lock byte (acquisizione 2026-09-22)

| File | Byte | SHA-256 |
|---|---:|---|
| `2021_Ind_FC70RIFIUTI_1_csv.zip` | 1.725.294 | `ab8b417cd957394b25aa278d7f4a788d4a8a1931db8909f68f96a0479ab702f6` |
| `Metadati_Enti_2021_xlsx.zip` | 429.597 | `ef1a547c281b0f47ed9b5d6fd17b8919eff3ad5eaae163ed2bf108ba02eca83b` |
| `2021_Metadati_Ind_FC70RIFIUTI_1_xlsx.zip` | 6.646 | `b641069abae9c14cefd9dc9551e2d3afbfc0aad6ec70584cf7e9774fcf67fe1e` |

## Differenze da FC70TOT e da FC80RIFIUTI

- Funzione dichiarata `RIFIUTI`, non `TOTALE`.
- Annualità 2021, famiglia `FC70RIFIUTI`: non è lo stesso contratto di FC80RIFIUTI 2022.
- CSV a quattro colonne: `USERNAME`, `Indicatore/Determinante`, `Valore`, `Anomalia` (niente `Privacy`).
- Nove indicatori DVNS come nel totale servizi, con descrizioni lockate dai metadati.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali 2021 o con i rifiuti 2022.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2021_rifiuti_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2021-rifiuti-contract.test.mjs \
  tests/opencivitas-2021-rifiuti-route.test.mjs
```

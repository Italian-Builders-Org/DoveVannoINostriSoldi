# OpenCivitas 2022 · Viabilità e territorio (FC80TERRVIAB)

Seconda fetta **per funzione** della serie OpenCivitas 2022, distinta da
FC80TOT (servizi totali) e da FC80RIFIUTI. Snapshot + API/MCP, senza UI.

- Fonte: [2022 Comuni - Viabilità e territorio](https://www.opencivitas.it/it/dataset/2022-comuni-viabilit%C3%A0-e-territorio-indicatori-e-determinanti)
- Famiglia: `FC80TERRVIAB` versione 1, pubblicazione 16/06/2025, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura: 6.553 Comuni delle 15 Regioni a statuto ordinario (4 esclusi per spesa storica vuota nella fonte)
- API: `/api/spese/opencivitas-2022-viabilita`
- MCP: `opencivitas_viabilita_2022`

## Lock byte

| File | Byte | SHA-256 |
|---|---:|---|
| `2022_Ind_FC80TERRVIAB_1_csv.zip` | 3.499.805 | `dba9ba9e0d5a5aa7d306ba716bf6b2983629516a5e6a460238fede87a78fb9a7` |
| `Metadati_Enti_2022_xlsx.zip` | 518.899 | `9f50652797ed5080d31291cb7a1c74fad74b37189ac19d2cac2921a2939ed6a1` |
| `2022_Metadati_Ind_FC80TERRVIAB_1_xlsx.zip` | 13.021 | `be85fad8346d348fdd33e17d9fb28eb6e3f7d52e681893df1a509b95cc44f4f4` |

## Differenze da FC80RIFIUTI / FC80TOT

- Funzione dichiarata `TERR_VIAB`, non `RIFIUTI` né `TOTALE`.
- Codici LQP senza suffisso `_TOT` (`DIFF_OUT_PERC`, `POSIZIONE_SPESA_PERC`, …).
- CSV a cinque colonne: include `Privacy` (come FC80TOT, a differenza di Rifiuti).
- Quattro Comuni con `SPESA_STORICA` / `SPESA_STORICA_PROAB` vuoti e FST presente restano fuori: nessuna imputazione a zero.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali, i rifiuti o altre funzioni.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2022_viabilita_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2022-viabilita-contract.test.mjs \
  tests/opencivitas-2022-viabilita-route.test.mjs
```

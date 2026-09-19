# OpenCivitas 2022 · Rifiuti (FC80RIFIUTI)

Prima fetta **per funzione** della serie OpenCivitas, distinta da FC80TOT
(servizi totali). Snapshot + API/MCP, senza UI.

- Fonte: [2022 Comuni - Rifiuti](https://www.opencivitas.it/it/dataset/2022-comuni-rifiuti-indicatori-e-determinanti)
- Famiglia: `FC80RIFIUTI` versione 1, pubblicazione 16/06/2025, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura: 6.557 Comuni delle 15 Regioni a statuto ordinario
- API: `/api/spese/opencivitas-2022-rifiuti`
- MCP: `opencivitas_rifiuti_2022`

## Lock byte (acquisizione 2026-09-19)

| File | Byte | SHA-256 |
|---|---:|---|
| `2022_Ind_FC80RIFIUTI_1_csv.zip` | 1.889.844 | `6121df0f0c8f302570b0a977da05ccda0622145c306826d7162a1ec55bfe3204` |
| `Metadati_Enti_2022_xlsx.zip` | 518.899 | `9f50652797ed5080d31291cb7a1c74fad74b37189ac19d2cac2921a2939ed6a1` |
| `2022_Metadati_Ind_FC80RIFIUTI_1_xlsx.zip` | 11.886 | `2d217053776e82a041e72a9c5eee2c0210602b01211a6f0821c244c5a615d5f3` |

## Differenze da FC80TOT

- Funzione dichiarata `RIFIUTI`, non `TOTALE`.
- Codici LQP senza suffisso `_TOT` (`DIFF_OUT_PERC`, `POSIZIONE_SPESA_PERC`, …).
- CSV a quattro colonne: `USERNAME`, `Indicatore/Determinante`, `Valore`, `Anomalia` (niente `Privacy`).
- Nove indicatori DVNS come nel totale servizi, con descrizioni lockate dai metadati.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali o con altre funzioni.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2022_rifiuti_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2022-rifiuti-contract.test.mjs \
  tests/opencivitas-2022-rifiuti-route.test.mjs
```

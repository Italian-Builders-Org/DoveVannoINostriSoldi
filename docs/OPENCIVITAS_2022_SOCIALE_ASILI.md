# OpenCivitas 2022 · Sociale e asili nido (FC80SOCNID)

Terza fetta **per funzione** della serie OpenCivitas 2022, distinta da
FC80TOT (servizi totali), FC80RIFIUTI e FC80TERRVIAB. Snapshot + API/MCP, senza UI.

- Fonte: [2022 Comuni - Sociale e asili nido](https://www.opencivitas.it/it/dataset/2022-comuni-sociale-e-asili-nido-indicatori-e-determinanti)
- Famiglia: `FC80SOCNID` versione 1, pubblicazione 16/06/2025, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura: 6.554 Comuni delle 15 Regioni a statuto ordinario (3 esclusi per spesa storica vuota nella fonte)
- API: `/api/spese/opencivitas-2022-sociale-asili`
- MCP: `opencivitas_sociale_asili_2022`

## Lock byte

| File | Byte | SHA-256 |
|---|---:|---|
| `2022_Ind_FC80SOCNID_1_csv.zip` | 4.162.108 | `2dd0298e9d25e058f68aaf78f188bc271f175bfb5fe4e6ff06be6882d1486c95` |
| `Metadati_Enti_2022_xlsx.zip` | 518.899 | `9f50652797ed5080d31291cb7a1c74fad74b37189ac19d2cac2921a2939ed6a1` |
| `2022_Metadati_Ind_FC80SOCNID_1_xlsx.zip` | 13.439 | `fd709a07d00d8de43fb90997176947c762467795226aae4c050adb9769f384da` |

## Differenze da FC80RIFIUTI / FC80TOT / FC80TERRVIAB

- Funzione dichiarata `SOCIALE E NIDO`, non `RIFIUTI`, `TOTALE` né `TERR_VIAB`.
- Codici LQP senza suffisso `_TOT` (`DIFF_OUT_PERC`, `POSIZIONE_SPESA_PERC`, …).
- CSV a cinque colonne: include `Privacy` (come FC80TOT e Viabilità, a differenza di Rifiuti).
- Tre Comuni con `SPESA_STORICA` / `SPESA_STORICA_PROAB` vuoti e FST presente restano fuori: nessuna imputazione a zero.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali, i rifiuti, la viabilità o altre funzioni.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2022_sociale_asili_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2022-sociale-asili-contract.test.mjs \
  tests/opencivitas-2022-sociale-asili-route.test.mjs
```

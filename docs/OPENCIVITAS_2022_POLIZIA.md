# OpenCivitas 2022 · Polizia locale (FC80POLIZIA)

Quarta fetta **per funzione** della serie OpenCivitas 2022, distinta da
FC80TOT (servizi totali), FC80RIFIUTI, FC80TERRVIAB e FC80SOCNID. Snapshot + API/MCP, senza UI.
Fetta di [#282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282).
Istruzione e amministrazione restano fuori da questo contratto.

- Fonte: [2022 Comuni - Polizia locale](https://www.opencivitas.it/it/dataset/2022-comuni-polizia-locale-indicatori-e-determinanti)
- Famiglia: `FC80POLIZIA` versione 1, pubblicazione 16/06/2025, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura: 6.554 Comuni delle 15 Regioni a statuto ordinario (3 esclusi per spesa storica vuota nella fonte)
- API: `/api/spese/opencivitas-2022-polizia`
- MCP: `opencivitas_polizia_2022`

## Lock byte

| File | Byte | SHA-256 |
|---|---:|---|
| `2022_Ind_FC80POLIZIA_1_csv.zip` | 2.839.376 | `a57923007cf2c76e645f3e16beed2f4974e0c41dfcf68c688ef1c168cd65ad77` |
| `Metadati_Enti_2022_xlsx.zip` | 518.899 | `9f50652797ed5080d31291cb7a1c74fad74b37189ac19d2cac2921a2939ed6a1` |
| `2022_Metadati_Ind_FC80POLIZIA_1_xlsx.zip` | 12.415 | `ade9078fcb2e182c46a1bf27dc9b592d2fbc3b20c3ae20187d900bfd8b13dd56` |

## Differenze da FC80RIFIUTI / FC80TOT / FC80TERRVIAB / FC80SOCNID

- Funzione dichiarata `POLIZIA`, non `RIFIUTI`, `TOTALE`, `TERR_VIAB` né `SOCIALE E NIDO`.
- Codici LQP senza suffisso `_TOT` (`DIFF_OUT_PERC`, `POSIZIONE_SPESA_PERC`, …).
- Le descrizioni dei livelli sono «Da 0 a 10», come in Sociale e asili nido.
- CSV a cinque colonne: include `Privacy` (come FC80TOT, Viabilità e Sociale, a differenza di Rifiuti).
- Tre Comuni con `SPESA_STORICA` / `SPESA_STORICA_PROAB` vuoti e FST presente restano fuori: nessuna imputazione a zero.
- Se `DIFF_OUT_PERC` ha un flag di anomalia, il confronto servizi resta `null` e l'avviso della fonte sta in `sourceWarnings`.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali, i rifiuti, la viabilità, il sociale o altre funzioni.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2022_polizia_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2022-polizia-contract.test.mjs \
  tests/opencivitas-2022-polizia-route.test.mjs
```

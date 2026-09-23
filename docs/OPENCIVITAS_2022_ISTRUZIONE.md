# OpenCivitas 2022 · Istruzione (FC80ISTRUZ)

Fetta **per funzione** della serie OpenCivitas 2022, distinta da
FC80TOT (servizi totali), FC80RIFIUTI, FC80TERRVIAB e FC80SOCNID. Snapshot + API/MCP, senza UI.
Fetta di [#282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282).
Amministrazione e polizia locale restano fuori da questo contratto.

- Fonte: [2022 Comuni - Istruzione](https://www.opencivitas.it/it/dataset/2022-comuni-istruzione-indicatori-e-determinanti)
- Famiglia: `FC80ISTRUZ` versione 1, pubblicazione 16/06/2025, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura: 6.550 Comuni delle 15 Regioni a statuto ordinario
- API: `/api/spese/opencivitas-2022-istruzione`
- MCP: `opencivitas_istruzione_2022`

## Lock byte

| File | Byte | SHA-256 |
|---|---:|---|
| `2022_Ind_FC80ISTRUZ_1_csv.zip` | 2.557.585 | `a4f1f98f4dc070221798e8b2b2264a7254d27c1beac534355c96304755c861c0` |
| `Metadati_Enti_2022_xlsx.zip` | 518.899 | `9f50652797ed5080d31291cb7a1c74fad74b37189ac19d2cac2921a2939ed6a1` |
| `2022_Metadati_Ind_FC80ISTRUZ_1_xlsx.zip` | 11.987 | `188a112ba7c5b16148f04d47f2b7f70c7376b2923dca11df6885915065becde7` |

## Differenze dalle altre funzioni 2022

- Funzione dichiarata `ISTRUZIONE`.
- La descrizione ufficiale di `SPESA_STORICA` è «Spesa storica - euro», con la e minuscola. Le altre funzioni usano «Euro».
- Codici LQP senza suffisso `_TOT`. I livelli sono «Da 0 a 10».
- CSV a cinque colonne, con `Privacy`.
- Sei Comuni con `SPESA_STORICA` / `SPESA_STORICA_PROAB` vuoti e FST presente restano fuori: nessuna imputazione a zero.
- Fascia (GE, `010022`) pubblica 0 su storica, standard e valori per abitante. Resta fuori: la differenza percentuale divide per la spesa standard e con standard 0 non è definita. Lo zero pubblicato non viene sostituito.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali, i rifiuti, la viabilità, il sociale o altre funzioni.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2022_istruzione_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2022-istruzione-contract.test.mjs \
  tests/opencivitas-2022-istruzione-route.test.mjs
```

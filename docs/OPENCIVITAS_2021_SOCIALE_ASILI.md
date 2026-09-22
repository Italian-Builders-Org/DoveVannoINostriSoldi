# OpenCivitas 2021 · Sociale e asili nido (FC70SOCNID)

Fetta **per funzione e annualità** della serie OpenCivitas, distinta da FC70TOT
2021 (servizi totali) e da FC80SOCNID 2022. Snapshot + API/MCP, senza UI.
Fetta di [#282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282).

- Fonte: [2021 Comuni - Sociale e asili nido](https://www.opencivitas.it/it/dataset/2021-comuni-sociale-e-asili-nido-indicatori-e-determinanti)
- Famiglia: `FC70SOCNID` versione 1, pubblicazione 30/05/2024, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura: 6.555 Comuni delle 15 Regioni a statuto ordinario
- API: `/api/spese/opencivitas-2021-sociale-asili`
- MCP: `opencivitas_sociale_asili_2021`

## Lock byte (acquisizione 2026-09-22)

| File | Byte | SHA-256 |
|---|---:|---|
| `2021_Ind_FC70SOCNID_1_csv.zip` | 3.731.430 | `36cf00aadfd4b1372c4798c9676388acd1bfe62c15820a44805394df5bee9f69` |
| `Metadati_Enti_2021_xlsx.zip` | 429.597 | `ef1a547c281b0f47ed9b5d6fd17b8919eff3ad5eaae163ed2bf108ba02eca83b` |
| `2021_Metadati_Ind_FC70SOCNID_1_xlsx.zip` | 13.721 | `a3bccf772ab80a278b0775ade9f3691ef830d35796e804d5879ea349247cb67a` |

## Differenze da FC70TOT e da FC80SOCNID

- Funzione dichiarata `SOCIALE E NIDO`, non `TOTALE`.
- Annualità 2021, famiglia `FC70SOCNID`: non è lo stesso contratto di FC80SOCNID 2022.
- CSV a cinque colonne: include `Privacy`.
- Nove Comuni con `SPESA_STORICA` / `SPESA_STORICA_PROAB` vuoti e FST presente restano fuori: nessuna imputazione a zero.
- Canistro (`066017`) pubblica la spesa storica come `1,818989E-12` e il valore per abitante come `1,996695E-15`. Il separatore del rilascio è la virgola e la notazione scientifica non è un importo decimale: il Comune resta fuori, senza riscriverlo a zero.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali 2021 o con il sociale 2022.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2021_sociale_asili_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2021-sociale-asili-contract.test.mjs \
  tests/opencivitas-2021-sociale-asili-route.test.mjs
```

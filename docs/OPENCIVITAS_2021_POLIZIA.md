# OpenCivitas 2021 · Polizia locale (FC70POLIZIA)

Fetta **per funzione e annualità** della serie OpenCivitas, distinta da FC70TOT
2021 (servizi totali) e dalla stessa funzione nel 2022. Snapshot + API/MCP, senza UI.
Parent: #282.

- Fonte: [Polizia locale 2021](https://www.opencivitas.it/it/dataset/2021-comuni-polizia-locale-indicatori-e-determinanti)
- Famiglia: `FC70POLIZIA` versione 1, pubblicazione 30/05/2024, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura pubblicata: 6556 Comuni delle 15 Regioni a statuto ordinario
- API: `/api/spese/opencivitas-2021-polizia`
- MCP: `opencivitas_polizia_2021`

## Lock byte (acquisizione 2026-09-22)

| File | Byte | SHA-256 |
|---|---:|---|
| `2021_Ind_FC70POLIZIA_1_csv.zip` | 2.607.887 | `709732432e95a296625aaf9bf793dbcb2db502a864ee186769d81384a3c68dbd` |
| `Metadati_Enti_2021_xlsx.zip` | 429.597 | `ef1a547c281b0f47ed9b5d6fd17b8919eff3ad5eaae163ed2bf108ba02eca83b` |
| `2021_Metadati_Ind_FC70POLIZIA_1_xlsx.zip` | 7.232 | `7cb35e2d972d137dbc3e05c9865554c6e8f5e69c1ea89ff942801b188dcff615` |

I metadati enti sono gli stessi già vincolati dalle altre fette 2021, con identici byte e hash.
La licenza CC BY 3.0 citata in pagina riguarda i dati esterni ISTAT, non questo dataset.

## Cosa cambia rispetto ai servizi totali

- CSV UTF-8 a cinque colonne, inclusa `Privacy`.
- `SPESA_STORICA` è descritta «Spesa storica - Euro»; i livelli sono «Da 0 a 10».
- 9 Comuni con spesa storica vuota e fabbisogno presente restano esclusi, senza imputazione a zero.
- 61 scarti di servizio (`DIFF_OUT_PERC: cod_anomalo`) restano nulli e visibili in `sourceWarnings`.

Sui 6.556 Comuni pubblicati la spesa storica è 2.721.866.679,22 € e il fabbisogno 2.719.474.065,00 €. I 9 esclusi portano 2.392.614,23 € di fabbisogno. Sommati al fabbisogno pubblicato fanno 2.721.866.679,23 €, a 0,01 € dalla spesa storica pubblicata. L'aggregato `ZZ999ITA001` pubblica 2.721.866.679,20 € di spesa storica e 2.721.866.679,10 € di fabbisogno.
La differenza aggregata non è un risultato e non va letta come risparmio o spreco.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali 2021 o con la stessa funzione nel 2022.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.
- Uno zero di spesa storica osservato resta zero. Una cella vuota non diventa zero.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2021_polizia_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2021-polizia-contract.test.mjs \
  tests/opencivitas-2021-polizia-route.test.mjs
```

# OpenCivitas 2021 · Istruzione (FC70ISTRUZ)

Fetta **per funzione e annualità** della serie OpenCivitas, distinta da FC70TOT
2021 (servizi totali) e dalla stessa funzione nel 2022. Snapshot + API/MCP, senza UI.
Parent: #282.

- Fonte: [Istruzione 2021](https://www.opencivitas.it/it/dataset/2021-comuni-istruzione-indicatori-e-determinanti)
- Famiglia: `FC70ISTRUZ` versione 1, pubblicazione 30/05/2024, licenza CC BY 4.0
- Titolare: Ragioneria Generale dello Stato · editore Sogei
- Copertura pubblicata: 6549 Comuni delle 15 Regioni a statuto ordinario
- API: `/api/spese/opencivitas-2021-istruzione`
- MCP: `opencivitas_istruzione_2021`

## Lock byte (acquisizione 2026-09-22)

| File | Byte | SHA-256 |
|---|---:|---|
| `2021_Ind_FC70ISTRUZ_1_csv.zip` | 2.336.072 | `ee4ffe034eb5d8900eabafaa3b9c5e185863bf37b4823b68bf46bd34d26e0e52` |
| `Metadati_Enti_2021_xlsx.zip` | 429.597 | `ef1a547c281b0f47ed9b5d6fd17b8919eff3ad5eaae163ed2bf108ba02eca83b` |
| `2021_Metadati_Ind_FC70ISTRUZ_1_xlsx.zip` | 6.850 | `5fc81a0c1a345a57898fa98a0a2e89fcf7c7ac2cca3f4f6ddde645021082795d` |

I metadati enti sono gli stessi già vincolati dalle altre fette 2021, con identici byte e hash.
La licenza CC BY 3.0 citata in pagina riguarda i dati esterni ISTAT, non questo dataset.

## Cosa cambia rispetto ai servizi totali

- CSV UTF-8 a cinque colonne, inclusa `Privacy`.
- `SPESA_STORICA` è descritta «Spesa storica - euro» con la *e* minuscola; i livelli sono «Da 0 a 10».
- 15 Comuni con spesa storica vuota e fabbisogno presente restano esclusi, senza imputazione a zero.
- Fascia (ISTAT `010022`) ha spesa storica e fabbisogno a zero: esclusa, perché un fabbisogno non positivo non si pubblica.
- Uno scarto di servizio (`DIFF_OUT_PERC: cod_anomalo`, ISTAT `004159`) resta nullo e visibile in `sourceWarnings`.

Sui 6.549 Comuni pubblicati la spesa storica è 4.257.412.179,54 € e il fabbisogno 4.251.015.021,71 €. I 15 esclusi portano 6.397.157,90 € di fabbisogno. Sommati al fabbisogno pubblicato fanno 4.257.412.179,61 €, a 0,07 € dalla spesa storica pubblicata. L'aggregato `ZZ999ITA001` è 4.257.412.179,50 €.
La differenza aggregata non è un risultato e non va letta come risparmio o spreco.

## Cosa non misura

- Nessuna somma o confronto silenzioso con i servizi totali 2021 o con la stessa funzione nel 2022.
- La differenza storica − standard non è spreco né efficienza.
- RSS e Province autonome fuori perimetro; aggregati `ZZ999…` esclusi.
- Uno zero di spesa storica osservato resta zero. Una cella vuota non diventa zero.

## Verifica

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python scripts/etl/opencivitas_2021_istruzione_snapshot.py --check
node --experimental-strip-types --test \
  tests/opencivitas-2021-istruzione-contract.test.mjs \
  tests/opencivitas-2021-istruzione-route.test.mjs
```

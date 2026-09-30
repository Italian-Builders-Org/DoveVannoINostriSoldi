# OpenCivitas 2018 · sei funzioni comunali (FC50)

Fetta **per funzione** dell'annualità 2018, distinta da FC50TOT 2018 (servizi
totali) e dalle stesse funzioni 2019 (FC60), 2021 (FC70) e 2022 (FC80).
Snapshot + API/MCP, senza UI. Fetta di [#282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282).

Stessa struttura delle [funzioni 2019](OPENCIVITAS_2019_FUNZIONI.md): un
normalizzatore guidato dalla spec
([`opencivitas_function_release.py`](../scripts/etl/opencivitas_function_release.py))
e, per ogni rilascio, spec, digest semantico ed esclusioni propri.

## Fonte

Schede ufficiali identiche per le sei funzioni: periodo 2018, pubblicazione e
ultima modifica 14/02/2022, versione 1 («nessuna variazione»), licenza
CC BY 4.0, autore ed editore SOSE, titolare Ragioneria Generale dello Stato,
frequenza irregolare. Il link CC BY 3.0 IT della scheda riguarda i «Dati
esterni — Fonte Open Data Istat», non il dataset.

| Funzione | Famiglia | Comuni RSO | API | MCP |
|---|---|---:|---|---|
| [Istruzione](https://www.opencivitas.it/it/dataset/2018-comuni-istruzione-indicatori-e-determinanti) | `FC50ISTRUZ` | 6.584 | `/api/spese/opencivitas-2018-istruzione` | `opencivitas_istruzione_2018` |
| [Polizia locale](https://www.opencivitas.it/it/dataset/2018-comuni-polizia-locale-indicatori-e-determinanti) | `FC50POLIZIA` | 6.594 | `/api/spese/opencivitas-2018-polizia` | `opencivitas_polizia_2018` |
| [Viabilità e territorio](https://www.opencivitas.it/it/dataset/2018-comuni-viabilita-e-territorio-indicatori-e-determinanti) | `FC50TERRVIAB` | 6.594 | `/api/spese/opencivitas-2018-viabilita` | `opencivitas_viabilita_2018` |
| [Rifiuti](https://www.opencivitas.it/it/dataset/2018-comuni-rifiuti-indicatori-e-determinanti) | `FC50RIFIUTI` | 6.606 | `/api/spese/opencivitas-2018-rifiuti` | `opencivitas_rifiuti_2018` |
| [Sociale e asili nido](https://www.opencivitas.it/it/dataset/2018-comuni-sociale-e-asili-nido-indicatori-e-determinanti) | `FC50SOCNID` | 6.590 | `/api/spese/opencivitas-2018-sociale-asili` | `opencivitas_sociale_asili_2018` |
| [Amministrazione](https://www.opencivitas.it/it/dataset/2018-comuni-amministrazione-indicatori-e-determinanti) | `FC50AMMIN` | 6.586 | `/api/spese/opencivitas-2018-amministrazione` | `opencivitas_amministrazione_2018` |

## Lock byte (acquisizione 2026-09-30)

| File | Byte | SHA-256 |
|---|---:|---|
| `2018_Ind_FC50ISTRUZ_1_csv.zip` | 2.342.554 | `b3f80fb4b38faadba4ae9b669a1a795c49efdd8e784db92ecfd3f7d2763c7a2e` |
| `2018_Metadati_Ind_FC50ISTRUZ_1_xlsx.zip` | 11.443 | `f53700a604b5dc837cb24c529cbd7a3a2bea819be8a3cfb7e440878b7d20fdbc` |
| `2018_Ind_FC50POLIZIA_1_csv.zip` | 3.080.252 | `695002e9d6179ebe2e09a39c27e546057509e1f14c46fe44f76013eb09c47ccc` |
| `2018_Metadati_Ind_FC50POLIZIA_1_xlsx.zip` | 7.708 | `af3ed4a1f027029eeb1abd57854ef6228ca46eeef4544628e32118cafa880cb9` |
| `2018_Ind_FC50TERRVIAB_1_csv.zip` | 3.449.394 | `446c58c2ab5b616618da0a6c33e5272260d35c42874d1106982117b0acada3d1` |
| `2018_Metadati_Ind_FC50TERRVIAB_1_xlsx.zip` | 8.138 | `56d2dd2d12577bf653f15956c393a535e4e7b8fc6962500fe5153eed4e41a986` |
| `2018_Ind_FC50RIFIUTI_1_csv.zip` | 1.763.305 | `f3788d0dee3688eda5c18b9704601133d25a373fdb38cf7823fc6aff4b5dfd0a` |
| `2018_Metadati_Ind_FC50RIFIUTI_1_xlsx.zip` | 6.704 | `cdb3227efc15191ba53eaaa27304def5e1ad1600d1ec0fd352f1341bf78cb6ed` |
| `2018_Ind_FC50SOCNID_1_csv.zip` | 3.742.784 | `90f970f40fab094757970af996a8114c8414d36b584a79381876b2dd58722971` |
| `2018_Metadati_Ind_FC50SOCNID_1_xlsx.zip` | 13.164 | `75decd090a1f8245e96707262b0799b8d9770c11d54d07991b38ae186ee885a5` |
| `2018_Ind_FC50AMMIN_1_csv.zip` | 2.532.617 | `5cab3b3041b00471f327909c845faf7832ddaf51c950a6b4f0e396747c3c66f1` |
| `2018_Metadati_Ind_FC50AMMIN_1_xlsx.zip` | 7.073 | `3e2ace2905febbddb136b2932dca7fe2244f40176e2a598cbdc5f7bb585f49cf` |
| `Metadati_Enti_2018_xlsx.zip` | 340.823 | `91a5ecfb4f0d5d1842e23eb46b30191e373ee5e8b035fcae0326d846fab6b392` |

I metadati enti sono gli stessi byte già vincolati da FC50TOT 2018.

## Differenze dal 2019

- **Codifica.** Tutti e sei i CSV 2018 sono UTF-8; nel 2019 Amministrazione era
  cp1252. La codifica resta dichiarata per rilascio nella spec.
- **Colonne.** Rifiuti non pubblica `Privacy`, come nel 2019.
- **Regioni.** I metadati enti 2018 usano solo `EMILIA ROMAGNA`, normalizzato
  in `EMILIA-ROMAGNA`.

## Esclusioni, senza imputazione a zero

- **Spesa storica vuota** (`SPESA_STORICA` e `SPESA_STORICA_PROAB`, fabbisogno
  presente): 14 Comuni in Istruzione, 12 in Polizia locale, 12 in Viabilità,
  12 in Sociale, 20 in Amministrazione. Nessuno in Rifiuti.
- **Notazione scientifica.** In Istruzione Pontedassio (`008045`), Melissa
  (`101014`), Casamicciola Terme (`063019`) e Ogliastro Cilento (`065081`); in
  Sociale Sommariva del Bosco (`004222`), Melissa, Castiglione del Genovesi
  (`065036`) e Ogliastro Cilento. Valori come `7,28E-12` sono residui di zero,
  non importi decimali del rilascio.
- **Servizio assente.** In Istruzione Caprauna (`004039`), Fascia (`010022`),
  Castelverrino (`094013`) e Bema (`014006`) dichiarano `cod_no_servizio` con
  spesa storica e fabbisogno a zero. Un fabbisogno non positivo non viene
  pubblicato, come per Fascia in FC70ISTRUZ.
- Aggregati `ZZ999…`, RSS e Province autonome fuori perimetro.

## Totali nazionali

Il fabbisogno standard è riproporzionato sul totale della spesa storica della
funzione per Istruzione, Polizia locale, Viabilità, Rifiuti e Amministrazione:
sull'insieme joinato (pubblicati più esclusi) le due somme distano al massimo
2,85 € (Amministrazione). **Sociale e asili nido no**: il fabbisogno supera la
spesa storica del 7,7% (7,09 contro 6,58 miliardi), come negli altri anni. I
totali sono bloccati nella spec in entrambi i casi e la differenza aggregata non
va letta come risparmio, spreco o fabbisogno scoperto.

## Cosa non misura

- Nessuna somma o confronto silenzioso con FC50TOT 2018, fra funzioni o con le
  stesse funzioni di altre annualità.
- La differenza storica − standard non è spreco né efficienza; i livelli della
  fonte non sono un ranking.
- Nessuna popolazione ricostruita: gli euro per abitante sono quelli pubblicati.

## Verifica

```bash
for f in istruzione polizia viabilita rifiuti sociale_asili amministrazione; do
  DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
    python scripts/etl/opencivitas_2018_${f}_snapshot.py --check
done
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python -m unittest discover -s tests/etl -p 'test_opencivitas_2018_functions_snapshot.py'
node --experimental-strip-types --test \
  tests/opencivitas-2018-functions-contract.test.mjs \
  tests/opencivitas-2018-functions-route.test.mjs
```

Per rigenerare uno snapshot servono i tre ZIP ufficiali in una directory locale:
`python scripts/etl/opencivitas_2018_<funzione>_snapshot.py --input-dir DIR`.

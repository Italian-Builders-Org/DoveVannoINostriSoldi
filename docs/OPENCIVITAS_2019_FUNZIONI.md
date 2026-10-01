# OpenCivitas 2019 · sei funzioni comunali (FC60)

Fetta **per funzione** dell'annualità 2019, distinta da FC60TOT 2019 (servizi
totali) e dalle stesse funzioni 2021 (FC70) e 2022 (FC80). Snapshot + API/MCP,
senza UI. Fetta di [#282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282).

Le sei funzioni condividono il codice di normalizzazione
([`opencivitas_function_release.py`](../scripts/etl/opencivitas_function_release.py)),
non i dati: ogni rilascio ha la propria spec, il proprio digest semantico e le
proprie esclusioni.

## Fonte

Schede ufficiali identiche per le sei funzioni: periodo 2019, pubblicazione e
ultima modifica 30/05/2023, versione 1 («nessuna variazione»), licenza
CC BY 4.0, autore ed editore SOSE, titolare Ragioneria Generale dello Stato,
frequenza irregolare. Il link CC BY 3.0 IT della scheda riguarda i «Dati
esterni — Fonte Open Data Istat», non il dataset.

| Funzione | Famiglia | Comuni RSO | API | MCP |
|---|---|---:|---|---|
| [Istruzione](https://www.opencivitas.it/it/dataset/2019-comuni-istruzione-indicatori-e-determinanti) | `FC60ISTRUZ` | 6.555 | `/api/spese/opencivitas-2019-istruzione` | `opencivitas_istruzione_2019` |
| [Polizia locale](https://www.opencivitas.it/it/dataset/2019-comuni-polizia-locale-indicatori-e-determinanti) | `FC60POLIZIA` | 6.564 | `/api/spese/opencivitas-2019-polizia` | `opencivitas_polizia_2019` |
| [Viabilità e territorio](https://www.opencivitas.it/it/dataset/2019-comuni-viabilita-e-territorio-indicatori-e-determinanti) | `FC60TERRVIAB` | 6.566 | `/api/spese/opencivitas-2019-viabilita` | `opencivitas_viabilita_2019` |
| [Rifiuti](https://www.opencivitas.it/it/dataset/2019-comuni-rifiuti-indicatori-e-determinanti) | `FC60RIFIUTI` | 6.567 | `/api/spese/opencivitas-2019-rifiuti` | `opencivitas_rifiuti_2019` |
| [Sociale e asili nido](https://www.opencivitas.it/it/dataset/2019-comuni-sociale-e-asili-nido-indicatori-e-determinanti) | `FC60SOCNID` | 6.566 | `/api/spese/opencivitas-2019-sociale-asili` | `opencivitas_sociale_asili_2019` |
| [Amministrazione](https://www.opencivitas.it/it/dataset/2019-comuni-amministrazione-indicatori-e-determinanti) | `FC60AMMIN` | 6.494 | `/api/spese/opencivitas-2019-amministrazione` | `opencivitas_amministrazione_2019` |

## Lock byte (acquisizione 2026-09-30)

| File | Byte | SHA-256 |
|---|---:|---|
| `2019_Ind_FC60ISTRUZ_1_csv.zip` | 2.340.735 | `8deb6c81a6901e033c2127dea8881dda4c32acc11d75aad330007f3f5d1d1bf2` |
| `2019_Metadati_Ind_FC60ISTRUZ_1_xlsx.zip` | 6.847 | `eab47d2eee1926bf664d7550e7437161073b9735328e2110d2ab390fc7f40c79` |
| `2019_Ind_FC60POLIZIA_1_csv.zip` | 3.095.675 | `5687bcb4a12d428512346735aca5c114811fe84ef0203ae3abb5aaa0afcb2f9c` |
| `2019_Metadati_Ind_FC60POLIZIA_1_xlsx.zip` | 7.583 | `37aacc132a02e00e13c4b6fe1a78664bdd313ad94ebced617d4b91bbeca5fae4` |
| `2019_Ind_FC60TERRVIAB_1_csv.zip` | 3.394.645 | `7e8e5aecee698c71c2d8e2b8d419abf331e73a9d24c73688e632a5746ed91d06` |
| `2019_Metadati_Ind_FC60TERRVIAB_1_xlsx.zip` | 8.064 | `b8fdffdb5e0031baf19f17e7a71757312df58588c5aba46f4a8d6ba0bf576a57` |
| `2019_Ind_FC60RIFIUTI_1_csv.zip` | 1.730.524 | `e7c74eb15579e2cdfd94339160e3ccdcc101132a5fc20f1d106eb16841f05554` |
| `2019_Metadati_Ind_FC60RIFIUTI_1_xlsx.zip` | 6.647 | `fd0c8adddf414774964d96d5185a2eb46862773e9d2736661257b3f9044d6c48` |
| `2019_Ind_FC60SOCNID_1_csv.zip` | 3.695.324 | `ecbf6cf45ba89889dfbdf8fe1499b0b83ffbf19a593679915cc16f1a804e4891` |
| `2019_Metadati_Ind_FC60SOCNID_1_xlsx.zip` | 12.857 | `184f22f3317ff27f505817ffb6218071606ebc1264348f3c4cee8e8aff88ea9e` |
| `2019_Ind_FC60AMMIN_1_csv.zip` | 2.553.781 | `60e91571fb627fc7283929a67d830d336aaa8a59a35d68a2ebf1c8c5cb9b7b36` |
| `2019_Metadati_Ind_FC60AMMIN_1_xlsx.zip` | 7.074 | `41f87fe4b2ff422aa65a66ec5e01aba8e0d2bbca41e98eb97cd67848605dae94` |
| `Metadati_Enti_2019_xlsx.zip` | 423.591 | `bae9771f05dbaf05686553ab5c3110d7b0eb5083c0e3322fb960afff09c1a30c` |

I metadati enti sono gli stessi byte già vincolati da FC60TOT 2019.

## Differenze fra i rilasci, dichiarate nel lock

- **Codifica.** Amministrazione è cp1252, le altre cinque UTF-8. L'unico byte
  non ASCII di Amministrazione è `0x80`, «€» nei due motivi di non valutabilità
  di Bellinzago Lombardo (`015016`). In latin-1 sarebbe un carattere di
  controllo, quindi la decodifica è univoca. Nessun ripiego automatico fra
  codifiche.
- **Colonne.** Rifiuti non pubblica `Privacy`, come FC70RIFIUTI; le altre sì.
  L'intestazione esatta è bloccata nella spec.
- **Descrizioni.** Rifiuti e Amministrazione scrivono «da 0 a 10», le altre
  «Da 0 a 10»; Istruzione scrive «Spesa storica - euro». Ogni spec blocca le
  proprie nove descrizioni.
- **Regioni.** I metadati enti 2019 usano sia `EMILIA ROMAGNA` sia
  `EMILIA-ROMAGNA`: la normalizzazione è esplicita.

## Esclusioni, senza imputazione a zero

- **Spesa storica vuota** (`SPESA_STORICA` e `SPESA_STORICA_PROAB`, fabbisogno
  presente): 10 Comuni in Istruzione, 3 in Polizia locale, 1 in Viabilità,
  73 in Amministrazione.
- **Notazione scientifica.** Ceraso (`065040`) e Locana (`001134`) in
  Istruzione, Pallagorio (`101016`) in Sociale pubblicano la spesa storica come
  `2,728484E-12` o simili: residui di zero, non importi decimali del rilascio.
  Restano fuori come Canistro in FC70SOCNID, senza riscriverli a zero.
- Aggregati `ZZ999…`, RSS e Province autonome fuori perimetro.

## Nola, Istruzione

Nola (`063050`) pubblica 1 € di spesa storica Istruzione e 0,0000291834 € per
abitante. Il valore per abitante è arrotondato a dieci decimali, e questo da
solo sposta la popolazione implicita di 1,6 milionesimi, oltre la tolleranza
relativa usata dagli altri adapter. Il normalizzatore accetta in più
soltanto lo scarto dell'ultima cifra pubblicata; una differenza reale fra
totale e valore per abitante blocca ancora il bundle. Il Comune resta
pubblicato con la cifra della fonte, senza correzioni.

## Totali nazionali

Il fabbisogno standard è riproporzionato sul totale della spesa storica della
funzione per Istruzione, Polizia locale, Viabilità, Rifiuti e Amministrazione:
sull'insieme joinato (pubblicati più esclusi) le due somme distano al massimo
2,69 € (Amministrazione). **Sociale e asili nido no**: il fabbisogno supera la
spesa storica del 9,7% (7,16 contro 6,53 miliardi), come negli altri anni la
funzione non riproporziona. I totali sono bloccati nella spec in entrambi i casi
e la differenza aggregata non va letta come risparmio, spreco o fabbisogno
scoperto.

## Cosa non misura

- Nessuna somma o confronto silenzioso con FC60TOT 2019, fra funzioni o con le
  stesse funzioni 2021 e 2022.
- La differenza storica − standard non è spreco né efficienza; i livelli della
  fonte non sono un ranking.
- Nessuna popolazione ricostruita: gli euro per abitante sono quelli pubblicati.

## Verifica

```bash
for f in istruzione polizia viabilita rifiuti sociale_asili amministrazione; do
  DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
    python scripts/etl/opencivitas_2019_${f}_snapshot.py --check
done
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python -m unittest discover -s tests/etl -p 'test_opencivitas_2019_functions_snapshot.py'
node --experimental-strip-types --test \
  tests/opencivitas-2019-functions-contract.test.mjs \
  tests/opencivitas-2019-functions-route.test.mjs
```

Per rigenerare uno snapshot servono i tre ZIP ufficiali in una directory locale:
`python scripts/etl/opencivitas_2019_<funzione>_snapshot.py --input-dir DIR`.

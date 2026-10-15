# Conto Annuale RGS: personale e costo del lavoro

Due distribuzioni ufficiali DFP di dati forniti da MEF–RGS, pubblicate con
**CC BY 4.0**, entrano nel corpus come righe interrogabili:

| Dataset | Righe | Amministrazioni | Fonte |
| --- | ---: | ---: | --- |
| `rgs-conto-annuale-costo-2020` | 244.566 | 10.785 | [Costo del lavoro](https://dati-coll.dfp.gov.it/dataset/costo_lavoro) |
| `rgs-conto-annuale-personale-2020` | 101.546 | 10.330 | [Occupazione](https://dati-coll.dfp.gov.it/dataset/occupazione) |

È uno **snapshot storico 2020**, ultima annualità comune disponibile nelle
risorse di queste distribuzioni al controllo del 7 settembre 2026. Le risorse
CSV sono state pubblicate il 23 settembre 2022 e acquisite il 7 settembre 2026.
La frequenza dichiarata dal catalogo è annuale; l'aggiornamento DVNS è manuale.
Il download diretto dal sito del Conto Annuale RGS (export 2024), pur
accessibile, non è incluso: non è stata trovata una licenza esplicita
applicabile a quella distribuzione. La licenza DFP non viene estesa ad altri
export. È un canale diverso dal catalogo RGS OpenBDAP, le cui pagine dichiarano
CC BY 3.0: da lì viene la serie per tipo di istituzione 2010–2024 descritta
[più sotto](#occupazione-per-tipo-di-istituzione-2010-2024).

## Snapshot DFP 2020: significato e raccordo

- **Costo:** importi annuali in euro interi per ente, contratto e voce di spesa.
  L’allegato alla [circolare RGS 18/2021](https://www.rgs.mef.gov.it/_Documenti/VERSIONE-I/CIRCOLARI/2021/18/allegato-2020.pdf)
  prescrive l’arrotondamento all’euro; non si ricostruiscono centesimi. Sono
  già firmati: le 12.064 righe negative non devono essere negate nuovamente con
  `flag_segno`; 394 valori sono zeri osservati. Il costo del lavoro comprende
  componenti retributive e oneri e **non è SIOPE cassa**. I criteri di rilevazione
  non sono uniformi tra comparti (cassa in prevalenza, competenza economica
  nella sanità): non si producono somme con SIOPE o indicatori di efficienza.
- **Personale:** persone al 31 dicembre, distinte per sesso, tempo pieno e fasce
  part time, contratto e qualifica; non FTE. Il catalogo esclude i contratti
  flessibili. Il dizionario DFP descrive le fasce come inferiori e superiori al
  50%, senza chiarire dove collochi esattamente il 50%: le etichette restano
  quelle del dizionario, senza inferenze.
- **Chiave amministrazione:** `Codice amministrazione RGS` concatena
  `codi_tipo_istituzione:codi_istituzione`, da usare con `Anno`. Il nome e il
  codice fiscale non sono usati per il raccordo; il CF non viene proiettato.
  Questa chiave non è un codice SIOPE o IPA.
- **Copertura:** 10.310 amministrazioni comuni, 475 solo nei costi e 20 solo nel
  personale. Le due tabelle sono a granularità diverse: un join delle righe
  moltiplicherebbe i valori. Non si calcola un costo medio per dipendente.
- **Righe ripetute:** nessuna riga identica; nel personale 220 ricorrenze
  aggiuntive della chiave ente/contratto/categoria/qualifica hanno valori
  diversi. Restano tutte nell'ordine originale, identificate da `sourceRow`;
  non vengono deduplicate, sommate o interpretate come revisioni.
- **Testo:** i byte ufficiali contengono 3.602 caratteri sostitutivi U+FFFD nei
  costi e 250 nel personale. Si conservano senza ricostruire le descrizioni.
  Le celle numeriche sono complete: zero resta `"0"`, non un dato mancante.

[Descrizione metodologica RGS](https://openbdap.rgs.mef.gov.it/it/Home/ContoAnnualeSpesePersonale).
Attribuzione: MEF–Ragioneria Generale dello Stato, distribuzione Dipartimento
della Funzione Pubblica; proiezione DVNS, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Snapshot DFP 2020: riproduzione e verifiche

`scripts/etl/specs/conto-annuale.source.json` blocca URL, risorse annuali,
schema, conteggi, byte e SHA-256. I gzip in `tests/fixtures/conto-annuale/`
conservano i CSV, i dizionari e i metadati del catalogo necessari alla verifica
offline della licenza e del periodo. La proiezione aggiunge anno, chiave
amministrazione e URL ufficiale, traduce le intestazioni e omette il CF.
Non corregge celle né crea totali. La ricevuta del corpus si riferisce ai PSV
normalizzati; byte e SHA-256 dei CSV ufficiali restano nel lock dedicato.

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/conto_annuale.py --output-dir /tmp/conto-annuale
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/conto_annuale.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p 'test_conto_annuale.py'
node --experimental-strip-types --import ./scripts/ci/node-test-setup.mjs --test tests/conto-annuale.test.mjs
```

Il controllo riconcilia dai CSV tutte le righe pubbliche, un chunk alla volta, le ricevute e le
voci di catalogo. Blocca differenze di hash, schema, licenza, periodo, segni,
conteggi, duplicati esatti e copertura delle chiavi. I contatori delle anomalie
note sono espliciti nel lock: ogni aggiornamento richiede una nuova revisione.

La pagina `/incarichi/personale-organi` collega le due anteprime.
Le schede `/dati/<dataset-id>`, le API `/api/dati/<dataset-id>` e MCP
`query_dataset(dataset="spesa_pa_dettaglio", code="<dataset-id>", query="U:11799")`
riusano lo stesso selettore pubblico con paginazione limitata. I campi restano
`string | null`; nessun secondo snapshot di pagina o nuovo tool MCP.

## Occupazione per tipo di istituzione 2010-2024

| Dataset | Righe | Anni | Fonte |
| --- | ---: | --- | --- |
| `rgs-conto-annuale-occupazione-tipologia-2010-2024` | 575 | 2010–2024 | [OpenBDAP, serie `PCA_OCC_DIP_TENT_001`](https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_search?q=PCA_OCC_DIP_TENT_001) |

Il catalogo RGS OpenBDAP pubblica il Conto Annuale anche come un pacchetto
CKAN per anno, `spd_pca_occ_dip_tent_01_<anno>`: una riga per tipo di
istituzione con le persone al 31 dicembre (donne e uomini, tempo pieno e due
fasce part time) e quattro forme di lavoro flessibile. La pagina ufficiale di
ogni anno (`/content/<anno>-dipendenti-pubblici-occupazione-complessiva-dati-tipologia-ente?metadati=show`)
riporta nel campo «LICENZA» [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/),
i pacchetti CKAN `license_id: cc-by`: per questo canale lo stato è
`verified-open-cc-by-3.0`, distinto dalla CC BY 4.0 della distribuzione DFP
e dal download diretto senza licenza. Attribuzione: MEF–Ragioneria Generale
dello Stato, OpenBDAP; proiezione DVNS.

| Anno | Tipi di istituzione | Tempo pieno | Part time | Personale | Lavoro flessibile (unità annue) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2010 | 35 | 3.141.024 | 174.323 | 3.315.347 | 121.828 |
| 2015 | 36 | 3.076.158 | 181.211 | 3.257.369 | 106.156 |
| 2020 | 41 | 3.053.043 | 190.456 | 3.243.499 | 109.698 |
| 2023 | 44 | 3.142.127 | 185.727 | 3.327.854 | 112.549,19 |
| 2024 | 45 | 3.203.478 | 185.316 | 3.388.794 | 116.890,45 |

- **Persone e unità di lavoro:** il personale è tempo pieno + part time fino
  al 50% + part time oltre il 50%, persone e non equivalenti a tempo pieno.
  Tempo determinato, formazione lavoro, interinale e LSU sono unità annue,
  frazionarie dal 2021: non sono persone e non si sommano al personale, anche
  se l'intestazione della fonte dice «Numero Dipendenti».
- **Classificazione:** i tipi di istituzione sono 35 nel 2010, 34 nel
  2012–2013 e 45 nel 2024, sempre in 8 tipologie. Un tipo che compare o
  scompare non è una variazione di personale: fra anni si confrontano i totali
  o i tipi presenti in entrambi.
- **Solo persone:** nessun costo del lavoro; il costo resta nello snapshot DFP
  2020.
- **Date distinte:** anno di rilevazione, data dei dati osservati dichiarata da
  RGS (19 aprile 2022 per gli anni 2010–2020; 8 febbraio 2023, 18 marzo 2024,
  2 luglio 2025 e 8 marzo 2026 per il 2021–2024), creazione del pacchetto CKAN
  e acquisizione DVNS (7 ottobre 2026). RGS può rivedere anni già pubblicati:
  il lock vincola i byte acquisiti.
- **Formato:** valori come pubblicati, interi fino al 2020 e con due decimali
  dal 2021 (il personale resta intero). Il pacchetto storico
  `PCA_OCC_DIP_STOR_001` diverge dai file annuali in 5 anni su 15 (fino a
  −2.627 persone nel 2023) e non è usato.

### Controlli fail-closed

Il lock `scripts/etl/specs/rgs-conto-annuale-occupazione-tipologia.source.json`
vincola per ognuno dei 15 file byte e SHA-256 dell'originale, conservato come
gzip deterministico in `tests/fixtures/rgs-conto-annuale-occupazione/`, URL di
pagina e file, formato dei valori e totali (righe, tipi, tipologie, tempo
pieno, part time, personale, lavoro flessibile). Un'istantanea delle risposte
CKAN `package_show` verifica offline licenza, date di creazione e modifica,
data dei dati osservati e dimensione della risorsa. Il controllo si ferma se:

1. un file cambia schema, anno, numero di tipi o totali, o se il personale non
   è un intero non negativo;
2. i totali 2020 per tipo non si ricalcolano dal file per ente
   `spd_pca_occ_dip_ente_01_2020` (41.593 righe, 10.433 amministrazioni,
   conservato come gzip da 510 KB): il personale deve coincidere per ogni tipo;
   il lavoro flessibile, arrotondato per ente nel file analitico e per tipo in
   quello aggregato, deve restare entro 50 unità per tipo e misura (massimo
   misurato 47, COMUNI) e con gli scarti vincolati nel lock;
3. il personale 2020 per tipo diverge dallo snapshot DFP
   `rgs-conto-annuale-personale-2020` per un tipo diverso da MINISTERI, o se
   cambia lo scarto dichiarato dei MINISTERI (+8 donne e +30 uomini a tempo
   pieno in OpenBDAP). Il raccordo usa le etichette, con un solo alias
   dichiarato (`ENTI  PREVIDENZIALI E ASSISTENZIALI`, con doppio spazio, nel
   CSV DFP). Per amministrazione: le 10.330 di DFP sono tutte in OpenBDAP,
   uguali tranne i codici 8652 (+17) e 10400 (+21); le 103 presenti solo in
   OpenBDAP hanno personale zero.

Gli anni diversi dal 2020 non hanno un file per ente vincolato: i loro totali
per tipo sono controllati sul lock, non ricalcolati. Dettaglio per
amministrazione e flussi (assunzioni, cessazioni) restano fuori da questa
prima parte.

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/rgs_conto_annuale_occupazione_corpus.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/rgs_conto_annuale_occupazione_corpus.py --check --input-dir /percorso/csv-originali
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p 'test_rgs_conto_annuale_occupazione_corpus.py'
```

`--input-dir` accetta i CSV originali con il nome del pacchetto CKAN
(`spd_pca_occ_dip_tent_01_<anno>.csv`, `spd_pca_occ_dip_ente_01_2020.csv`) e
li sottopone allo stesso lock; `--publish` riscrive righe, ricevuta e prove
del corpus.

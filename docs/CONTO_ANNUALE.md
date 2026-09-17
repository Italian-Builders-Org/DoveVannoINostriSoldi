# Conto Annuale RGS: personale e costo del lavoro 2020

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
Il download diretto RGS 2024, pur accessibile, non è incluso: non è stata trovata
una licenza esplicita applicabile a quella distribuzione. La licenza DFP non
viene estesa ad altri export.

## Significato e raccordo

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

## Riproduzione e verifiche

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
node --experimental-strip-types --test tests/conto-annuale.test.mjs
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

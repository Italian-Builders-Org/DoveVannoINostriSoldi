# Controlli a capitolo: contratto, esecuzione, limiti

## Stato di questa consegna

Il CSV RGS originale non è stato acquisito. Il tentativo HTTPS dal container fallisce nella risoluzione del dominio. Non è stata eseguita una verifica integrale delle 5.395 righe. Il rapporto pubblicato conserva `rowsReprocessed: 0` e non confonde i 205 piani gestionali del monitoraggio 2024 con le righe a capitolo del rendiconto 2025.

Le misure di affitti, energia e vettovagliamento sono state analizzate nella relazione RGS sulla spending review 2024. È un'analisi documentale su misure identificate, non l'esecuzione di questo programma sul CSV 2025.

## Fonte congelata

- Risorsa: `2025_RND_SPE_ELB_CAP_001`.
- URL: https://bdap-opendata.rgs.mef.gov.it/export/csv/2025---Rendiconto-Pubblicato-Elaborabile-Spese-Capitolo.csv
- Contratto dichiarato dall'ETL della repository: 4.196.648 byte, 5.395 righe, 41 colonne, codifica Windows-1252, separatore punto e virgola.
- SHA-256 dichiarato: `2887db4905d30445abc795083f2861f969173baf235a56917932c9fcc242e368`.
- Riferimento del contratto: `scripts/etl/rgs_ministries_account.py`, branch al commit `8b14d7da98c221fad64cadbc5a5e692bd8572768`. Questi sono valori di controllo attesi, non una ricevuta di download di questa sessione.

## Esecuzione

Il programma non scarica dati e non modifica pagina, PDF o metadati pubblicati. Richiede il CSV originale disponibile localmente:

```bash
python scripts/reports/audit_rgs_chapters.py /percorso/al/CSV-originale.csv \
  --output /percorso/nuovo/rgs-chapter-audit.json
```

Rifiuta byte, hash, righe, intestazioni o anni diversi. Non contiene un'opzione per saltare il blocco della fonte. Un aggiornamento ufficiale deve essere riconciliato e il contratto aggiornato separatamente, non accettato in silenzio.

## Controlli

Undici identità per riga: tre previsioni definitive, pagamenti di cassa, tre totali, tre economie/maggiori spese e residui finali. Sui 5.395 record attesi sarebbero 59.345 identità; questa è la dimensione potenziale, non il numero eseguito sui dati originali in questa consegna. Le 21 colonne monetarie vengono trattate in centesimi interi. Gli importi ambigui sono rifiutati, mai trasformati in zero.

Le identità delle righe includono le dimensioni ministeriali e funzionali. Lo stesso numero di capitolo in ministeri diversi non è un duplicato. Dimensioni identiche vengono segnalate, ma non equivalgono a una fattura pagata due volte.

I totali restano separati per ministero e titolo. Competenza, residui e cassa non sono addizionati come tre spese distinte. Il rimborso del capitale dei prestiti non diventa spesa finale.

## Segnali, non verdetti

Le soglie predefinite sono 1 milione di euro e 80%: selezionano variazioni rilevanti e quote elevate di impegni non pagati. Non derivano da una legge e non sono soglie di frode. Il file d'esito riporta entrambi i parametri. Anche uno scarto aritmetico di un centesimo viene rilevato, a prescindere dalla soglia di screening.

Un impegno non pagato può non essere scaduto. Una variazione può dipendere da una norma o da un trasferimento. Per pubblicare un nuovo riscontro servono il documento di spesa, la scadenza e la spiegazione della differenza. Nessun risultato del programma è pubblicato automaticamente o trasformato in un totale nazionale di sprechi.

I 18 test unitari usano righe sintetiche. Verificano il codice, non la correttezza o completezza del CSV mai acquisito.

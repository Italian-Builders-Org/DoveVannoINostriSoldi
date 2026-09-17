# MEF: principali grandezze IVA, dichiarazioni 2024 e 2025

Implementa il solo perimetro di [#388](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/388): fonte, snapshot tipizzato, API e MCP, senza UI. Il binario tipizzato è richiesto esplicitamente dall’issue per preservare misure, assenze motivate, edizioni e identità territoriali; non duplica un dataset del corpus integrato.

## Fonte e perimetro

Titolare: MEF, Dipartimento delle Finanze. Acquisizione e controllo: **11 settembre 2026**. I quattro export CSV ufficiali sono quelli della navigazione dinamica, tematica «Principali grandezze IVA», contribuente «Totale». Regione e sezione di attività rimangono tabelle separate. Non esiste qui un incrocio regione × attività.

| Presentazione | Anno d’imposta | Pubblicazione della fonte | Taglio | Righe comprese quelle totali |
| --- | --- | --- | --- | --- |
| 2024 | 2023 | 16 aprile 2025 | Regione | 23 |
| 2024 | 2023 | 16 aprile 2025 | Sezione attività | 23 |
| 2025 | 2024 | 23 aprile 2026 | Regione | 23 |
| 2025 | 2024 | 23 aprile 2026 | Sezione attività | 24 |

Gli anni d’imposta provengono dall’intestazione CSV e dalla pagina HTML, non sono dedotti dal nome dell’URL. La «Data ultimo aggiornamento» nel CSV è la pubblicazione del rilascio, distinta da acquisizione e controllo. La serie è annuale; nessun aggiornamento automatico viene aggiunto in questa prima fetta.

La licenza **CC BY 3.0 IT** è verificata su ciascuna pagina-tabella nel link effettivo `http://creativecommons.org/licenses/by/3.0/it/` che racchiude l’immagine CC BY. Non è inferita dal catalogo IRPEF. I byte delle quattro pagine HTML sono acquisiti e hashed insieme agli export, e verificati dal generatore per licenza, anno, unità e dizionario delle etichette.

## Contratto numerico

Il CSV dichiara «Ammontare e media in migliaia di euro». Ammontare è un intero con separatore delle migliaia `.`, media usa due decimali con `,`; contribuenti e frequenza sono interi non negativi. Il segno negativo è ammesso solo per ammontare e media del valore aggiunto fiscale, come osservato nelle righe «Non indicata» e «Amministrazione pubblica e difesa».

Il prodotto espone importi in centesimi: ammontare × 100.000 e media × 100.000, mediante `Decimal` e le primitive monetarie condivise, senza float o arrotondamento aggiuntivo. Questo non aumenta la precisione della fonte: gli ammontari restano multipli di 100.000 centesimi e le medie multipli di 1.000 centesimi. Per esempio `1.305,94` migliaia di euro diventa `130594000` centesimi. Tutti i numeri devono restare nell’intervallo degli interi sicuri JavaScript.

Ogni cella è `{value, status}`: `observed` comprende gli zeri effettivi, `suppressed` conserva `***` con `value: null`, `missing` conserva le celle vuote con `value: null`. Nessuna soppressione viene ricostruita per differenza. Numero contribuenti è autonomo; frequenza, ammontare e media restano distinti per ciascuna delle dieci misure.

## Identità e deriva del formato

Il codice sorgente territoriale `04` compare due volte: `regione:04-trento` e `regione:04-bolzano` mantengono le due Province autonome separate. La voce «Non indicata» conserva il codice `00`; il totale nazionale ufficiale è `0` e non viene distribuito tra territori.

I codici attività sono locali all’edizione: `attivita:2024:11` significa attività finanziarie e assicurative, mentre `attivita:2025:11` significa telecomunicazioni, programmazione e consulenza informatica e altre attività dei servizi d’informazione. I dizionari originali per edizione sono bloccati nello source lock e verificati contro le etichette delle rispettive pagine HTML. Non si attribuisce una classificazione ATECO non dichiarata dalla pagina e non si costruisce una serie omogenea sul solo codice numerico.

I CSV sono UTF-8 con BOM, delimitatore `;`, otto righe informative, una vuota, intestazione, dati, una vuota e nota delle unità. I file del 2024 hanno **35 righe complessive ma 23 righe di dati**, non 35 osservazioni. L’attività 2025 ha 36 righe complessive e 24 dati.

La fonte non racchiude tra virgolette alcuni nomi di attività che contengono `;`. Il parser accetta esclusivamente i frammenti esatti dell’etichetta bloccata per quella riga ed edizione, quindi legge il suffisso di codice e 31 celle numeriche. Una colonna aggiuntiva, un’etichetta diversa o un’intestazione alterata blocca la generazione: non viene applicata una riparazione generica di CSV malformati.

## Riconciliazioni e limiti

Le frequenze e i contribuenti riconciliano esattamente con il totale pubblicato quando tutte le celle sono osservate. Per gli ammontari la tolleranza è `(numero righe incluso totale) × 500 euro`, corrispondente all’arrotondamento indipendente di ciascuna cella a mille euro. Non si sommano le medie. Una riconciliazione con celle soppresse non viene effettuata né usata per imputarle. I totali pubblicati nelle due classificazioni dello stesso anno devono coincidere integralmente.

Sono dichiarazioni, non incassi fiscali effettivi, evasione o tax gap. Chi non dichiara non è rappresentato. Il valore aggiunto fiscale non è quello della contabilità nazionale. Questi importi non si sommano a SIOPE, spesa pubblica o bilanci. IRAP, IRES, nuovi tagli e nuove pagine restano fuori dall’issue.

## Lock, rigenerazione e controlli

`scripts/etl/specs/mef-iva-2024-2025.source.json` conserva URL, SHA-256, dimensioni dei byte, metadati e dizionari di tutte le fonti. Gli input pubblici sono acquisiti in una cartella di lavoro esterna al repository, senza archivi privati. La rigenerazione richiede gli otto file originali denominati nello source lock; il generatore non scarica dati durante CI o runtime.

```bash
python3 scripts/etl/mef_iva_snapshot.py --write --input-dir /percorso/input-ufficiali
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/mef_iva_snapshot.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_mef_iva_snapshot.py'
```

Il digest `dataCanonicalSha256` nel lock vincola la proiezione indipendentemente dai metadati dell’artifact. La forma canonica JSON usa chiavi ordinate ricorsivamente, UTF-8 senza escaping ASCII, separatori compatti e nessuna newline. Il digest del lock usa la stessa forma con il solo `integrity.lockSha256` impostato a stringa vuota. I metadati conservano inoltre hash e dimensioni dei byte JSON pubblicati con indentazione e newline finale.

Qualsiasi nuovo rilascio richiede una nuova acquisizione verificata e revisione del lock, mai il ricalcolo degli hash per aggirare un errore. I test coprono unità, soppressioni, negativi, precisione, Province autonome, cambio dizionario, schema CSV, riconciliazioni e artifact alterati con metadati ricalcolati.

## Ricevute CSV

| Tabella ufficiale | Byte | SHA-256 |
| --- | --- | --- |
| [2024CIVATOT020201](https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?tree=2024CIVATOT020201&page=1&media=media&personalizza=no&export=3&aggiornato=1615465800) | 7592 | `8d61d95bd892f3906dd542bd8be1c0eeb77c18cda6ef739a0a8f8490569327c5` |
| [2024CIVATOT020202](https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?tree=2024CIVATOT020202&page=1&media=media&personalizza=no&export=3&aggiornato=1615465800) | 7942 | `412a7fbdcf0547b638222bca64b9a544ab96f412b04a8383594f22f815df9016` |
| [2025CIVATOT020201](https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?tree=2025CIVATOT020201&page=1&media=media&personalizza=no&export=3&aggiornato=1615465800) | 7577 | `029a4618492d5e0e835c2059db33cffe66e0f6818b929f5a14970592987a9a12` |
| [2025CIVATOT020202](https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?tree=2025CIVATOT020202&page=1&media=media&personalizza=no&export=3&aggiornato=1615465800) | 8496 | `00ca5fafaef0b3f7d9c06051f91f16df87c0fa8dd2bb913d7e19d0929b5e337a` |

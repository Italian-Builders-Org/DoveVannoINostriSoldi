# Revisione editoriale e visuale del rapporto, PR #509

Base verificata: `b9e7d5c347bbd027bab4ed0111b84fd8015de3ba`, branch
`codex/ampliamento-report-2026`. Le correzioni CI già introdotte da Domenico
restano conservate. Questo pacchetto non esegue operazioni remote.

## Un solo rapporto

URL canonico e download rimangono `/report/bilancio-stato-2025` e
`/report/bilancio-stato-2025.pdf`. L'URL introdotto dalla prima importazione
`/report/spesa-pubblica-italiana-2026` restituisce un redirect permanente alla
pagina canonica ed esce dall'elenco delle pagine indicizzabili. L'archivio,
l'annuncio e la navigazione presentano un solo articolo aggiornato.

Il manoscritto della #506 e il suo archivio delle prove non sono modificati.
I vecchi artefatti `public-spending-2026` restano congelati per riprodurre i
controlli della prima importazione. Non costituiscono un'altra pagina del sito.
Il contenuto leggibile, il PDF aggiornato, il JSON pubblico e il CSV derivano
da `src/content/reports/state-budget-reader.json`.

## Contenuto e provenienza

Dieci funzioni COFOG, 17 riscontri, 25 operazioni decimali, 54 metriche e 38
riferimenti. I 17 riscontri non sono 17 scoperte nuove: comprendono gli 11 casi
originari, sei approfondimenti aggiuntivi, e quattro filoni nuovi rispetto al
primo ZIP importato nella #509 (discariche, indennizzi Pinto, Camerano, NAS).

- Discariche: il Commissario riporta circa 270 milioni pagati all'UE nel
  2014-2024. La penalità semestrale comunicata il 4 marzo 2026 scende da 42,8
  a 0,8 milioni. Il rapporto non confonde pagamenti cumulati e risparmio annuo.
- Pinto: 121,3 + 86,1 = 207,4 milioni, somma di importi arrotondati pagati nel
  2025, inclusi arretrati. Il costo deriva dai ritardi; il risarcimento del
  cittadino non è una prestazione da eliminare.
- Camerano: ANAC contesta sette varianti non giustificate e una durata
  rideterminata da 870 a 3.045 giorni. Sono riportati anche ampliamenti e
  adeguamenti descritti dalla Regione. L'intero aumento non è classificato
  come spreco, né si presenta una verifica dei costi finali del cantiere.
- NAS: 238 strutture non conformi su 558 controllate, circa 42,7%. Nel
  comunicato, 525 + 31 = 556: il dettaglio organizzativo non riconcilia con il
  totale. Campione mirato, non stima rappresentativa di tutte le mense; non
  conosciamo la quota di strutture/contratti pubblici nel campione.

I calcoli originali del contratto RTI derivano dal confronto DVNS della prima
analisi, non dal decreto ministeriale che identifica le nove imprese. Numeratore
e denominatore sono entrambi ridotti di 48.191.320 euro. L'8,03% non è una quota
corretta dei ricavi della capofila. La fonte della baseline DVNS è distinta.

Il registro delle fonti documenta come è stato consultato ciascun riferimento.
Alcune pagine sono state lette tramite il testo restituito dal motore di ricerca,
perché l'apertura diretta era bloccata. Non sono stati scaricati i byte dei nuovi
siti o dei PDF integrali ANAC/NAS: i relativi hash rimangono null. Gli hash del
manoscritto e del PDF attestano la consegna, non certificano quei documenti.
Le evidenze macro sono 11 celle esatte lette dal connettore: il bundle intero
Eurostat resta oggetto del gate nel repository completo. Nessun dato sintetico
viene installato come snapshot di produzione.

## Interfaccia e PDF

Palette DVNS dal design system: inchiostro #182b3a, petrolio #176575, accento
#b42332. I CSS applicativi usano solo token esistenti. Grafici con valori visibili,
fonti e denominatori; nessun significato affidato al solo colore. Il sito usa
il logo trasparente già nel repository; il PDF usa l'icona ufficiale da 48 px
stampata piccola, non un logo ridisegnato. Non sono distribuiti font.

Conclusioni e spiegazioni semplici sono visibili senza aprire dettagli; formule,
identificativi e informazioni tecniche sono espandibili. Nessuna chiamata AI,
nuova dipendenza JavaScript o richiesta di lavoro al lettore.

## Controlli

Il test `state-budget-reader-snapshot.test.mjs` richiede i byte reali del bundle:
confronta hash, dimensione e importi esatti. Va eseguito nel clone completo.
I controlli ETL originari sui dati della #506 rimangono intatti. Le sole asserzioni
PDF di quel file sono migrate al contenuto aggiornato e alla palette approvata.
La suite browser mensile esistente richiama `inspectStateBudgetReader` e mantiene
le prove di archivio e articolo mensile, aggiungendo il redirect.

PDF già generato e incluso. Per rigenerarlo usare un ambiente di authoring separato
con `requirements-public-spending.txt`, poi:

```sh
python scripts/reports/build_state_budget_reader.py
python scripts/reports/build_state_budget_reader.py --check
node --experimental-strip-types --test tests/state-budget-reader.test.mjs tests/state-budget-reader-snapshot.test.mjs
python -m unittest discover -s tests/reports -p 'test_*spending_report.py'
python -m unittest discover -s tests/reports -p 'test_state_budget_reader.py'
```

I pin del PDF sono versioni, non un lock dei wheel. Il controllo `--check` non
richiede ReportLab e non riscarica fonti. Build, Next typegen, CI, test ETL sui
byte dell'archivio storico, gate dello snapshot completo e browser nell'applicazione
reale non sono stati eseguiti in questo ambiente parziale. La verifica del
componente isolato non sostituisce tali controlli.

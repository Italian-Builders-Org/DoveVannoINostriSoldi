# Velocità programmate dei mezzi pubblici

Prototipo di ricerca: 32 reti utilizzabili in 20 città e una tratta ferroviaria,
44.798 tratti validati. Include tram, autobus, metro, treni e navigazione;
la copertura varia per fonte. Bari non ha servizio nella data scelta e la
ferrovia di Trento non ha geometrie utilizzabili. La vista Treni contiene due
rilevazioni salvate, distinte dalla velocità programmata GTFS.

[Stato completo, funzionalità e lavoro restante](STATO.md).
Strade, acqua, parchi e quartieri OpenStreetMap forniscono il contesto geografico.
I rilievi indicano minuti programmati per chilometro, non ritardi osservati,
traffico, inefficienze o sprechi.

Branch `codex/gtfs-grandi-citta`, base iniziale `41a953e5`, allineato a
`main` `c3fa7372` prima della pubblicazione del branch. Nessuna modifica a pagine,
API, dipendenze, cron o configurazione Vercel del prodotto.

## Riprodurre

Python 3.12+, sola libreria standard. Il comando cartografico sotto usa anche il
curl di sistema per HTTP/2 (opzionale: `--transport urllib` usa solo Python):

```bash
python3 research/trasporti-gtfs/acquire.py --cache research/trasporti-gtfs/cache
python3 research/trasporti-gtfs/basemap.py --cache research/trasporti-gtfs/cache --transport curl
python3 research/trasporti-gtfs/analyze.py \
  --cache research/trasporti-gtfs/cache --date 2026-10-30 \
  --city-date cagliari=2026-10-31 --city-date padova=2026-10-31 \
  --city-date venezia-nav=2026-11-02 --city-date cagliari-tram=2026-10-31 \
  --city-date verona-bolzano-av=2026-11-02 \
  --basemap-cache research/trasporti-gtfs/cache \
  --output research/trasporti-gtfs/output
python3 -m http.server 3274 --bind 127.0.0.1 \
  --directory research/trasporti-gtfs/output
```

Per modificare soltanto l'interfaccia senza rianalizzare gli archivi (input JSON
o `analysis.json.gz`, con limite espanso di 256 MiB):

```bash
python3 research/trasporti-gtfs/render.py \
  --analysis research/trasporti-gtfs/output/analysis.json \
  --basemap-cache research/trasporti-gtfs/cache \
  --output research/trasporti-gtfs/output
```

Aprire `http://127.0.0.1:3274`. La consegna predefinita è una directory:
`index.html` e `cities/*.json.gz` devono restare insieme. Il browser scarica solo
la città scelta, verifica byte e SHA-256, limita la decompressione a 64 MiB e
mantiene al massimo due città decodificate. Richiede localhost o HTTPS e un
browser con `DecompressionStream`; gli errori sono espliciti e recuperabili.

Per un HTML unico apribile offline, aggiungere `--standalone` a `render.py` o
`analyze.py`. In quel formato tutte le città sono incorporate e CSP vieta ogni
connessione. Nel formato predefinito CSP consente soltanto asset sullo stesso
origin. Nessun tile, font remoto, polling, API AI o chiave cartografica.

Ricerca fermate per nome/codice, filtri di velocità e linea, tabella paginata e
CSV mantengono gli stessi valori derivati dal GTFS. Il link alla vista conserva
città e mezzo, filtri, camera e selezione; parametri sconosciuti o non validi non
diventano URL di acquisizione né valori della camera fuori budget. Il link
descrive la vista, non congela lo snapshot: data e hash restano nelle fonti. Zoom, bussola, inclinazione,
rilievo e vista espansa sono controllabili anche da tastiera. Su mobile
l'esplorazione con le dita è esplicita per lasciare libero lo scorrimento della
pagina; la prova fisica pinch/rotazione resta da eseguire.

Il Canvas ridisegna su interazione o ridimensionamento, senza ciclo continuo.
Sfondo e tratti riusano due buffer; hover e selezione non riproiettano la rete.

`acquire.py` riusa i raw dopo verifica di hash, dimensione e URL. `--refresh`
richiede esplicitamente un nuovo GTFS. Limiti: 256 MiB compressi, 2 GiB espansi;
nessuna estrazione ZIP su disco. Per riprodurre i numeri servono **gli stessi
byte**, non un download successivo dallo stesso indirizzo. Cache, ricevute e
artifact generati sono ignorati da Git.

La cartografia è acquisita una volta offline, serialmente, rispettando i
[limiti Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API).
`--endpoint` permette di scegliere fra le tre istanze dichiarate nel codice;
non ci sono retry o cambi automatici di provider. Risposte parziali, timeout,
coordinate non valide e hash diversi bloccano la generazione con basemap.
Un servizio in errore non diventa una mappa vuota. Budget OSM: 64 MiB espansi
per città. `archiveId` e `mapId` riusano archivi e mappe verificati fra mezzi:
nessun nuovo download per metro/autobus già presenti nello stesso feed. Un alias
con URL diversi viene rifiutato; anche un alias cartografico deve avere gli stessi
bounds della ricevuta. `areaId` raggruppa i dataset per città senza cambiare gli
ID dei link precedenti.

Il perimetro cartografico centrale, dichiarato in `feeds.json`, può
essere più piccolo della rete: fuori dall'estratto non sono inventate strade.

## Copertura e date di servizio

| Città | Mezzo | Linee elencate | Linee attive | Corse attive nel feed | Corse con tratti utilizzabili | Tratti distinti |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Milano | tram | 17 | 17 | 4.333 | 4.333 | 1.024 |
| Roma | tram | 5 | 1 | 750 | 750 | 59 |
| Torino | tram | 9 | 8 | 1.854 | 1.854 | 591 |
| Firenze | tram | 2 | 2 | 874 | 874 | 157 |
| Bologna | bus | 240 | 224 | 8.499 | 7.030 | 6.354 |
| Bari | bus | 68 | 0 | 0 | 0 | 0 |
| Cagliari | bus | 45 | 45 | 3.155 | 3.116 | 2.268 |
| Venezia | bus | 94 | 92 | 4.212 | 4.030 | 4.884 |
| Palermo | tram | 4 | 4 | 518 | 468 | 74 |
| Padova | tram | 1 | 1 | 1.153 | 1.144 | 73 |
| Catania | bus | 53 | 50 | 2.868 | 2.868 | 2.713 |
| Milano | metro | 5 | 5 | 2.770 | 2.770 | 266 |
| Milano | bus | 148 | 140 | 18.026 | 17.651 | 5.174 |
| Roma | metro | 4 | 4 | 1.379 | 1.379 | 172 |
| Firenze | treni | 14 | 14 | 780 | 392 | 408 |
| Pisa | treni | 14 | 14 | 780 | 178 | 129 |
| Trento | bus | 43 | 42 | 2.474 | 1.913 | 1.687 |
| Rovereto | bus | 43 | 42 | 2.474 | 500 | 1.349 |
| Ferrara | bus | 80 | 74 | 1.659 | 1.048 | 2.210 |
| Torino | metro | 1 | 1 | 574 | 574 | 44 |
| Lucca | treni | 14 | 14 | 780 | 130 | 130 |
| Torino | bus | 206 | 200 | 11.388 | 9.060 | 6.429 |
| Roma | bus | 427 | 409 | 36.917 | 17.944 | 5.058 |
| Prato | treni | 14 | 14 | 780 | 117 | 76 |
| Livorno | treni | 14 | 14 | 780 | 45 | 89 |
| Venezia | navigazione | 23 | 23 | 1.445 | 1.308 | 434 |
| Sassari | bus | 50 | 46 | 1.023 | 891 | 1.134 |
| Cagliari | tram | 3 | 3 | 324 | 240 | 28 |
| Olbia | bus | 15 | 15 | 319 | 319 | 853 |
| Sassari | treni | 4 | 4 | 98 | 54 | 4 |
| Nuoro | bus | 21 | 14 | 241 | 241 | 919 |
| Nuoro | treni | 4 | 4 | 98 | 13 | 2 |
| Verona–Bolzano | treni (FR 8509/8519) | 175 | 1 | 2 | 2 | 6 |
| Trento | treni | 1 | 1 | 48 | 0 | 0 |

Cagliari (bus e tram) e Padova usano il **31 ottobre 2026**, la navigazione
veneziana e la tratta Verona–Bolzano il **2 novembre 2026**, gli altri feed il
**30 ottobre 2026**.
Sono scelte esplicite basate sui calendari degli archivi acquisiti, senza ripiego
automatico. Le date restano nelle fonti e negli export; nessuna classifica tra
città. A Venezia autobus ACTV e navigazione sono reti separate: il perimetro
navale copre le isole centrali, non tutta la laguna né altri operatori. Le aree
di studio sono dichiarate in `feeds.json`.

Questa è la copertura dei feed acquisiti, non una certificazione dell'intera
rete cittadina. Il feed tram di Roma contiene corse utilizzabili solo della linea 8. Bologna
include coppie con entrambe le fermate nel rettangolo `[11.2,44.4,11.48,44.58]`
(ovest, sud, est, nord): le corse/linee del feed oltre quel perimetro non diventano
copertura della mappa urbana. Nel perimetro sono utilizzabili 135 linee e
7.030 corse programmate. I sensi opposti e le varianti geometriche restano
separati; non sommare i tratti come fermate o chilometri.

**Bari non è una città analizzata:** il calendario acquisito omette il
30 ottobre. È visibile come stato non disponibile, senza ripiegare su un altro
giorno. Il GTFS ufficiale di Genova acquisito non contiene `shapes.txt`: non
viene trasformato in percorsi stradali inventati.

Palermo include TRAM1, TRAM2 e TRAM3: TRAM4 ha corse attive ma nessun tratto
con geometria utilizzabile. Il catalogo descrive un periodo precedente al file
indicato come ultima versione; il servizio mostrato è verificato nel calendario
dell'archivio. Padova include solo SIR1, pubblicata nel feed ufficiale TRAM con
`route_type=3`: l'override nel registro è esplicito e non modifica il raw.
La licenza specifica di Padova va verificata prima della pubblicazione.

Hash, URL finali, date e conteggi sono conservati in `observed-results.json`.
`Last-Modified`, acquisizione, giorno di servizio e aggiornamento OSM rimangono
quattro informazioni distinte. Non sono dati monetari.

## Metodo

1. Applicare `calendar.txt` e le eccezioni di `calendar_dates.txt` per la data
   scelta, nel fuso Europe/Rome. Nessun ripiego su un'altra data.
2. Selezionare i tipi dichiarati per la città e il mezzo: tram 0 e 900–906,
   metro 1, treni 2; per bus/filobus solo i codici espliciti nel registro. Escludere e contare le
   corse a frequenza non espanse.
3. Ordinare per `stop_sequence`, bloccando sequenze numericamente duplicate.
   Considerare soltanto fermate adiacenti; applicare l'eventuale area di studio.
4. Calcolare arrivo successivo meno partenza precedente. Escludere le soste;
   non interpolare orari mancanti né saltare fermate. Conservare gli orari oltre
   24:00 nel giorno di servizio, con limite esplicito 48 ore.
5. Ricavare il percorso dalla shape GTFS. `shape_dist_traveled` è una coordinata
   lungo il percorso, non necessariamente metri. In alternativa proiettare le
   fermate in ordine sulla shape, entro 100 m. Calcolare la lunghezza geodetica
   dalle coordinate. Nessuna shape mancante diventa una retta inventata.
6. Raggruppare linea, direzione, fermate e geometria. Dividere la distanza per
   la **mediana dei tempi**, non fare la mediana delle velocità.
7. Separare partenze 07–10, 10–16, 16–20 e intero giorno di servizio.

Durate nulle/negative e geometrie sotto 25 m sono escluse e contate. Il controllo
di plausibilità esclude velocità oltre 150 km/h; per i soli treni è dichiarato
`maxSpeedKmh=300`, senza applicare ai treni il limite urbano. Gli orari stimati/arrotondati dal titolare non sono osservazioni.
Fermate omonime possono includere manovre o capolinea. Le corse sono campioni
dell'orario, non passeggeri. Non confrontare le città come una classifica.

La quota è lineare in min/km, saturata a 12 min/km; tabella e dettaglio
mantengono il valore completo. La forma curva è un'interpolazione grafica tra
fermate, non una misura della variazione di velocità dentro il tratto. I punti della rete
rappresentano estremi dei segmenti; la ricerca fermate usa le coordinate di
`stops.txt`, conservando identità e omonimi distinti. Il basemap non cambia tempi o
distanze GTFS; la quota non rappresenta altitudine.

## Fonti e riuso

- [Milano, Comune/AMAT](https://dati.comune.milano.it/dataset/ds929-orari-del-trasporto-pubblico-locale-nel-comune-di-milano-in-formato-gtfs): CC-BY, versione non specificata nel campo licenza.
- [Roma Servizi per la Mobilità](https://romamobilita.it/sistemi-e-tecnologie/open-data/): licenza della risorsa da verificare prima della pubblicazione.
- [GTT, condizioni GTFS](https://www.gtt.to.it/gtt_gtfs_license.html): solo uso non commerciale, attribuzione e collegamento GTT obbligatori, conservati nel visualizzatore. Il codice non cambia la licenza dei dati.
- [Firenze, Regione Toscana/GEST](https://dati.toscana.it/dataset/rt-oraritb/resource/1f62d551-65f4-49f8-9a99-e19b02077be3): CC-BY nel catalogo, versione non specificata.
- [Bologna, TPER](https://solweb.tper.it/web/tools/open-data/open-data-detail.aspx?filename=gommagtfsbo&source=): CC-BY 3.0 Italia.
- [Bari, AMTAB](https://www.amtab.it/it/openmobilitydata): condizioni da verificare; calendario del giorno assente.
- [Cagliari, CTM / Sardegna Mobilità](https://www.sardegnamobilita.it/open-data/quadri-orari-ctm): CC-BY 4.0 secondo il portale Sardegna Mobilità.
- [Venezia, ACTV](https://actv.avmspa.it/en/node/3969): feed automobilistico; licenza della risorsa da verificare prima della pubblicazione.
- [Palermo, Comune/AMAT](https://opendata.comune.palermo.it/opendata-dataset.php?dataset=1783): condizioni specifiche tram CC BY-SA 4.0; geometrie basate su OSM sotto ODbL.
- [Padova, Busitalia Veneto](https://gtfs-biv.fsbusitalia.com/): risorsa ufficiale TRAM SIR1, licenza non dichiarata nella pagina.
- [Catania, AMTS](https://www.amts.ct.it/open-data): IODL 2.0; rete autobus entro il perimetro urbano dichiarato.
- [Firenze, Pisa e Lucca, Regione Toscana/Trenitalia](https://dati.toscana.it/dataset/rt-oraritb/resource/4f85393b-357d-443d-8378-65de4198505f): regionali toscani, CC-BY nel catalogo, versione non specificata. Il file è datato 15/01/2026 e contiene calendario per il 30/10: non certifica l’orario oggi in esercizio. Entrambe le fermate devono rientrare nei perimetri dichiarati. Le 14 linee e 780 corse iniziali sono regionali; le colonne successive misurano i tratti utilizzabili nelle singole aree.
- [Lombardia/Trenord](https://www.dati.lombardia.it/Mobilit-e-trasporti/Orario-Ferroviario-Regionale-Gtfs/3z4k-mxz9): archivio verificato ma senza `shapes.txt`, escluso dalla mappa. Nessun tracciato è ricostruito a partire da sole stazioni.
- [Trento e Rovereto, Trentino Trasporti](https://www.trentinotrasporti.it/en/opendata): CC BY 4.0. Stesso archivio urbano, perimetri distinti; i conteggi iniziali di 43 linee/2.474 corse riguardano tutto il feed. Con tratti utilizzabili: 25 linee per Trento e 13 per Rovereto. Funivia esclusa. Il file extraurbano include 48 corse attive della ferrovia R35 prive di shape utilizzabile: non vengono disegnate.
- [Ferrara, TPER](https://solweb.tper.it/web/tools/open-data/open-data-detail.aspx?filename=gommagtfsfe&source=): CC BY 3.0 Italia. Area urbana dichiarata, con 45 linee utilizzabili; i collegamenti fuori perimetro non diventano copertura cittadina.
- [Genova, AMT](https://www.amt.genova.it/amt/societa_trasparente/altri-contenuti/open-data/): nessuna geometria nel feed acquisito, non inclusa nel visualizzatore.
- [OpenStreetMap, ODbL 1.0](https://www.openstreetmap.org/copyright): attribuzione sempre visibile e ricevuta separata. Per redistribuire gli estratti rispettare ODbL e disponibilità della banca dati derivata.
- [Specifica GTFS Schedule](https://gtfs.org/documentation/schedule/reference/).

## Verifica

```bash
python3 -m unittest discover -s research/trasporti-gtfs -p 'test_*.py'
node --test research/trasporti-gtfs/test_camera.mjs research/trasporti-gtfs/test_explorer.mjs research/trasporti-gtfs/test_view_state.mjs research/trasporti-gtfs/test_catalog.mjs
node --check research/trasporti-gtfs/viewer.js
```

Cinquantuno test offline: 27 Python e 24 Node. Fixture sintetiche per calendario,
geometrie, budget, date esplicite, coordinate fermate, asset statici e integrità;
proiezione/inversa, zoom ancorato, fit, rotazione e trasformazione pinch;
ricerca, confini dei filtri, CSV e link alla vista. I nuovi contratti sono stati provati in RED
prima delle relative implementazioni.
Verifica Browser e artifact ripetibili: `VERIFY.md`.

Gate Next/ETL del prodotto e CI ospitata: **NOT RUN**. La modifica è confinata
alla ricerca locale. Prima di una futura integrazione servono registrazione
nel corpus come derived-only, provenance/ledger, review licenze e gate del
prodotto. Nessuna build Vercel viene avviata per il prototipo.

## Dettagli dell’interfaccia

Le sezioni informative restano `<details>` nativi. `disclosure.mjs` aggiunge

- e −, apertura 180 ms e chiusura 140 ms. Tastiera, movimento ridotto e browser
  senza Web Animations usano il cambio immediato. Click rapidi, cambio città,
  resize e sostituzione del dettaglio non lasciano altezze fisse o focus nascosto.
  Anche il cambio della preferenza di movimento completa le animazioni attive.

Candidato non integrato: il file collegato dalla pagina ufficiale di Taranto,
acquisito il 31/10/2026, non ha servizi per il 30 o 31 ottobre. Non viene
sostituito silenziosamente con un altro giorno. Bari resta invariata.

## Menu e mezzi

I selettori nativi restano il fallback. Il miglioramento progressivo aggiunge
menu con ricerca nelle liste lunghe, check della scelta, nomi a capo e spazio
limitato alla viewport. Enter/frecce selezionano, Escape annulla, Tab esce verso
il campo successivo. Nessun cambio viene applicato durante la sola ricerca.
L’apertura chiude la ricerca fermate; un cambio città conserva il mezzo se
utilizzabile, altrimenti sceglie una rete disponibile. Linea e selezione sono
azzerate per non riusare identificativi di un altro feed.

`select-menu.mjs` contiene il comportamento dei menu; il controller sincronizza
opzioni, valore e disabilitazione nei punti che cambiano dati. Non intercetta i
setter nativi e non installa observer per ogni opzione. Animazione di apertura
130 ms solo da puntatore; tastiera e movimento ridotto sono immediati. Le
ricevute distinguono file aggiornato, acquisizione e giorno di servizio.

## Vista, caricamenti ed export PNG

Il pannello del tratto lascia libero lo spazio dei comandi. L’inquadratura usa
l’ingombro reale del dettaglio e dei controlli, include i punti A/B ufficiali e
si riadatta al resize. «Inquadra» segue prima il tratto o la fermata attivi;
senza dettaglio mostra l’intera selezione filtrata. Città e quartieri hanno
priorità sulle etichette stradali; l’ordine è preparato una volta per rete.

Durante un cambio città, mappa, righe e fonti precedenti diventano non
interattive e dichiarano aria-busy. I download superati vengono annullati;
un ritorno rapido alla stessa città avvia un nuovo task se quello precedente
è già annullato. La cancellazione non marca l’asset come corrotto e il cleanup
di un vecchio task non rimuove il suo sostituto. Byte, hash e budget di
espansione restano verificati. Nessun polling o aggiornamento per visita.

«PNG» esporta la vista corrente in locale, con città, mezzo, fascia, eventuale
linea/tratto, data, legenda, nord, scala, fonte e condizioni di riuso. Non è una
cattura dell’interfaccia: il pannello e i pulsanti non entrano nell’immagine.
La risoluzione è limitata a 2.048 px di larghezza; non ci sono API o upload.
Gli stati ordinari sono annunciati senza muovere il layout; l’errore resta
visibile e il pulsante torna disponibile. La versione offline supporta anche
questo export. Le immagini GTT conservano il vincolo non commerciale.

### Iterazione 8

Lucca: due linee regionali utilizzabili, 130 corse con tratti nell’area, 130 tratti distinti (62 al mattino). Il feed Toscana è lo stesso archivio verificato di Firenze/Pisa, datato 15/01/2026. Perimetro dichiarato 10,3–10,7 E / 43,75–43,99 N; la cartografia copre lo stesso rettangolo. Non è la rete ferroviaria completa della provincia né una verifica dell’orario corrente.

Le intestazioni km/h e Corse ordinano la selezione in entrambi i versi. Il CSV mantiene l’ordine scelto; Copia link conserva anche l’ordinamento. I link precedenti partono ancora dalle velocità crescenti. I filtri non cambiano i valori né il numero dei tratti quando cambia soltanto l’ordine.

Livorno resta candidato: 89 tratti GTFS utilizzabili, ma cartografia non acquisita dopo HTTP 502 e timeout di due provider. Non è mostrato come città disponibile. Le fonti precedenti restano identiche.

### Iterazione 9

Aggiunti autobus di Torino (6.429 tratti, 131 linee utilizzabili nell’area) e Roma (5.058 tratti, 170 linee). Sono derivati dagli stessi archivi ufficiali già acquisiti, con entrambe le fermate entro il perimetro cartografico dichiarato. Nessun nuovo download GTFS, fonte runtime o servizio esterno per esplorarli. Roma resta con licenza da verificare prima di pubblicare; GTT resta non commerciale.

Il badge linea nel dettaglio filtra e inquadra la linea; se già filtrata ripristina tutte le linee. Mantiene fascia, filtro di velocità e ordine, chiude il dettaglio e riporta il focus alla mappa. La selezione visibile attenua maggiormente gli altri tratti; se esce dalla vista il contesto torna al contrasto normale.

**Controllo geometrico aggiornato per tutte le reti.** La soglia fermata/tracciato passa da 250 a 100 metri, secondo [GTFS Best Practices](https://gtfs.org/documentation/schedule/schedule-best-practices/#shapestxt). Riprodotto un caso in cui una fermata distante dal tracciato trasformava 263 m fra fermate in 31 m di geometria e una velocità ingannevolmente bassa. Non sono ridisegnate strade né modificati gli archivi: le coppie non affidabili vengono escluse e conteggiate.

Il confronto completo è nell’artifact `geometry-audit.json`. Tra le reti precedenti cambiano Milano bus, Trento, Rovereto e Ferrara: 64 geometrie rimosse e 17 aggiunte dopo la proiezione corretta; quattro tratti comuni di Rovereto cambiano campioni/tempi. Non sono dichiarati tutti i risultati precedenti identici. I byte e le ricevute delle fonti restano invariati.

Prato e Livorno restano candidati non esposti: dati ferroviari preliminari disponibili, cartografia rifiutata/non acquisita. Il dataset preliminare è conservato separatamente e richiede il controllo geometrico aggiornato prima di essere integrato.


### Iterazione 10

Prato e Livorno sono ora integrate: rispettivamente 76 e 89 tratti ferroviari,
117 e 45 corse con tratti utilizzabili, tre e due linee. Sono estratti parziali
regionali, non reti urbane complete. Il perimetro di Prato è limitato all’area
urbana e alla cintura immediata; Livorno include la costa fino a Rosignano.
Entrambi rispettano la soglia geometrica di 100 m. Le precedenti 23 voci,
cartografia inclusa, sono identiche all’artifact v9.

La cartografia è stata acquisita con POST dall’istanza pubblica Private.coffee
elencata da OSM, dopo i fallimenti precedenti. Ricevute e hash sono conservati;
il database OSM dichiara maggio/giugno 2026. Il feed Toscana resta il file del
15 gennaio 2026 con calendario valido per il 30 ottobre: non viene presentato
come verifica dell’orario corrente o dei ritardi.

La X accanto alla linea rimuove solo quel filtro, conservando fascia, velocità
e ordine. Freccia e X hanno spazi distinti; il focus torna al selettore senza
spostare la pagina. Slider e pulsanti zoom condividono i limiti della camera,
anche quando il massimo non è intero; durante il caricamento restano inattivi.

Il renderer legge anche l’analisi gzip. Gli output identici non sono riscritti;
quelli cambiati vengono sostituiti atomicamente, preservando versioni precedenti
collegate e il file valido in caso di errore. Nessuna modifica a metriche o
budget del client. HTML singolo offline nuovamente generato e verificato.

Prove: 60 test offline, tutte le 100 reti/fasce nel Browser, 12 rimozioni del
filtro linea e 36 stati zoom su quattro viewport, più caricamento con resize.
Artifact `gtfs-20261101-v10`, con dati congelati, osservazioni, screenshot e
`verify.py`. La verifica touch su telefono fisico e i gate del prodotto non
sono eseguiti. Solo branch locale, nessun push o deploy.


### Iterazione 11

[Sassari, catalogo regionale](https://www.sardegnamobilita.it/open-data/quadri-orari-atp-sassari):
1.134 tratti autobus ATP, 891 corse con tratti utilizzabili e 43 linee nel centro.
[ACTV, catalogo ufficiale](https://actv.avmspa.it/en/node/3969): aggiunta la
navigazione di Venezia, distinta dagli autobus, con 434 tratti e 22 linee nel
perimetro delle isole centrali. Non comprende tutta la laguna né altri operatori.
Le precedenti 25 voci sono identiche all’artifact v10.

Il GTFS ACTV acquisito, datato 27 ottobre, copre il 2–20 novembre: la data di
servizio della navigazione è esplicitamente il 2 novembre. Non è applicato al
30 ottobre. Sassari mantiene il 30 ottobre; fermate fuori perimetro, tempi non
positivi, geometrie assenti/non affidabili e velocità implausibili sono esclusi
e conteggiati. Le licenze di questi due feed non sono dichiarate nelle pagine
consultate: nessuna autorizzazione di pubblicazione viene dedotta.

La mappa apre sul centro delle due nuove reti; Inquadra conserva la vista
completa. La scheda al passaggio del mouse mostra linea, velocità e fermate.
Usa le dimensioni reali per restare dentro la mappa, anche con nomi lunghi; si
chiude su camera, filtri, caricamento, selezione, Escape, scroll e perdita del
focus. Nessuna animazione su hover o tastiera. Il contenuto è aggiornato solo
quando cambia il tratto; il movimento nella stessa curva riposiziona la scheda.
Gli stessi dati restano accessibili da tastiera nella tabella e nel dettaglio.

Cartografia con ricevute: Venezia da Private.coffee POST, base OSM 15 luglio;
Sassari dal principale GET, base OSM 1 novembre. Per Sassari sono conservati i
fallimenti precedenti su area maggiore (timeout/502); il perimetro finale è il
centro, non l’intera rete suburbana. ANM Napoli non integrata: redirect seguito
da HTTP 403, senza bypass.

Prove: 61 test offline, 108 reti/fasce nel Browser, 12 casi responsive a
320/390/573/1280 px, quattro tooltip ai bordi, ricerca vuota/recupero da tastiera,
CSV 434 righe confrontato con i dati e PNG ispezionato. HTML unico offline con
nuove reti e commutazione dell’esplorazione mobile verificati. Artifact
`gtfs-20261101-v11`, con `verify.py`, dati, ricevute e screenshot. Nessun push,
PR, deploy, build Vercel o test su telefono fisico.


### Iterazione 12

[Olbia, catalogo ASPO](https://www.sardegnamobilita.it/open-data/quadri-orari-aspo):
853 tratti autobus, 319 corse e 15 linee con tratti utilizzabili nel perimetro
urbano dichiarato. [Cagliari, catalogo ARST](https://www.sardegnamobilita.it/open-data/quadri-orari-arst):
28 tratti tram, 240 corse e due linee con tratti utilizzabili; servizio del
31 ottobre, come il feed autobus già integrato. Le fasce possono contenerne
meno: mattina 658 tratti a Olbia e 22 nel tram di Cagliari.

Il [catalogo generale Sardegna Mobilità](https://www.sardegnamobilita.it/open-data)
indica CC BY 4.0 per i dataset: la licenza è registrata per entrambe le nuove
reti e corretta anche per Sassari autobus. Delle precedenti 27 voci, 26 sono
interamente identiche; Sassari cambia soltanto license, licenseUrl e sourceNotes.
Misure, geometrie, fermate, ricevute, cartografia ed esclusioni di tutte le
27 reti precedenti restano identiche. Totale: 43.867 tratti geometrici; non sono
fermate, chilometri o una classifica tra città.

Il GTFS ARST comprende anche il tram di Sassari, ma tutte le 84 corse MSS nel
file hanno geometria mancante. Non viene integrato né ricostruito con percorsi
autobus. Cagliari riusa il basemap verificato; Olbia ha un estratto OSM dedicato
con ricevuta e hash. Raw e analisi del candidato escluso sono conservati.

Intestazione ridotta a marchio, titolo e limite della metrica. Data di servizio
solo nelle fonti e negli export, senza badge tecnico o footer ripetitivo. Il
contatore non ripete la linea già selezionata. Titolo mobile a tutta larghezza;
condivisione, scelta del mezzo e chiusura del dettaglio hanno target di almeno
44 px. Nessuna modifica alle proiezioni o alla camera per correggere screenshot
provenienti da anteprime precedenti.

La preview stabile è `http://127.0.0.1:3274/?v=iteration12-final&city=olbia`.
È stata aggiornata dopo il controllo del candidato, con sostituzione atomica
dell'HTML e conservazione del precedente indice e degli asset storici. Un tab
che mostra ancora la versione precedente deve ricaricare la pagina; il solo
parametro della versione non aggiorna un documento già aperto.

Prove: 61 test offline; 116 reti/fasce confrontate riga per riga con l'analisi;
16 casi responsive a 320/390/573/1280 px, selezioni e menu senza sovrapposizioni,
CSV di 28 righe e PNG reali. Asset corrotto a parità di dimensione: errore
esplicito, nessuna fonte/data/riga residua e recupero dopo il ripristino. HTML
unico offline verificato con le nuove reti e CSP senza connessioni. Artifact
`gtfs-20261101-v12`, verificatore e screenshot. Solo locale: nessuna build
Vercel, modifica al prodotto, pubblicazione o prova su telefono fisico.


### Iterazione 13, 2 novembre 2026

[ATP Nuoro](https://www.sardegnamobilita.it/open-data/quadri-orari-atp-nuoro):
919 tratti autobus, 14 linee e 241 corse con tratti utilizzabili nell'area
urbana dichiarata. Il file acquisito il 2 novembre ha Last-Modified 14 ottobre, 23:18 UTC
(15 ottobre in Italia); il giorno analizzato resta il 30 ottobre. [ARST](https://www.sardegnamobilita.it/open-data/quadri-orari-arst):
aggiunti i treni nel centro di Sassari (4 tratti, 2 linee, 54 corse) e tra
Nuoro e Pratosardo (2 tratti, 1 linea, 13 corse). Non rappresentano le intere
linee regionali. Nessuna modifica alle 29 fonti precedenti. Totale: 44.792
geometrie, 31 reti utilizzabili in 20 città; Bari resta non disponibile.

La ricerca nei menu combina parole indipendenti dall'ordine e ignora accenti,
spazi multipli e punteggiatura: «Roma bus» trova Roma, «bus roma» dà lo stesso
risultato. Restano invariati i valori delle opzioni e la scelta separata del
mezzo. Il piccolo indicatore accanto alla velocità in tabella usa la palette
del renderer; il numero resta l'informazione accessibile. Le strade di sfondo
hanno contrasto più basso, senza perdere geometrie, etichette o interazioni.

Il basemap di Nuoro contiene 1.699 elementi e 10 etichette, base OSM del
2 novembre. I provider già configurati hanno restituito due HTTP 502 e due
timeout; errori conservati. È stato ammesso un terzo mirror mondiale elencato
nella [documentazione OSM](https://wiki.openstreetmap.org/wiki/Overpass_API),
`https://maps.mail.ru/osm/tools/overpass/api/interpreter`. La scelta è esplicita
nel CLI `--endpoint`, senza tentativi automatici nelle visite. Hash, byte,
perimetro e host della ricevuta restano obbligatori. Nessuna chiave, dipendenza
o servizio a pagamento aggiunto; i client leggono solo gli asset locali.

Verifiche: 62 test offline; 128 reti/fasce, valori e colori confrontati con
l'analisi; 16 scenari responsive; zoom ai limiti, rotazione e 2D/3D; focus nella
mappa espansa e uscita con Escape. CSV di 919 righe e PNG verificati; nuove
reti e ricerca provate anche nell'HTML offline. Artifact `gtfs-20261102-v13`
con verificatore e screenshot. Preview stabile: porta 3274, versione
`iteration13-final`. Solo commit locale; nessun push, PR, deploy o build Vercel.

## Iterazione 14: corse ferroviarie e rilevazioni

La vista `treni.html` usa acquisizioni manuali della scheda pubblica
[ViaggiaTreno](http://www.viaggiatreno.it/vt_pax_internet/mobile/). È separata
dalla velocità programmata GTFS. Nessuna richiesta remota durante la visita,
nessuno storico automatico o API a pagamento. Non è un servizio in tempo reale.

Per riprodurla, conservare capsule JSON pubbliche con sole chiavi `url`,
`acquiredAt` (ISO con fuso) e `html` (DOM reso della pagina). Acquisirle tramite
la normale ricerca ufficiale; non aggirare risposte 403. L'URL deve contenere
numero, origine e data restituiti dalla fonte. Non usare biglietti o email.
Il digest identifica il DOM UTF-8 salvato, non i byte HTTP originari.

```bash
python3 research/trasporti-gtfs/render.py \
  --analysis PERCORSO/analysis.json.gz \
  --output PERCORSO/result \
  --rail-capture PERCORSO/8509-dom-capture.json \
  --rail-capture PERCORSO/8519-dom-capture.json
```

`--standalone` produce anche un `treni.html` autonomo; non contiene un link
alla mappa che richiederebbe altri file. Senza capsule il vecchio renderer
resta utilizzabile. Per l'analisi GTFS del nuovo corridoio aggiungere
`--city-date verona-bolzano-av=2026-11-02`; le date precedenti restano invariate.

### Dati verificati il 2 novembre 2026

- **FR 8509, Sibari–Bolzano**: 14/14 passaggi disponibili, arrivo +22 minuti,
  massimo +38 a Napoli Afragola. Aumento maggiore fra Paola e Scalea: +21.
- **FR 8519, Bolzano–Sibari**: 8/13 passaggi rilevati al momento del salvataggio;
  gli ultimi cinque sono previsioni e restano mancanti nell'analisi. L'arrivo
  non è ancora osservato. Massimo osservato +9 a Napoli Afragola.

La variazione confronta ritardi di passaggi consecutivi e può includere la
sosta precedente. Non separa corsa e sosta, non spiega le cause e due corse
non dimostrano un andamento storico. Negativi, zero e mancanti sono distinti.
I tempi disponibili senza data del singolo evento sono accettati soltanto
per corse nello stesso giorno: attraversamenti della mezzanotte vengono rifiutati.

### Nuove fonti e limiti di copertura

[STA / Open Data Hub](https://gtfs.api.opendatahub.com/v1/dataset), CC0,
include gli orari dei due Frecciarossa lungo la corsa completa. Solo **sei
tratti Verona–Bolzano** superano i controlli geometrici entro 100 metri dalle
fermate; gli altri 21 su 27 sono esclusi. La mappa dichiara questo perimetro,
non una copertura nazionale completa. Il profilo OSM `overview` acquisisce
solo viabilità principale e centri abitati, con ricevuta distinta dal profilo
urbano. Nessuna estensione dei budget o allentamento del controllo geometrico.

L'orario GTFS può differire da ViaggiaTreno (Napoli Afragola, FR 8509: 09:39
contro 09:38). Non viene usato per calcolare il ritardo dei passaggi rilevati.
Le coppie sono adiacenti nel GTFS, che può contenere punti orari non commerciali.

[Trentino Trasporti](https://www.trentinotrasporti.it/en/opendata), CC BY 4.0:
48 corse ferroviarie attive del 30 ottobre, ma tutte senza `shape_id` utilizzabile.
Fonte registrata come non confrontabile, zero tratti disegnati. Nuove metro
non aggiunte: i candidati ancora da convertire/verificare non diventano dati
presenti. Le 32 fonti precedenti conservano integralmente i propri oggetti.

L'accessibilità pubblica di ViaggiaTreno non equivale a una licenza aperta:
questa raccolta resta locale. Una futura pubblicazione/storicizzazione richiede
verifica delle condizioni e una fonte con date complete per gli eventi notturni.

L'estratto OSM del nuovo corridoio non è stato acquisito: i tre endpoint
consentiti hanno restituito 504, 502 e timeout. Il pacchetto conserva `basemap:
null`, mostra un avviso e non attribuisce a OSM un fondo assente. I sei tratti
GTFS restano esplorabili; le mappe precedenti sono identiche. `render.py` senza
`--basemap-cache` conserva la cartografia già congelata; specificando la cache
rilegge e verifica tutti gli estratti, fallendo se ne manca uno. Non c'è un
ripiego automatico su un servizio remoto o su una geometria inventata.

## Iterazione 15, 3 novembre 2026: reti, geometrie OSM, storico

Stato sintetico e copertura completa: [STATO](STATO.md).

Nuove reti nel registro: Napoli (ANM metro, tram, funicolari, bus/filobus; EAV
treni), Genova (archivio AMT della Regione Liguria con shape; treni Trenitalia),
Perugia (Minimetrò, bus Busitalia Umbria), Messina (ATM), Trenord (area milanese e
tutta la Lombardia), viste ferroviarie Italia (corse Trenitalia via Liguria),
Toscana e Sardegna. Bari torna utilizzabile con data esplicita 4 novembre.

```bash
python3 research/trasporti-gtfs/acquire.py --cache CACHE --only napoli-metro --only messina
python3 research/trasporti-gtfs/basemap.py --cache CACHE --city italia-treni --transport curl
python3 research/trasporti-gtfs/railgraph.py --cache CACHE --city milano-treni
python3 research/trasporti-gtfs/analyze.py --cache CACHE --date 2026-10-30 \
  --city-date cagliari=2026-10-31 --city-date padova=2026-10-31 \
  --city-date venezia-nav=2026-11-02 --city-date cagliari-tram=2026-10-31 \
  --city-date verona-bolzano-av=2026-11-02 --city-date bari=2026-11-04 \
  --city-date genova-metro=2026-07-15 --city-date genova-funicolari=2026-07-15 \
  --city-date genova-bus=2026-07-15 --basemap-cache CACHE --output OUT
```

`--only` limita l'acquisizione agli ID indicati. `allowedRedirectHosts` nel
registro ammette un reindirizzamento HTTPS verso un host preciso (ANM →
`anmspa.file.force.com`); ogni altro host resta rifiutato. Il profilo cartografico
`national` (autostrade e città) serve la vista Italia: il profilo `overview`
scade su Overpass a quella scala.

**Geometrie ferroviarie da OSM.** Con `derivedGeometry: "osm-rail"`, `railId` e
`railBounds`, `railgraph.py` acquisisce una volta i binari OSM (rail, narrow_gauge,
light_rail) con ricevuta SHA-256. Per ogni coppia di stazioni senza geometria GTFS
l'analisi cerca il cammino più breve sui binari: entrambe le stazioni entro 300 m,
lunghezza ≤ 1,6 × distanza in linea d'aria + 300 m, binari di servizio penalizzati.
Il tratto porta `geometrySource: "osm-rail"` e il dettaglio lo dichiara; le coppie
rifiutate sono contate (`osm_rail_station_off_track`, `osm_rail_no_path`,
`osm_rail_detour`). La distanza è quella del percorso sui binari.

**Scale.** Reti urbane: rilievo e colore su 0–12 min/km, classi 10/15/25 km/h.
Treni: 0–3 min/km, classi 40/70/100 km/h. Lo stesso colore non significa la stessa
velocità fra le due scale; la legenda lo dice.

**Storico ritardi.** `render.py --rail-capture` accetta più giornate dello stesso
treno; `rail_history` le raggruppa per numero (stazione × giorno, media solo sui
passaggi rilevati). Una rilevazione salvata come estratto dei soli blocchi h1/h2/p
è marcata `public-browser-dom-extract`. Contesto nazionale: `rail-context.json`
(ART, CC BY 4.0).

# Velocità programmate dei mezzi pubblici

Prototipo locale: 20 reti utilizzabili in 15 città, con tram, autobus, metro e
treni regionali. Bari resta senza servizio nella data scelta. Il menu mostra i
mezzi integrati per ciascuna città, non un censimento completo dei trasporti.
Strade, acqua, parchi e quartieri OpenStreetMap forniscono il contesto geografico.
I rilievi indicano minuti programmati per chilometro, non ritardi osservati,
traffico, inefficienze o sprechi.

Branch `codex/gtfs-grandi-citta`, base `41a953e5`. Nessuna modifica a pagine,
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
  --basemap-cache research/trasporti-gtfs/cache \
  --output research/trasporti-gtfs/output
python3 -m http.server 3274 --bind 127.0.0.1 \
  --directory research/trasporti-gtfs/output
```

Per modificare soltanto l'interfaccia senza rianalizzare gli archivi:

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
`--endpoint` permette di scegliere fra le due istanze dichiarate nel codice;
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

| Città    | Mezzo           | Linee elencate | Linee attive | Corse attive nel feed | Corse con tratti utilizzabili | Tratti distinti |
| -------- | --------------- | -------------: | -----------: | --------------------: | ----------------------------: | --------------: |
| Torino   | tram            |              9 |            8 |                 1.854 |                         1.854 |             591 |
| Milano   | tram            |             17 |           17 |                 4.333 |                         4.333 |           1.024 |
| Roma     | tram            |              5 |            1 |                   750 |                           750 |              59 |
| Firenze  | tram            |              2 |            2 |                   874 |                           874 |             157 |
| Bologna  | bus/filobus     |            240 |          224 |                 8.499 |                         7.030 |           6.354 |
| Cagliari | bus/filobus     |             45 |           45 |                 3.155 |                         3.116 |           2.268 |
| Venezia  | bus             |             94 |           92 |                 4.212 |                         4.030 |           4.884 |
| Palermo  | tram            |              4 |            4 |                   518 |                           468 |              74 |
| Padova   | tram SIR1       |              1 |            1 |                 1.153 |                         1.144 |              73 |
| Catania  | bus             |             53 |           50 |                 2.868 |                         2.868 |           2.713 |
| Milano   | metro           |              5 |            5 |                 2.770 |                         2.770 |             266 |
| Milano   | bus             |            148 |          140 |                18.026 |                        17.651 |           5.177 |
| Roma     | metro           |              4 |            4 |                 1.379 |                         1.379 |             172 |
| Firenze  | treni regionali |             14 |           14 |                   780 |                           392 |             408 |
| Pisa     | treni regionali |             14 |           14 |                   780 |                           178 |             129 |
| Trento   | bus urbano      |             43 |           42 |                 2.474 |                         1.913 |           1.704 |
| Rovereto | bus urbano      |             43 |           42 |                 2.474 |                           500 |           1.373 |
| Ferrara  | bus             |             80 |           74 |                 1.659 |                         1.048 |           2.213 |
| Torino   | metro           |              1 |            1 |                   574 |                           574 |              44 |
| Lucca    | treni regionali |             14 |           14 |                   780 |                           130 |             130 |
| Bari     | bus             |             68 |            0 |                     0 |                             0 |               0 |

Cagliari e Padova usano il **31 ottobre 2026**, gli altri feed il **30 ottobre 2026**.
La data diversa è una scelta esplicita: gli archivi CTM e Padova acquisiti non contengono
servizio per il 30 ottobre. Ogni città mostra la propria data; nessun confronto
fra città come classifica. Venezia copre il feed automobilistico ACTV, soprattutto
Mestre, non i vaporetti né l'intero sistema di trasporto lagunare. Le aree di
studio di Cagliari e Venezia sono dichiarate in `feeds.json`.

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
   fermate in ordine sulla shape, entro 250 m. Calcolare la lunghezza geodetica
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

# Velocità programmate dei mezzi pubblici

Prototipo locale: tram a Torino, Milano, Roma e Firenze; autobus e filobus
nell'area urbana di Bologna. Strade, acqua, parchi e quartieri OpenStreetMap
forniscono il contesto geografico. I rilievi indicano minuti programmati per
chilometro, non ritardi osservati, traffico, inefficienze o sprechi.

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

Aprire `http://127.0.0.1:3274`. L'HTML è autosufficiente, anche senza server:
nessun tile, font remoto, polling, API AI o chiave cartografica. La Content
Security Policy impedisce connessioni e script remoti. I bundle delle
città sono compressi separatamente; il browser prepara solo la città scelta e
mantiene al massimo due città decodificate. Richiede `DecompressionStream`
nei browser correnti; un browser incompatibile riceve un messaggio esplicito.
Il Canvas ridisegna su interazione o ridimensionamento, senza ciclo continuo.

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
per città. Il perimetro cartografico centrale, dichiarato in `feeds.json`, può
essere più piccolo della rete: fuori dall'estratto non sono inventate strade.

## Copertura: servizio del 30 ottobre 2026

| Città   | Mezzo       | Linee elencate | Linee attive | Corse attive nel feed | Corse con tratti utilizzabili | Tratti distinti |
| ------- | ----------- | -------------: | -----------: | --------------------: | ----------------------------: | --------------: |
| Torino  | tram        |              9 |            8 |                 1.854 |                         1.854 |             591 |
| Milano  | tram        |             17 |           17 |                 4.333 |                         4.333 |           1.024 |
| Roma    | tram        |              5 |            1 |                   750 |                           750 |              59 |
| Firenze | tram        |              2 |            2 |                   874 |                           874 |             157 |
| Bologna | bus/filobus |            240 |          224 |                 8.499 |                         7.030 |           6.354 |
| Bari    | bus         |             68 |            0 |                     0 |                             0 |               0 |

Questa è la copertura dei feed acquisiti, non una certificazione dell'intera
rete cittadina. Roma contiene corse utilizzabili solo della linea 8. Bologna
include coppie con entrambe le fermate nel rettangolo `[11.2,44.4,11.48,44.58]`
(ovest, sud, est, nord): le corse/linee del feed oltre quel perimetro non diventano
copertura della mappa urbana. Nel perimetro sono utilizzabili 135 linee e
7.030 corse programmate. I sensi opposti e le varianti geometriche restano
separati; non sommare i tratti come fermate o chilometri.

**Bari non è una sesta città analizzata:** il calendario acquisito omette il
30 ottobre. È visibile come stato non disponibile, senza ripiegare su un altro
giorno. Il GTFS ufficiale di Genova acquisito non contiene `shapes.txt`: non
viene trasformato in percorsi stradali inventati.

Hash, URL finali, date e conteggi sono conservati in `observed-results.json`.
`Last-Modified`, acquisizione, giorno di servizio e aggiornamento OSM rimangono
quattro informazioni distinte. Non sono dati monetari.

## Metodo

1. Applicare `calendar.txt` e le eccezioni di `calendar_dates.txt` per la data
   scelta, nel fuso Europe/Rome. Nessun ripiego su un'altra data.
2. Selezionare i tipi dichiarati per la città: tram 0 e 900–906; per Bologna e
   Bari solo i codici bus/filobus espliciti nel registro. Escludere e contare le
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

Durate nulle/negative, geometrie sotto 25 m e velocità oltre 150 km/h sono
escluse e contate. Gli orari stimati/arrotondati dal titolare non sono osservazioni.
Fermate omonime possono includere manovre o capolinea. Le corse sono campioni
dell'orario, non passeggeri. Non confrontare le città come una classifica.

La quota è lineare in min/km, saturata a 12 min/km; tabella e dettaglio
mantengono il valore completo. La forma curva è un'interpolazione grafica tra
fermate, non una misura della variazione di velocità dentro il tratto. I punti
rappresentano estremi dei segmenti utilizzabili. Il basemap non cambia tempi o
distanze GTFS; la quota non rappresenta altitudine.

## Fonti e riuso

- [Milano, Comune/AMAT](https://dati.comune.milano.it/dataset/ds929-orari-del-trasporto-pubblico-locale-nel-comune-di-milano-in-formato-gtfs): CC-BY, versione non specificata nel campo licenza.
- [Roma Servizi per la Mobilità](https://romamobilita.it/sistemi-e-tecnologie/open-data/): licenza della risorsa da verificare prima della pubblicazione.
- [GTT, condizioni GTFS](https://www.gtt.to.it/gtt_gtfs_license.html): solo uso non commerciale, attribuzione e collegamento GTT obbligatori, conservati nel visualizzatore. Il codice non cambia la licenza dei dati.
- [Firenze, Regione Toscana/GEST](https://dati.toscana.it/dataset/rt-oraritb/resource/1f62d551-65f4-49f8-9a99-e19b02077be3): CC-BY nel catalogo, versione non specificata.
- [Bologna, TPER](https://solweb.tper.it/web/tools/open-data/open-data-detail.aspx?filename=gommagtfsbo&source=): CC-BY 3.0 Italia.
- [Bari, AMTAB](https://www.amtab.it/it/openmobilitydata): condizioni da verificare; calendario del giorno assente.
- [Genova, AMT](https://www.amt.genova.it/amt/societa_trasparente/altri-contenuti/open-data/): nessuna geometria nel feed acquisito, non inclusa nel visualizzatore.
- [OpenStreetMap, ODbL 1.0](https://www.openstreetmap.org/copyright): attribuzione sempre visibile e ricevuta separata. Per redistribuire gli estratti rispettare ODbL e disponibilità della banca dati derivata.
- [Specifica GTFS Schedule](https://gtfs.org/documentation/schedule/reference/).

## Verifica

```bash
python3 -m unittest discover -s research/trasporti-gtfs -p 'test_*.py'
node --check research/trasporti-gtfs/viewer.js
```

Venti test offline con fixture sintetiche: calendario, mezzanotte, unità delle
shape, orari assenti, sequenze duplicate, frequenze, integrità/budget ZIP,
escape JSON, perimetro bus, risposta OSM parziale, geometrie e gzip. I nuovi
contratti sono stati provati in RED prima delle relative implementazioni.
Verifica Browser e artifact ripetibili: `VERIFY.md`.

Gate Next/ETL del prodotto e CI ospitata: **NOT RUN**. La modifica è confinata
alla ricerca locale. Prima di una futura integrazione servono registrazione
nel corpus come derived-only, provenance/ledger, review licenze e gate del
prodotto. Nessuna build Vercel viene avviata per il prototipo.

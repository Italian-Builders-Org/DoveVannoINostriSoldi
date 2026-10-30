# Velocità programmate dei tram

Prototipo locale per Milano, Roma e Torino. Mostra una rete 3D nella quale i
rilievi rappresentano minuti programmati per chilometro. Non misura ritardi,
traffico osservato, inefficienze o sprechi. Non aggiunge pagine, API, dipendenze,
cron o impostazioni Vercel al sito.

Branch: `codex/gtfs-grandi-citta`. Base: `41a953e5`.
Decisione dell'utente: velocità previste, con fonti e limiti espliciti.

## Riprodurre

Python 3.12 o successivo, sola libreria standard:

```bash
python3 research/trasporti-gtfs/acquire.py --cache research/trasporti-gtfs/cache
python3 research/trasporti-gtfs/analyze.py \
  --cache research/trasporti-gtfs/cache --date 2026-10-30 \
  --output research/trasporti-gtfs/output
python3 -m http.server 3274 --bind 127.0.0.1 \
  --directory research/trasporti-gtfs/output
```

Aprire `http://127.0.0.1:3274`. L'HTML generato è autosufficiente: funziona anche
aprendolo direttamente, senza server. Nessun tile, font remoto, API AI o polling.

`acquire.py` riusa gli archivi solo dopo aver verificato hash, dimensione e URL.
`--refresh` sostituisce esplicitamente la versione locale. Per riprodurre questi
numeri occorrono **i byte degli stessi archivi**, non una nuova versione del
feed, anche se scaricata dallo stesso URL. ZIP, ricevute e output locali sono
ignorati da Git. I download sono limitati a 256 MiB compressi e 2 GiB espansi.
Non vengono estratti su disco. Conservare i raw con le ricevute.

## Copertura osservata il 30 ottobre 2026

| Città  | Linee tram elencate | Linee con corse attive | Corse programmate | Tratti distinti utilizzabili |
| ------ | ------------------: | ---------------------: | ----------------: | ---------------------------: |
| Milano |                  17 |                     17 |             4.333 |                        1.024 |
| Roma   |                   5 |                      1 |               750 |                           59 |
| Torino |                   9 |                      8 |             1.854 |                          591 |

La copertura è quella dei feed acquisiti, **non una certificazione dell'intera
rete cittadina**. A Roma l'analisi comprende solo la linea 8: le altre quattro
linee tram elencate non hanno corse associate nel feed acquisito. A Torino
compaiono otto linee con corse attive su nove elencate. Percorsi alternativi e
sensi opposti non vengono fusi. Una coppia di fermate può quindi comparire in
più varianti. Non sommare questi numeri come se fossero fermate o chilometri.

### Ricevute degli archivi

| Città  | Byte compressi | SHA-256                                                            |
| ------ | -------------: | ------------------------------------------------------------------ |
| Milano |     25.482.440 | `c35982cc7a71a5f97fb87c818eaf42df4c41031a1947122dbfba2529b537ddaf` |
| Roma   |     46.440.045 | `88f28a3085ec59c9b2f742198286e549b39314ac8591b3ba0b432cd290d1d267` |
| Torino |     20.892.205 | `b7e74f077ca8501689e137f8fd0ca31780b87a84fc0557e84ba73fa5ca266e48` |

URL finali, timestamp di acquisizione, HTTP Last-Modified e hash sono conservati
nelle ricevute. Last-Modified non viene promosso a data di pubblicazione. La
**data del servizio** resta distinta dall'acquisizione. Non sono dati monetari.

## Metodo

1. Legge `calendar.txt` e applica aggiunte/rimozioni di `calendar_dates.txt` per
   la data scelta, nel fuso Europe/Rome. Non ripiega su una data diversa.
2. Seleziona le corse tram (`route_type=0` e codici tram estesi 900–906).
   Le corse basate su `frequencies.txt` non vengono espanse: sono escluse e contate.
3. Ordina le fermate per `stop_sequence`, bloccando le sequenze duplicate anche
   con rappresentazioni numeriche diverse. Considera soltanto coppie adiacenti.
4. Calcola arrivo successivo meno partenza precedente. Non include le soste,
   non interpola tempi mancanti, non unisce fermate saltando righe senza orario.
   Preserva gli orari oltre 24:00 nel giorno di servizio; limite esplicito 48 ore.
5. Ricava la geometria dalla shape GTFS. `shape_dist_traveled`, quando presente
   e utilizzabile, è una coordinata lungo la shape, **non un'assunzione di metri**.
   Altrimenti proietta le fermate in ordine sul tracciato; distanza massima
   ammessa 250 m. Le lunghezze sono calcolate con distanze geodetiche tra punti.
   Le shape mancanti non diventano segmenti rettilinei inventati.
6. Raggruppa linea, direzione, coppia di fermate e geometria. Prende la mediana
   dei tempi di percorrenza, poi divide la distanza per quel tempo. Non è la
   mediana delle velocità, una media per passeggero o una misura osservata.
7. Pubblica le fasce 07–10, 10–16, 16–20 e l'intero giorno di servizio. Il
   campione entra nella fascia in base alla partenza dalla prima fermata.

Durate nulle/negative, distanze sotto 25 m e velocità oltre 150 km/h non producono
valori pubblicabili; i conteggi rimangono visibili. Le esclusioni hanno unità
esplicite: corse, coppie di fermate o coppie nei percorsi unici. Tempi stimati o
arrotondati dal titolare non diventano tempi reali. Fermate omonime possono
includere capolinea o manovre: non sono automaticamente congestione stradale.

La quota grafica è lineare in min/km, saturata a 12 min/km per evitare rilievi
fuori scala. La tabella e il dettaglio conservano il valore completo. La mappa
mostra la rete GTFS, non un basemap stradale e non altimetria. L'orientamento si
può ruotare; la vista 2D mantiene i colori. Non confrontare le città come una
classifica di efficienza: copertura, reti e orari differiscono.

## Fonti e riuso

- [Milano, Comune/AMAT](https://dati.comune.milano.it/dataset/ds929-orari-del-trasporto-pubblico-locale-nel-comune-di-milano-in-formato-gtfs):
  feed programmato ATM; catalogo CC-BY, versione non specificata nel campo licenza.
- [Roma Servizi per la Mobilità](https://romamobilita.it/sistemi-e-tecnologie/open-data/):
  statico distinto dai feed in tempo reale; condizioni della risorsa da verificare
  prima di redistribuire/pubblicare. Non si deduce una licenza dalla disponibilità
  pubblica dell'URL. Il titolare avverte sui limiti dei dati AVM in tempo reale,
  che questa analisi non usa.
- [GTT, condizioni GTFS](https://www.gtt.to.it/gtt_gtfs_license.html): uso
  non commerciale, attribuzione e collegamento a GTT obbligatori. Non è una
  licenza permissiva per qualunque uso futuro. L'attribuzione richiesta è
  conservata nel visualizzatore; i dati non acquisiscono la licenza del codice.
- [Specifica ufficiale GTFS Schedule](https://gtfs.org/documentation/schedule/reference/).

### Estensioni già individuate, non ancora importate

| Città   | Fonte ufficiale                                                                                                    | Stato e lavoro necessario                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Firenze | [Regione Toscana, GEST](https://dati.toscana.it/dataset/rt-oraritb/resource/1f62d551-65f4-49f8-9a99-e19b02077be3)  | Risorsa GTFS tram individuata; acquisire versione corrente e verificare calendario/licenza specifica          |
| Bologna | [TPER, gommagtfsbo](https://solweb.tper.it/web/tools/open-data/open-data-detail.aspx?filename=gommagtfsbo&source=) | GTFS bus, CC-BY 3.0 Italia dichiarata; richiede perimetro bus separato, non una finta rete tram               |
| Genova  | [AMT, Open Data](https://www.amt.genova.it/amt/societa_trasparente/altri-contenuti/open-data/)                     | GTFS ufficiale individuato; verificare feed, copertura settimanale e condizioni prima dell'import             |
| Napoli  | [ANM](https://www.anm.it/) / [catalogo comunale](https://dati.comune.napoli.it/dataset)                            | Non verificato in questa iterazione un URL ufficiale GTFS scaricabile; nessun dato sostitutivo da aggregatori |

## Verifica

```bash
python3 -m unittest discover -s research/trasporti-gtfs -p 'test_*.py'
python3 research/trasporti-gtfs/acquire.py --cache research/trasporti-gtfs/cache
```

Undici test offline con ZIP sintetici, definiti prima dell'implementazione:
calendario/eccezioni, mezzanotte, unità di shape, dati assenti, durate nulle,
sequenze duplicate, frequenze, shape mancanti, hash, budget/duplicati ZIP,
escape JSON nel documento HTML. Due ulteriori casi limite hanno prodotto RED
prima della correzione: sequenze `1`/`01` e frequenze escluse scambiate per
assenza di servizio.

Verifica Browser reale: tre città × quattro fasce desktop; tre città a
320/390/768 px; selezione linea, tabella e dettaglio, 2D/3D, rotazione/zoom/reset,
controlli da tastiera e console. Screenshot e ricevute E2E nella cartella di
artifact della task; per ripetere, seguire `VERIFY.md`.

Gate Next/ETL del prodotto e CI ospitata: **NOT RUN**. La modifica è confinata
alla ricerca locale; nessun file applicativo, snapshot del prodotto, catalogo,
workflow o dipendenza viene modificato. Questi gate sono necessari prima di
un'eventuale integrazione/PR del prodotto, insieme alla verifica delle licenze.

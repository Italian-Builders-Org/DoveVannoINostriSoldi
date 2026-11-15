# Verifica ripetibile

## Dati e contratti offline

1. Acquisire/verificare GTFS e OSM con i comandi del README. Le ricevute in
   `observed-results.json` identificano i byte usati; un download successivo
   dallo stesso URL non riproduce necessariamente questi numeri.
2. Generare schema 3 con `--date 2026-10-30 --city-date cagliari=2026-10-31 --city-date padova=2026-10-31 --city-date venezia-nav=2026-11-02 --city-date cagliari-tram=2026-10-31`.
   Non scegliere automaticamente un giorno diverso quando il calendario manca.
3. Eseguire 35 test Python e 27 Node con i comandi del README. Le fixture sono
   sintetiche e non entrano nel visualizzatore. I nuovi casi di errore sono
   stati definiti e verificati in RED prima delle implementazioni.
4. Confrontare i segmenti delle città preesistenti con l’artifact dell’iterazione precedente: geometrie,
   identità e statistiche per fascia devono rimanere identiche. Controllare che
   la ricerca usi coordinate/identità di `stops.txt`, anche per nomi duplicati.
5. Verificare hash, byte, URL, perimetro, provider, acquisizione e data base OSM
   di ogni ricevuta. Nessuna risposta parziale deve diventare un basemap vuoto.
6. Verificare ogni `cities/*.json.gz`: hash e dimensione del manifest, contenuto
   decompresso identico alla città nell'analisi. Controllare anche il bundle
   JS generato con `node --check`. In modalità `--standalone`, CSP deve vietare
   connessioni e i dati devono essere incorporati nell'HTML.

## Browser

Servire l'output in loopback. Usare azioni reali senza modificare DOM o stato
interno per simulare risultati. I dataset del Canvas descrivono l'ultimo disegno,
non prestazioni certificate del dispositivo né costi hosted.

- 32 reti × quattro fasce: 31 reti utilizzabili; Bari deve mostrare
  indisponibilità e zero righe, conservando la data scelta. Confrontare conteggi
  e prima velocità con `analysis.json`. Fonti e data devono seguire la città.
- Dieci città × quattro classi di velocità: conteggi equivalenti al JSON,
  confini 10/15/25 coerenti, stato vuoto e CSV disabilitato quando non ci sono
  tratti. Il cambio linea/velocità deve azzerare la pagina della tabella.
- Tabella/dettaglio: selezionare con tastiera, verificare velocità, durata e
  campioni; cambiare fascia e conservare il tratto quando esiste. Provare
  paginazione, chiusura dettaglio e rimozione delle selezioni incompatibili.
- Cercare nome, accenti, codice e testo senza risultati. Frecce/Invio/Escape;
  omonimi distinti, selezione fermata e relativo filtro linea. Scaricare un CSV
  reale e confrontare tutte le righe con il JSON, inclusi hash e data.
- Camera: slider e zoom devono concordare ai limiti; angolo normalizzato,
  bussola verso nord, fit con inclinazione/rilievo estremi e nessun NaN.
  Verificare 2D/3D, tastiera, pan, reset e resize. La vista espansa deve limitare
  il focus alla mappa, disattivare il resto della pagina e chiudersi con Escape.
- Cambi città rapidi: prevale l'ultima scelta; nessun dato o fonte precedente.
  Fixture con asset assente e corrotto: mostrare errore e svuotare fonte,
  tabella/dettaglio. Ripristinare il file e verificare recupero da una nuova
  selezione senza ricaricare la pagina o svuotare manualmente la cache.
- Reti campione a 320, 390, 573 e 1280 px: misurare la larghezza effettiva del documento,
  non soltanto l'override richiesto al Browser. Nessun overflow globale o
  sovrapposizione fra controlli visibili. Escludere dalla misura i discendenti
  di `<details>` chiusi. Provare il dettaglio aperto a 320/390 px e lasciare
  liberi zoom/bussola. Verificare il toggle di esplorazione mobile.
- Preservare attribuzioni GTT/OSM e limiti di copertura. Roma solo linea 8;
  Venezia automobilistico, non vaporetti; Cagliari/Padova 31/10, altri 30/10.
- Console normale senza warning/error. La consegna a directory richiede solo
  asset locali, con cache dati massima di due città; nessun servizio remoto.
  L'errore HTTP della fixture mancante è atteso e separato dalla console normale.

## Artifact e confini della prova

Consegna v3 nella cartella visualizzazioni della chat `gtfs-20261031-v3`:
output statico, HTML offline, analisi, screenshot, matrici JSON, CSV realmente
scaricato e ricevute di integrità/recupero. `data-contract-check.json` registra
il confronto con v2; `responsive-checks.json` registra le viewport effettive.
I tentativi iniziali con override non applicato sono conservati come
`viewport-unapplied.json` e non contano come prove responsive riuscite.

Il Browser in-app non supporta l'iniezione touch. Pinch, twist e scorrimento su
telefono fisico restano **NOT RUN**. La trasformazione matematica e il toggle
sono verificati separatamente; non sostituiscono una prova sul dispositivo.

Integrazione nel sito, corpus, gate Next/ETL, CI, deployment e risparmio in
fattura: **NOT RUN**. Prima della pubblicazione servono ledger, review licenze,
gate del prodotto e prova fisica mobile. Nessuna build Vercel per questa ricerca.

## Prove della quarta iterazione

- Dataset precedenti identici a v3; due nuovi feed con calendario, hash e mappe
  verificati. 40 casi città/fascia, 36 classi velocità, 36 viste responsive.
- 120 azioni ai limiti di zoom/rotazione, fit con rilievo/inclinazione massimi;
  trascinamento e rotella tramite eventi mouse del Browser. 45 cambi rapidi
  conservano l'ultima città, la fonte e le righe corrette.
- Ripristino di linea, fascia, modalità 2D e tratto; ripristino di fermata,
  inclinazione e camera. Clipboard letta con `clipboard.read()` e confrontata
  con il link generato; `readText()` inizialmente restituiva una stringa vuota.
  Fixture senza API clipboard: campo selezionato e chiusura Escape verificati.
- Query non valide ricadono in una vista finita e coerente. Fixture con asset
  assente/corrotto disabilitano anche la condivisione; ripristinato il file,
  una nuova selezione recupera senza reload. Usare percorsi univoci per le
  fixture: un vecchio asset valido in cache non prova il caso di corruzione.
- Artifact `gtfs-20261031-v4`: screenshot, matrici, link prima/dopo, ricevuta
  clipboard, casi di errore e verifica dati. I limiti fisici/hosted sopra
  rimangono distinti e non diventano PASS per queste prove locali.

## Prove della quinta iterazione

- Dati e cartografia delle dieci voci precedenti identici a v4. Catania aggiunge
  2.713 tratti derivati da 50 linee attive; data 30/10/2026 e perimetro dichiarato.
- 44 casi città/fascia; pannelli con ricevute, hash e copertura per tutte le
  undici città; 40 viste responsive. Centro è stato riprodotto 3,5 px a sinistra
  e poi misurato centrato. Ricerca e selettori passano da 2 px di scarto a zero.
- Animazioni: usare eventi mouse reali del Browser (CDP) oltre ai locator. I
  click sintetici del locator possono avere `detail=0`, come la tastiera, e
  attivare intenzionalmente il percorso immediato. Salvare attributi, altezze e
  screenshot durante e dopo il completamento, non solo il comando di click.
- Verificati puntatore con/senza movimento ridotto, Enter/Spazio, 17 inversioni
  durante animazioni attive, cambio città/resize e cambio della preferenza a
  metà animazione. Alla fine nessuno stile height/overflow resta applicato.
- 20 ricostruzioni del dettaglio: una sola icona per summary, focus e stato
  coerenti. Paginazione e fallback senza `Element.animate` verificati.
- Asset mancanti/corrotti: copertura/ricevute vuote nascoste, metodo ancora
  disponibile; dopo il recupero i pannelli dati tornano. I casi 404 delle
  fixture sono separati dalla console normale.
- Artifact `gtfs-20261031-v5`: dati, output statici/offline, confronto con v4,
  matrici Browser, prove movimento/accessibilità e screenshot dei due dettagli.
  I 45 test offline esistenti sono rieseguiti; il nuovo comportamento UI è
  verificato nel Browser, senza test unitari che riscrivano la manipolazione DOM.

Telefono fisico e gate del prodotto restano **NOT RUN**. Nessun push, PR,
merge, deploy o build Vercel per questa iterazione locale.

## Prove della sesta iterazione

- Contratti scritti prima dell’implementazione per raggruppamento città/mezzo,
  alias degli archivi, URL discordanti e collisioni ID. 50 test offline.
- Confronto completo: gli 11 dataset precedenti, cartografia compresa, restano
  identici. 16 asset verificati per hash/byte; 15 reti utilizzabili in 11 città.
- Browser: 60 combinazioni rete/fascia e Bari indisponibile; conteggi, righe e
  velocità minima confrontati con analysis.json. 16 pannelli fonti/ricevute.
- 24 menu su viewport reali 320/390/573/768/1440 px e 573×360: niente overflow,
  popup nello schermo e scelta corrente visibile. Ricerca vuota, Escape, ricerca
  da tastiera, Enter e Tab verificati; uscita senza selezioni involontarie.
- Percorso bus linea 90 → metro Milano → metro Roma → tram Torino: reset della
  linea e preferenza del mezzo coerenti. Ripristino esatto di un link ferroviario
  con linea, fascia, tratto, camera e 2D. Clipboard letta dopo la copia.
- 20 filtri sulle nuove reti; zoom, nord e fit. 11 inversioni di disclosure con
  veri eventi mouse durante animazioni attive: nessuna altezza/overflow residua.
  Icone singole a sinistra senza sfondo e percorso reduced motion verificati.
- Asset danneggiato: errore di dimensione esplicito, fonte vuota nascosta, menu
  ancora utilizzabili. Cambio su rete valida e ripristino del file senza reload.
- L’estratto Pisa ha fallito due POST (502 e timeout). Un GET esplicito ammesso
  ha prodotto una ricevuta verificata: nessun retry automatico nel prodotto.
- Artifact: gtfs-20261031-v6 nella cartella visualizzazioni della chat, con matrici
  JSON, screenshot, statico/offline, verificatore ripetibile e analisi.

Telefono fisico, VoiceOver sul dispositivo, integrazione corpus e gate
Next/ETL/CI/deploy restano NOT RUN. Nessun push, PR, merge o build Vercel.

## Prove della settima iterazione

- Base d061ccfb, solo ricerca locale; main remoto verificato a 41a953e5.
  I 16 dataset precedenti, comprese le mappe, sono identici. Nuove ricevute per
  Trento/Rovereto/Ferrara; Torino metro riusa archivio e OSM di GTT.
- 51 test offline. Il nuovo test RED riguarda il fit del rilievo entro una
  viewport parzialmente occupata: la vecchia funzione ignorava gli inset.
- Browser: 76 reti/fasce più Bari indisponibile; conteggi, prima velocità e righe
  confrontati con analysis.json. Fonti e ricevute verificate per tutti i 20 file.
- 35 viste reali a 320/390/573/768/1440 px su sette reti. Il verificatore proietta
  geometrie e punti A/B con la camera osservata e controlla la mancata
  sovrapposizione a pannello/comandi. Nessun overflow orizzontale. 16 menu aperti
  restano nello schermo; ricerca senza risultati e selezione da tastiera provate.
- Tre casi aggiuntivi con inclinazione 65°, rilievi 160% e rotazione a 180°:
  proiezioni e ingombri verificati a 390/768/1440 px.
- Rete locale rallentata: prima restavano 20 pulsanti attivi della città vecchia;
  dopo, righe/canvas/fonti sono inert e busy. Sequenza Bologna → Trento → Bologna
  → Ferrara: tre cancellazioni osservate dal Browser; solo l’ultima città pronta.
  La limitazione di rete e il bypass della cache sono stati poi rimossi.
- PNG reali scaricati dal Browser: 3D desktop e 2D ruotato mobile dalla versione
  offline, entrambi ispezionati. Scala/nord/fonti inclusi, dimensioni e SHA salvati.
  CSV Ferrara verificato contro i 1.566 segmenti mattutini e la ricevuta originale.
- Fixture dichiarate: hash errato a byte invariati, recupero dopo ripristino senza
  reload; toBlob che restituisce null, errore visibile e pulsante nuovamente attivo.
- HTML offline con CSP connect-src none, cambi città e metro verificati. Console
  normale senza warning/errori. Nuovi treni R35 esclusi: 48 corse senza shape utile.
- Artifact gtfs-20261101-v7: screenshot, PNG/CSV scaricati, matrici, eventi di
  cancellazione, dati, statico/offline e verificatore ripetibile. Il verificatore
  verifica le osservazioni salvate, non sostituisce una nuova esecuzione Browser.

Telefono fisico e VoiceOver, integrazione corpus e gate Next/ETL/CI/deploy del
prodotto: NOT RUN. Nessun push, PR, merge o build Vercel.

## Iterazione 8, 1 novembre 2026

Stato: PASS locale. 53 test offline, sintassi viewer, formato e diff puliti.

Artifact `gtfs-20261101-v8`: `browser-source-bands.json` (84 casi), `browser-sorting.json` (36 casi, 320/573/1280 px), `browser-contract-check.json`, `interaction.json`, `edge-cases.json`, `keyboard-focus.json`, `csv-check.json`, `lucca-map-check.json`, screenshot e file scaricati.

`node verify-browser.mjs` dalla directory artifact rilegge le osservazioni salvate e confronta righe/ordine/conteggi con analysis.json. Controlla l’identità delle precedenti 20 fonti con l’artifact v7. Non rilancia il Browser.

Per ripetere la UI: servire index.html e cities/ in loopback; visitare Lucca, mattino. Cliccare km/h per decrescente, Corse per frequenza decrescente, poi ancora Corse per crescente. Dalla seconda pagina cambiare ordine: torna a 1–20; selezionare un tratto e cambiare ordine da tastiera: dettaglio e focus sull’intestazione restano. Copia link e riapertura ripristinano trips-desc e selezione. CSV mattino di Lucca: 62 righe, campione e hash invariati, corse in ordine scelto. Filtro <10: nessuna riga, due intestazioni disabilitate; Ripristina torna ai dati. Ripetere a 320, 573, 1280 px.

Lucca: ricevute GTFS e OSM in observed-results.json, 16.026 feature/19 etichette OSM, perimetro OSM uguale a studyBounds. La prima acquisizione ristretta è conservata in cache, non usata nell’output finale. Livorno non esposto: principale GET 502, alternativo GET timeout di 100 secondi senza byte.

Limiti: i dati sono orari programmati e lo snapshot Toscana è datato gennaio; niente ritardi osservati. Clipboard del Browser non dimostrata, telefono fisico e lettore schermo reale non eseguiti. Gate del prodotto e pubblicazione non eseguiti.

## Iterazione 9, 1 novembre 2026

Stato: PASS locale. Test offline 54, sintassi JS e diff puliti. Artifact `gtfs-20261101-v9`: `analysis.json.gz`, `geometry-audit.json`, `oracle.json`, `browser-source-bands.json` (92), `browser-context-filter.json` (12), `browser-stateful-filter.json`, `browser-selection-contrast.json`, `browser-rapid-changes.json`, `verification-result.json`, CSV/PNG e screenshot.

`python3 verify.py` nella directory artifact ricontrolla le osservazioni salvate contro l’analisi congelata; non rilancia il Browser. Verifica 41.253 tratti, distanza degli estremi dalle fermate entro 100 m più 20 cm per l’arrotondamento a sei decimali, velocità/durate/campioni, righe/conteggi/ordine, focus, filtri, CSV, contrasto e hash fonte. Il caso GTT e9231a3374a9e12c deve essere assente.

Ripetizione Browser: Torino o Roma Bus, mattino, scegliere un tratto e attivare il badge filtro da tastiera. Attesi linea scelta, dettaglio chiuso, focus sul canvas e rete inquadrata. Selezionare un altro tratto sulla stessa linea e attivare il badge già premuto: tutte le linee tornano. Ripetere 320/390/573/1280 px e Firenze Treni per il nome lungo. Con Torino tram, giorno, velocità <10 e corse decrescenti: filtro rapido sulla linea 4 mantiene lo stato, CSV di 11 righe nello stesso ordine.

Contrasto: Lucca mattino, primo tratto Pescia–Montecarlo, poi Centro e Inquadra. Attesi rispettivamente selezione visibile/contesto 0,2, fuori vista/contesto 1, visibile/0,2. Osservazioni diagnostiche nei data attribute del canvas.

L’audit distingue risultati cambiati da byte originali invariati. Counters di fermate distanti sono occorrenze nei percorsi unici del feed, non numero di fermate urbane distinte.

Limiti: Prato/Livorno esclusi dopo errori 502/timeout e 406 nel Browser; nessun bypass. Snapshot Toscana gennaio 2026, solo servizio programmato. HTML singolo nuovo non generato per ENOSPC; anteprima a directory completa. Touch fisico, screen reader e gate del prodotto non eseguiti. Pending/cancellazione sotto rete rallentata non riprovati: nei sette cambi rapidi le richieste campionate erano già concluse.


## Iterazione 10, 1 novembre 2026

Stato: PASS locale. Artifact `gtfs-20261101-v10`: `analysis.json.gz`, 25 asset,
`atlas-offline.html`, `browser-source-bands.json` (100),
`browser-clear-route.json` (12), `browser-zoom.json` (12 casi/36 stati),
`browser-pending-controls.json`, `browser-offline.json`, screenshot e ricevute.

`python3 verify.py` nella directory artifact ricontrolla le osservazioni salvate:
righe/ordine/conteggi contro i dati, 41.418 geometrie, tutte le ricevute/asset,
precedenti 23 voci identiche a v9 e payload dell’HTML offline identici all’analisi.
Non rilancia il Browser. Test locali: 34 Python e 26 Node.

Ripetizione UI: a 320/390/573/1280 px scegliere Torino tram, Prato e Livorno.
Applicare filtro velocità e ordine per corse; scegliere una linea, poi premere
la X. Attesi solo linea rimossa, focus al selettore, ordine/fascia/velocità
preservati, nessuna sovrapposizione o variazione dell’altezza del campo. Cliccare
l’etichetta Linea apre il menu. Da Vista portare lo slider zoom a Home/End e
ridurre di un passo: pulsanti −/+ disabilitati solo all’estremo corrispondente,
valore camera finito. Il caso 1280 px include un massimo frazionario.

Durante un cambio Cagliari rallentato e un resize: righe/canvas inert,
zoom/inclinazione/rilievo/rimozione linea disabilitati; al termine tornano
utilizzabili. Condizioni di rete e cache del Browser ripristinate dopo la prova.
La prova ha avuto una latenza anomala del Browser e non è una misura di performance.

Prato e Livorno: cartografia con POST Private.coffee, SHA/byte verificati dal
renderer. OSM base maggio/giugno; GTFS Toscana gennaio, servizio 30 ottobre.
Perimetri e limiti visibili nelle fonti. Bari resta indisponibile per la data.
Le altre fonti, numeri e mappe restano identici a v9.

Output directory e HTML unico verificati nel Browser. `render.py` accetta JSON
plain o gzip, non il manifest riassuntivo separato. Sei test di fallimento scritti
prima delle modifiche coprono input corrotti/troppo grandi, equivalenza gzip,
file invariati e sostituzione fallita o collegata a una versione precedente.

Telefono fisico, screen reader e gate Next/ETL/CI/deploy: NOT RUN. Nessun push,
PR, merge, servizio remoto aggiunto all’esplorazione o build Vercel.


## Iterazione 11, 1 novembre 2026

PASS locale: 61 test (34 Python, 27 Node). Il nuovo caso di raggruppamento
navigazione è fallito prima dell’implementazione: `Mezzo non riconosciuto: ferry`.
Il Browser ha riprodotto una scheda di 260 px posizionata usando un limite fisso
di 235 px, con 25 px fuori bordo, e una scheda rimasta visibile dopo la rotella.
Le osservazioni prima/dopo sono conservate.

Artifact `gtfs-20261101-v11`: `browser-source-bands.json` (108 casi),
`browser-responsive.json` (12), `browser-hover-responsive.json` (4),
`browser-keyboard.json`, `browser-initial-view.json`, `browser-offline.json`,
CSV/PNG, screenshot e analisi completa gzip. `python3 verify.py` ricontrolla le
osservazioni salvate contro i dati, le 42.986 geometrie, i 27 asset del manifest
e i payload offline; non rilancia il Browser. I nomi campionati dalla tabella
sono confrontati con lo stesso trim esterno usato nella cattura DOM, senza
modificare i dati originali. Le precedenti 25 voci sono identiche a v10.

Ripetizione: in Prato filtrare Firenze–Pistoia–Lucca–Viareggio, premere Inquadra,
passare sulla curva vicino al bordo destro. Attesi scheda entro i bordi, linea,
velocità e fermate corrette. Rotella: scheda chiusa; Escape: chiusa e mappa
utilizzabile. Ripetere a 320, 390, 573 e 1280 px, scegliendo punti non coperti
dai comandi sovrapposti. Mobile qui significa viewport con puntatore mouse,
non verifica fisica touch. La modalità Esplora con le dita è attivata/disattivata,
ma pinch/rotazione su dispositivo rimangono NOT RUN.

Menu: nuove reti e Prato, quattro larghezze, popup interamente nella viewport,
nomi lunghi, Escape dal controllo effettivamente a fuoco, rimozione linea da
44 px, focus restituito e zero overflow. Ricerca città senza risultati, poi
Sassari e Enter: recupero e selezione corretta. Nessuna animazione nuova.

Dati: Sassari 1.134 tratti/43 linee/891 corse con tratti, servizio 30 ottobre.
ACTV navigazione 434/22/1.308, servizio esplicito 2 novembre, prima data di
validità del file; autobus Venezia restano separati. Ricevute GTFS e OSM con
byte/hash, esclusioni e perimetri in observed-results.json. La curva tra due
fermate può uscire dal rettangolo: il filtro del perimetro riguarda entrambe le
fermate, non una riscrittura del percorso. Il controllo dei 100 m si applica
agli estremi della geometria e alle rispettive fermate.

CSV navigazione: 434 righe, identità e ordine, velocità/campioni, data e hash
riconciliati. PNG reale scaricato e ispezionato, con Navigazione, scala/nord,
legenda, data e attribuzioni. Offline con CSP connect-src none: navigazione,
cambio Sassari e modalità di esplorazione verificati. Attese anomale del
Browser non utilizzate come benchmark di velocità.

NOT RUN: telefono fisico, screen reader reale, gate Next/ETL/CI del prodotto,
integrazione nel corpus e pubblicazione. Nessun costo di build Vercel introdotto.


## Iterazione 12, 1 novembre 2026

Esito: PASS locale. 29 voci, 28 reti utilizzabili in 19 città; Bari rimane
indisponibile. 43.867 geometrie controllate. Le precedenti 27 reti conservano
misure, fermate, geometrie, ricevute, basemap, esclusioni e copertura; Sassari
riceve soltanto la correzione documentata della licenza.

Artifact `gtfs-20261101-v12` nella cartella delle visualizzazioni del task:

- `verify.py` rilegge il dataset congelato e le osservazioni salvate. Eseguirlo
  con `python3 PERCORSO_ARTIFACT/verify.py`; non rilancia Browser e non misura
  prestazioni del dispositivo. Richiede anche l'analisi v11 per il confronto.
- `browser-source-bands.json`: 116 combinazioni, tutte le righe visibili
  confrontate con l'oracolo estratto dall'analisi, date ISO e conteggi coerenti.
- `browser-responsive.json`: 16 casi, quattro reti e quattro larghezze. Menu
  nei limiti del viewport, nessun overflow, altezza della barra e posizione
  globale della mappa stabili al cambio filtro. Dettaglio selezionabile, focus
  sulla mappa, badge e chiusura separati, target mobile almeno 44 px.
- `browser-integrity-error.json`, `fixture.json`, `browser-recovery.json`:
  modifica controllata del solo asset nel candidato locale, senza cambiare la
  lunghezza. L'integrità SHA fallisce, la UI mostra errore e rimuove i dati
  precedenti. File ripristinato, hash originale verificato, selezione recuperata
  e cache di rete tornata normale. Artifact immutabile non alterato.
- CSV Cagliari tram: 28 righe confrontate con l'analisi; data di servizio e hash
  preservati. PNG 1230×871 ispezionato. `atlas-offline.html` provato con Olbia,
  cambio a Cagliari tram e 2D; CSP `connect-src 'none'`.
- Preview stabile 3274 aggiornata solo dopo PASS del candidato, con copia del
  precedente indice; `stable-preview.json`, `browser-stable-preview.json` e
  screenshot finali attestano la promozione. Console senza warning/errori.

61 test offline pertinenti (34 Python, 27 Node), sintassi JS, formattazione e
`git diff --check`. Una precedente chiamata Browser con 16 scenari in un batch
ha raggiunto il timeout del tool: ripetuta in quattro batch completati. Non è
usata come misura di velocità dell'applicazione.

NOT RUN: gesti su dispositivo fisico, screen reader reale, gate Next/ETL/CI del
prodotto, build Vercel e deployment. Nessuna dipendenza, richiesta periodica o
servizio a pagamento aggiunto. Nessuna regressione rilevata nel perimetro dei
controlli eseguiti; non è una certificazione di ogni dispositivo.


## Iterazione 13, 2 novembre 2026

PASS locale, base 23c240f6. Tutte le 29 fonti precedenti sono identiche,
compresi metadati, misure e basemap. Aggiunti Nuoro bus/treni e Sassari treni:
31 reti utilizzabili in 20 città, 44.792 geometrie. Nuoro ha un basemap con
ricevuta propria; Sassari treni riusa soltanto il basemap con identico perimetro.

Comandi pertinenti: quelli offline nel README (35 Python e 27 Node), sintassi
JS, Prettier e `git diff --check`. Il nuovo test della ricevuta cartografica è
stato eseguito prima dell'implementazione: il mirror ammesso falliva; host non
ammesso, byte/hash e perimetro alterati devono continuare a fallire. Test di
fixture senza rete; non è una misura della disponibilità dei provider.

Artifact `gtfs-20261102-v13`:

- `verify.py` richiama `verify-data.py` e verifica dati e osservazioni salvate;
  eseguire `python3 PERCORSO_ARTIFACT/verify.py`. Non rilancia Browser né rete;
  richiede anche l'analisi v12 per il confronto. Manifest, gzip, standalone,
  endpoint delle geometrie e dati precedenti sono controllati.
- 128 combinazioni rete/fascia: conteggi e prime 20 righe, ordini, velocità,
  campioni, date e colori confrontati con l'analisi congelata. Tutte a 320 px,
  nessun overflow del documento. Bari resta uno stato senza servizio.
- 16 casi responsive: Milano bus e le tre nuove reti a 320/390/573/1280 px.
  Menu nei limiti del viewport, barra e posizione della mappa stabili al filtro,
  dettaglio visibile, focus e target mobili verificati; nessuna sovrapposizione.
- Ricerca: parole invertite, accenti, spazi e zero risultati; Enter seleziona
  Roma bus e riporta il focus sul trigger. Riprova offline con «Nuoro treni».
- Camera: quattro scenari su bus e treni, 30 aumenti e 40 riduzioni da tastiera
  fino ai limiti, anche massimi frazionari; nord, pan, 2D/3D e fit. Due scenari
  di mappa espansa con 18 Tab ciascuno: focus interno e ripristino di inert
  all'uscita. Filtro senza risultati, export disabilitato e recupero verificati.
- Cambi rapidi Milano/Roma/Nuoro: restano soltanto titolo e dati dell'ultima
  scelta. CSV 919 righe confrontato integralmente; PNG ispezionato. HTML offline
  con i treni Nuoro/Sassari e CSP senza connessioni. Console normale pulita.

Le misure renderMs del Canvas sono diagnostica locale, non un benchmark o una
prova di risparmio hosted. NOT RUN: telefono fisico/touch/pinch, screen reader
reale, gate Next/ETL/CI del prodotto e deployment. Nessuna modifica al prodotto
Next.js, nessuna build Vercel; le modifiche restano nel prototipo isolato.

Main remoto ricontrollato e fetch eseguito prima della consegna: c3fa7372.
L'unico commit successivo alla verifica precedente cambia immersive-chrome.tsx
e bdap-history.ts, fuori da research/trasporti-gtfs. Nessun rebase, merge,
overwrite o modifica del checkout principale.

## Iterazione 14, 2 novembre 2026

Base locale fb3e8c0c, main remoto ricontrollato c3fa7372. Tutto il diff resta
in research/trasporti-gtfs; nessuna integrazione Next o modifica Vercel.

- PASS: 48 Python e 28 Node. Casi di errore definiti prima del codice per
  numero treno, fusione geometrie, profilo cartografico, fonte/data, previsioni,
  mancanti, mezzanotte e scala della tratta. Le fixture restano sintetiche.
- PASS Browser: 34 fonti × 4 fasce = 136 viste a 573 px; valori, campioni,
  prime 20 righe e data confrontati con l'oracolo congelato. Overflow zero.
- PASS Browser: due corse a 320/390/573/1280 px; 14/14 e 8/13 rilevazioni,
  grafico, controlli almeno 44 px, etichette contenute, zero overflow.
- PASS: menu da tastiera e focus ripristinato; tre deep link non disponibili
  producono errore esplicito e disabilitano export, senza cambiare corsa/data.
- PASS: CSV della 8519, 13 righe, ultimi cinque eventi mancanti e valori
  negativi conservati; hash della fonte coerente.
- PASS: camera della tratta, URL esplicito, resize e ritorno alla città;
  default urbano invariato. Senza OSM: nomi delle stazioni dal GTFS e avviso,
  attribuzione OSM nascosta. Nessun tracciato inventato.
- PASS: HTML autonomi testati via server locale, CSP connect-src none;
  rail senza link a un file mappa esterno; accordion da tastiera istantaneo.
- PASS: i 32 oggetti precedenti del modello sono identici; ricevute, byte e
  hash degli asset congelati verificati. 44.798 tratti, 32 reti utilizzabili,
  20 città utilizzabili e una tratta. Trento ferrovia registrata senza geometria.
- NOT RUN: telefono fisico, vero screen reader, clipboard virtuale Browser
  (lettura/incolla non disponibile), gate Next/ETL/CI, pubblicazione.

Artefatti: directory locale gtfs-20261102-v14 nell'area visualizations della
sessione. `python3 verify.py` ripete i confronti dati/Browser senza rete e
richiede il precedente modello v13 nella directory adiacente. Le capsule
pubbliche e rail-journeys.json riproducono la vista ferroviaria. I digest delle
capsule riguardano il DOM serializzato, non la risposta HTTP originaria.

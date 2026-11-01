# Verifica ripetibile

## Dati e contratti offline

1. Acquisire/verificare GTFS e OSM con i comandi del README. Le ricevute in
   `observed-results.json` identificano i byte usati; un download successivo
   dallo stesso URL non riproduce necessariamente questi numeri.
2. Generare schema 3 con `--date 2026-10-30 --city-date cagliari=2026-10-31 --city-date padova=2026-10-31`.
   Non scegliere automaticamente un giorno diverso quando il calendario manca.
3. Eseguire 25 test Python e 20 Node con i comandi del README. Le fixture sono
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

- Undici città × quattro fasce: dieci città utilizzabili; Bari deve mostrare
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
- Dieci città a 320, 390, 573 e 1280 px: misurare la larghezza effettiva del documento,
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

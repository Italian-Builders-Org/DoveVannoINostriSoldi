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

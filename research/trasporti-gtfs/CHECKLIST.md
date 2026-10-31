# Trasporti GTFS: velocità programmate

Base: 41a953e548fd607fb35253a9962333cc2a724067 (origin/main, 30 ottobre 2026).
Obiettivo autorizzato: branch isolato e prima analisi/visualizzazione 3D delle velocità previste nelle grandi città, con dati ufficiali e limiti espliciti. Non misura ritardi osservati, sprechi o responsabilità.

- [x] Checkout principale preservato; riuso del worktree della chat dopo verifica clean.
- [x] Scelta utente: velocità previste, non ritardi reali.
- [x] Verificare fonti, licenze, formato e calendario; acquisire byte e hash.
- [x] Confrontare due strutture: integrazione diretta Next/corpus oppure prototipo offline separato.
- [x] Definire metriche, errori e casi limite prima del codice.
- [x] Implementare pipeline ripetibile e visualizzazione su dati reali, senza fetch/polling a ogni visita.
- [x] Verificare calendario, mezzanotte, corse/fermate/distanze mancanti, valori non validi e dati scaduti.
- [x] Verificare interfaccia mobile/desktop e conservare screenshot.
- [x] Ricontrollare main e diff finale; riportare limiti e controlli non eseguiti.

Pubblicazione, PR, merge, cron e deploy: non previsti in questa prima iterazione locale.

## Esito della prima iterazione

- PASS: 11 test offline; Black e Prettier; sintassi JS; tre feed reali con ricevute verificate; main ancora 41a953e5.
- PASS Browser: 12 combinazioni città/fascia desktop, 9 combinazioni città/viewport mobile/tablet, tabella/dettaglio, 2D/3D, tastiera, controlli mappa e reset, tre stati senza servizio; console vuota e nessun overflow globale.
- Artifact: cartella gtfs-20261030 della visualizzazione della chat. HTML autosufficiente e analysis.json conservati fuori Git; raw originali nella cache ignorata di questa directory.
- NOT RUN: integrazione corpus e gate Next/CI/deploy del prodotto. Questa consegna è un prototipo di ricerca locale, non una feature pubblicata.
- Limiti: Roma solo linea 8 nel feed acquisito; GTT non commerciale; licenza Roma da verificare prima della pubblicazione. Firenze/Bologna/Genova/Napoli documentate come estensioni, non importate.
- Misura locale singola: pipeline per tre città 20,53 s, RSS massimo circa 232 MiB; HTML circa 1,2 MB. Nessuna proiezione economica da questi numeri.

## Iterazione 2: riferimento cartografico, 30 ottobre

Base: 0fdea9948e112bb65870cd149747cd6d007f6f1b. Richiesta: aggiungere città e avvicinare la mappa al riferimento fornito, con contesto geografico reale.

- [x] Acquisire nuovi feed ufficiali e verificarne geometrie/calendari, senza trattare un fallimento come dati assenti.
- [x] Aggiungere cartografia OpenStreetMap locale con attribuzione, hash, perimetro e data distinti dal GTFS.
- [x] Riempire la vista, correggere scala/proiezione dei rilievi, aggiungere navigazione e selezione efficaci.
- [x] Verificare dati e UI, mouse/tastiera, viewport e stato senza dati; conservare confronto visivo.
- [ ] Prova fisica touch/pinch prima della pubblicazione: NOT RUN, simulazione non supportata dal Browser in-app.
- [x] Aggiornare metodo, risultati e diff; nessun push/merge/deploy implicito.

### Esito della seconda iterazione

- PASS: Firenze tram (157 tratti) e Bologna bus/filobus (6.354 tratti, area urbana dichiarata). Cinque città utilizzabili; Bari indisponibile per il calendario del 30 ottobre, Genova esclusa perché senza shapes.
- PASS: sei estratti OSM completi con hash/perimetro/data/provider verificati. Gli errori di trasporto e le risposte incomplete sono stati rifiutati. HTTP/2 via curl ha permesso le acquisizioni restanti; nessun retry/provider automatico.
- PASS: 20 test offline; sintassi JS; formato; 24 combinazioni città/fascia confrontate con le righe derivate dai raw, 15 viste responsive a 320/390/768 px senza overflow del documento; dettagli di cinque città, picking sulla curva, paginazione, filtro linea, 2D/3D, controlli/reset, pan e cambi rapidi. Console warning/error vuota.
- PASS: segmenti, geometrie e metriche delle tre città originarie identici all'artifact della prima iterazione. Main ricontrollato e invariato a 41a953e5; nessun file del prodotto modificato.
- Artifact: gtfs-20261030-v2 nella cartella visualizzazioni della chat, con HTML autosufficiente (6.723 MB), analysis.json, screenshot desktop/mobile e ricevute Browser. Bundle gzip per città; massimo due città decodificate; CSP senza connessioni remote.
- Misura descrittiva: disegni nella matrice desktop circa 4–39 ms sul Browser di questa macchina; non benchmark del telefono o prova di risparmio hosted.
- NOT RUN: touch/pinch su dispositivo fisico, integrazione corpus, gate Next/CI/deploy. Licenze Roma/Bari da verificare; GTT solo non commerciale. Nessun push, PR, merge o deploy.

## Iterazione 3: esplorazione e controlli, 31 ottobre 2026

Base: 06021cdb41e8574755c135221d4fe1b78defac79. Rimane un prototipo locale nello stesso branch.

- [x] Ground: checkout principale preservato, branch isolato pulito, flusso acquisizione/analisi/rendering e prove precedenti riletti.
- [x] Sketch: confrontare UI a toolbar contro rail laterale; mantenere toolbar compatta, mappa ampia e pannello vista raggruppato. Separare matematica della camera dal DOM prima dei nuovi controlli.
- [x] Definire prima del codice errori attesi: zoom fuori range, rotazione oltre 180°, inversa prospettica/horizon, fit a rete ruotata, resize, ricerca/filtri senza risultati, export CSV con testo ostile, asincronia tra città.
- [x] Implementare camera coerente, bussola/inclinazione/rilievo, vista espansa e interazioni mobile senza intrappolare lo scorrimento.
- [x] Aggiungere ricerca fermate, filtri di velocità, selezione leggibile e CSV della selezione; tutti i valori restano quelli dell'orario.
- [x] Ridurre lavoro ripetuto per sfondo statico e hover senza aumentare richieste remote o dipendenze.
- [x] Verificare nuovi feed ufficiali e aggiungere solo città con calendario/geometrie utilizzabili e ricevute.
- [x] Verificare dati originali invariati; test offline mirati, Browser desktop/mobile, tastiera, confini filtri, console, screenshot. Prova telefono fisico separata.
- [x] Ricontrollare main e diff, aggiornare documenti e artifact, commit locale. Nessun push/PR/merge/deploy.

### Esito della terza iterazione

- PASS: sette città utilizzabili; aggiunte Cagliari (servizio esplicito 31/10) e Venezia/Mestre automobilistico (30/10). Bari resta indisponibile, senza sostituzioni di data.
- PASS: camera e renderer separati, zoom/rotazione coerenti, fit con rilievi, bussola/inclinazione, vista espansa, ricerca fermate, filtri velocità, tabella e CSV. Mobile con esplorazione esplicita e dettaglio che lascia liberi i comandi.
- PASS: 40 test offline; 32 combinazioni città/fascia e 28 filtri velocità; 21 viewport reali a 320/390/768 px senza overflow o comandi visibili sovrapposti. File assente/corrotto e recupero verificati nel Browser.
- PASS: city asset separati, hash/budget verificati, cache dati di due città, due buffer grafici. Nessuna nuova dipendenza, API o richiesta remota durante l'esplorazione.
- Artifact: gtfs-20261031-v3, con output a directory, HTML offline, analysis.json, screenshot e prove JSON. Verifiche confrontate con i dati sorgente dell'analisi.
- NOT RUN: gesti su telefono fisico, integrazione corpus, gate Next/CI/deploy del prodotto. Licenze Roma/Bari/Venezia da verificare; GTT solo non commerciale. Nessun push, PR, merge o deploy.

## Iterazione 4: selettori, nuove reti e prove di carico UI

Base: 50ab833a. Richiesta: rifinire frecce/selettori, ampliare città e dati,
migliorare mappa/UX e stressare i flussi nel Browser. Resta ricerca locale.

- [x] Preservare checkout principale; branch isolato pulito e istruzioni rilette.
- [x] Riprodurre selettori a 573 px e stato iniziale, distinguendo l'HTML in cache.
- [x] Verificare fonti ufficiali per nuove città, calendario/geometrie/licenze e byte.
- [x] Definire prima del codice rischi di filtri/direzioni, tooltip, fit, controlli e caricamento.
- [x] Rifinire selettori nativi e icone, vista iniziale e selezione sulla mappa.
- [x] Ampliare dati utilizzabili senza cambiare le metriche precedenti.
- [x] Verificare flussi completi, errori, tastiera, rapidi cambi/zoom/rotazione e viewport reali.
- [x] Aggiornare documentazione, artifact e commit locale; nessun push/PR/merge/deploy.

### Esito della quarta iterazione

- PASS: nove città utilizzabili, aggiunte Palermo tram (74 tratti di TRAM1/2/3) e Padova SIR1 (73 tratti, data esplicita 31/10). Limiti e condizioni nelle fonti; Bari resta indisponibile.
- PASS: chevron SVG e spazio riservato nei selettori nativi, testi dei filtri compatti, copia/ripristino dei link con fallback clipboard, punti A/B e inquadratura del tratto, fit centrato nella proiezione.
- PASS: 45 test offline, 40 città/fascia, 36 filtri velocità, 36 viewport reali, 18 fit di reti complete, 120 azioni ai limiti e 45 cambi rapidi. Mouse, ricerca/tastiera, clipboard e file assenti/corrotti con recupero verificati nel Browser.
- PASS: dati e mappe delle otto voci precedenti identici; asset statici verificati per hash e byte, nessuna dipendenza o API remota aggiunta.
- Artifact: gtfs-20261031-v4 nella cartella visualizzazioni della chat, con screenshot, output a directory e offline, analisi, matrici e ricevute. Main ricontrollato; solo ricerca locale modificata.
- NOT RUN: telefono fisico, integrazione corpus, gate Next/ETL/CI/deploy del prodotto. Nessun push, PR, merge o deploy. Licenze non dichiarate restano da verificare prima di pubblicare.

## Iterazione 5: dettagli di interfaccia e disclosure

Base: e765a675. Richiesta: centrare l'icona Centro, migliorare le tre sezioni
informative con +/− e apertura/chiusura animata, rivedere dettagli di UI/UX,
verificare altri feed e stressare i flussi nel Browser. Resta ricerca locale.

- [x] Branch isolato pulito; screenshot e stili attuali riletti.
- [x] Riprodurre il disallineamento a 573 px e misurare gli altri controlli.
- [x] Definire rischi prima del codice: click rapidi/reversals, tastiera, reduced motion, contenuti che cambiano durante l'apertura, focus e fallback senza animazioni.
- [x] Implementare disclosure accessibili e animazione breve, senza nuove dipendenze o lavoro continuo.
- [x] Verificare nuove fonti, calendario/geometrie/licenze e integrare solo dati utilizzabili.
- [x] Testare desktop/mobile, aperture/chiusure ripetute, cambi città, mappa, errori e screenshot.
- [x] Ricontrollare main, dati precedenti e artifact; commit solo locale.

### Esito della quinta iterazione

- PASS: Centro centrato, campo ricerca allineato, CSV/paginazione con SVG e gruppi centrati. Metadati più ordinati e metodologia compatta.
- PASS: disclosure native con +/−, animazione breve, tastiera/reduced motion immediati, corpi in chiusura inert e interruzioni robuste. E2E su 17 reversals, resize, cambio città/preferenza, 20 dettagli e fallback.
- PASS: Catania autobus (2.713 tratti, 50 linee, servizio 30/10) e relativo estratto OSM verificati. Dieci città utilizzabili; Taranto esclusa per assenza di servizio alle date scelte, Bari invariata.
- PASS: 44 città/fascia, 11 pannelli fonte, 40 viewport reali, centraggio e campi a zero scarto; recupero da file mancanti/corrotti. I dati delle dieci voci precedenti restano identici.
- Artifact: gtfs-20261031-v5 nella cartella visualizzazioni della chat, con confronto visivo, ricevute e prove Browser ripetibili. Commit solo locale; main ricontrollato.
- NOT RUN: telefono fisico, integrazione corpus, gate Next/ETL/CI/deploy del prodotto. Nessun costo di build Vercel, push, PR o merge.

## Iterazione 6: menu aperti e mezzi per città

Base: 77512c48; main osservato 41a953e5. Solo ricerca locale, nessun deploy.

- [x] Preservare checkout principale e dati precedenti; leggere feedback e riprodurre UI.
- [x] Verificare fonti ferroviarie ufficiali, calendari e geometrie; integrare solo dati verificati.
- [x] Definire prima del codice rischi: città con più mezzi, link precedenti, alias archivi, menu fuori viewport, focus/tastiera, ricerca vuota, carichi concorrenti e reduced motion.
- [x] Separare città e mezzo, evitando confusione tra copertura parziale e rete reale.
- [x] Rifinire menu aperti, +/− a sinistra senza contorno e animazioni brevi.
- [x] Verificare dati invariati, Browser desktop/mobile, errori, link, filtri, mappa e menu.
- [x] Salvare screenshot/prove, aggiornare documenti e commit locale.

### Esito della sesta iterazione

- PASS: città e mezzo distinti, menu con ricerca/check/scroll interno, nomi lunghi leggibili, tastiera e popup dentro la viewport. Icone +/− a sinistra senza sfondo, animazioni brevi.
- PASS: aggiunti metro Milano/Roma, bus Milano e treni regionali Firenze/Pisa. 15 reti utilizzabili in 11 città; Bari ancora indisponibile. Trenord escluso per assenza di shapes, fonte Toscana datata gennaio dichiarata.
- PASS: 50 test offline, 60 reti/fasce più Bari, 16 pannelli fonte, 24 menu responsive, 20 filtri velocità, 11 inversioni animate. Link ferroviario ripristinato esattamente; errore file e recupero senza reload; versione offline verificata.
- PASS: dati e mappe delle 11 voci precedenti identici. Hash/byte di tutti i 16 asset verificati; console normale vuota. Main remoto ricontrollato a 41a953e5; solo ricerca locale modificata.
- Artifact: gtfs-20261031-v6 nella cartella visualizzazioni della chat, con screenshot, statico/offline, dati, matrici e verify-final.py. Il verificatore conferma le osservazioni Browser salvate contro l'analisi.
- NOT RUN: telefono fisico, VoiceOver, integrazione corpus, gate Next/ETL/CI e deploy del prodotto. Nessun push, PR, merge o build Vercel.

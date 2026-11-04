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

## Iterazione 7: qualità visiva e altre reti ufficiali

Base: d061ccfb. Obiettivo: maggiore leggibilità e cura di mappa/dettaglio,
nuovi dati verificati e stress test nel Browser. Solo prototipo locale.

- [x] Preservare checkout principale, confermare worktree/branch e leggere Emil Design Skills.
- [x] Verificare nuovi feed ufficiali, licenze, calendario del 30/10 e geometrie senza cambiare le date precedenti.
- [x] Riprodurre criticità visive e definire prima del codice rischi: dati assenti, caricamenti rapidi, selezione, contrasti, touch/keyboard, export e camera.
- [x] Migliorare gerarchia, dettaglio della selezione e leggibilità cartografica senza animazioni continue o nuove richieste remote.
- [x] Integrare reti con ricevute; conservare identici i dataset precedenti.
- [x] Stress test Browser desktop/mobile, focus, filtri, errori, cambio città e controlli mappa; test offline pertinenti.
- [x] Salvare screenshot/prove, aggiornare documenti e commit locale; nessun push/PR/deploy.

### Esito della settima iterazione

- PASS: bus Trento/Rovereto/Ferrara e metro Torino verificati: 19 reti utilizzabili in 14 città. R35 esclusa per 48 corse senza shape utile; nessun tracciato inventato.
- PASS: gerarchia e tipografia più leggibili, controlli 2D/3D da 44 px su mobile, nomi di luogo prioritari. Il dettaglio non copre comandi o selezione; inquadratura adattata agli ingombri reali e al resize.
- PASS: caricamenti superati annullati; vecchie righe/mappa/fonti non interattive durante l'attesa. PNG locale con scala/nord/fonti, CSV precedente conservato; niente dipendenze o servizi remoti aggiunti.
- PASS: 51 test offline, 76 reti/fasce più Bari, 20 pannelli fonti, 35 viste responsive e 3 casi ai limiti, 16 menu. Hash errato/recupero, PNG 3D/2D, errore export simulato, CSV reale e offline verificati.
- PASS: proiezione indipendente dei dati/camera osservati, nessun punto A/B o rilievo sotto pannello/comandi. Tutti i 16 dataset precedenti identici, console normale vuota. Main remoto invariato a 41a953e5; checkout principale preservato.
- Artifact: gtfs-20261101-v7 nella cartella visualizzazioni della chat; screenshot, PNG/CSV scaricati, ricevute, matrici ed eventi, verificatore riutilizzabile.
- NOT RUN: telefono fisico/VoiceOver, integrazione corpus, gate Next/ETL/CI/deploy del prodotto. Commit solo locale; nessun push, PR, merge o build Vercel.

## Iterazione 8: treni regionali e risultati ordinabili

Base: be8a8605. Solo ricerca locale; checkout principale e file del prodotto preservati.

- [x] Riprodurre tabella a ordinamento fisso e rileggere contratti dati/UI.
- [x] Aggiungere Lucca e Livorno solo con geometrie/calendario verificati e cartografia con ricevuta.
- [x] Prima del codice: coprire ordinamento stabile, filtri, immutabilità e link vecchi/malformati.
- [x] Implementare intestazioni ordinabili accessibili, CSV coerente, paginazione resettata e link ripristinabili.
- [x] Test offline e Browser desktop/mobile, cambi rapidi, zero risultati, tastiera, selezione e mappe.
- [x] Conservare dati precedenti identici, screenshot, risultati e commit locale. Nessun push/PR/merge/deploy.

### Esito dell’ottava iterazione

- PASS: Lucca aggiunta, 130 tratti complessivi / 62 mattino; 20 reti utilizzabili in 15 città. Livorno candidato escluso dal selettore dopo due acquisizioni OSM fallite, non assenza di servizio.
- PASS: ordinamento velocità/corse in entrambi i versi, CSV coerente, link vecchi e nuovi, focus da tastiera e selezione mantenuti, ritorno alla prima pagina. Nessuna nuova dipendenza/API.
- PASS: 53 test offline (27 Python, 26 Node); 84 reti/fasce e 36 ordinamenti responsive confrontati con i dati dell’analisi. Zero overflow globale; hit area almeno 44×44 px. CSV 62 righe con hash fonte; PNG ispezionato; console warning/error vuota.
- PASS: 60 azioni consecutive sulla camera a 320 px, zero risultati e recupero. Cartografia Lucca ampliata al perimetro dei dati dopo aver riprodotto un tratto periferico senza contesto.
- PASS: precedenti 20 voci identiche all’artifact v7; main remoto ricontrollato tramite connettore, ancora 41a953e5. Checkout principale preservato.
- Artifact: gtfs-20261101-v8, prove JSON, verificatore delle osservazioni salvate, CSV/PNG, HTML offline e screenshot.
- NOT RUN: telefono fisico/touch/pinch, screen reader reale, gate Next/CI/deploy. Clipboard nativa non asserita: IAB restituisce stringa vuota; URL osservato nel campo di condivisione e ripristinato nel Browser. Nessun push, PR, merge o deploy.

## Iterazione 9: copertura ferroviaria e filtro contestuale

Base: 941ea9f5. Prototipo locale; nessuna pubblicazione. Prima degli interventi:

- [x] Branch pulito e anteprima corrente riletti; spazio disco limitato, evitare duplicazioni di dati/archivi.
- [x] Verificare Livorno e Prato: calendario, geometrie, perimetro, cartografia e ricevute; includere solo output validi.
- [x] Migliorare il badge di linea nel dettaglio: filtro rapido riconoscibile e hit area 44 px.
- [x] Browser: badge non filtrato isola linea e inquadra rete, badge già filtrato ripristina linee, selezione rimossa, focus al canvas; fascia/velocità/ordine restano invariati.
- [x] Browser: tastiera, menu, nuove città e tutte le fasce, responsive 320/390/573/1280, filtri vuoti, cambi rapidi, zoom e dettagli senza sovrapposizioni.
- [x] Dati delle precedenti 21 voci ricontrollati, con audit delle variazioni dovute alla soglia geometrica, test offline pertinenti, PNG/CSV, screenshot e diff puliti; commit locale e anteprima aggiornata.

### Esito dell’iterazione 9

- PASS locale: 22 reti in 15 città. Nuovi autobus Torino/Roma; candidati Prato/Livorno esclusi dal selettore per cartografia indisponibile.
- PASS: difetto geometrico riprodotto prima del codice con test RED, sia con shape_dist_traveled sia con proiezione; soglia 100 m applicata a tutte le 23 voci. Audit delle differenze, fonti originali immutate.
- PASS: 54 test offline (28 Python, 26 Node), 92 reti/fasce, 12 casi filtro contestuale su quattro viewport, filtro con stato preesistente, CSV 11 righe e PNG ispezionato; 41.253 geometrie derivate validate. Zero overflow o sovrapposizioni badge/chiusura nei casi osservati.
- PASS: contrasto selezione visibile/fuori vista/ripristinata; sette cambi rapidi conclusi sull’ultima rete, console vuota. Stato pending non osservato con questa rete locale, nessuna nuova prova di cancellazione throttled dichiarata.
- PASS: main verificato tramite connettore, ancora 41a953e5; checkout principale preservato. Nessuna modifica al prodotto o a Vercel.
- Artifact: gtfs-20261101-v9 con analysis.json.gz, snapshot directory, ricevute, oracle, audit, osservazioni Browser, verificatore, PNG/CSV e screenshot. Evitate copie complete con hard link; solo il JSON temporaneo rigenerabile di questa iterazione è stato convertito in gzip.
- NOT RUN: HTML singolo della nuova versione (disco locale pieno), telefono fisico/touch/pinch, screen reader reale, gate Next/CI/deploy. Nessun push, PR o merge.

## Iterazione 10: controlli precisi e anteprima aggiornata

Base: b706acee. Ricerca locale; nessuna pubblicazione.

- [x] Branch pulito e skill rilette; disco quasi pieno, preservare versioni e raw.
- [x] Cercare altre fonti ufficiali; integrare estratti verificati di Prato e Livorno, senza nascondere errori o inventare geometrie.
- [x] Prima del codice: limiti zoom uguali a slider/camera; controlli disabilitati durante il caricamento, senza riattivarli da un frame.
- [x] Ripristino del solo filtro linea senza perdere velocità/fascia/ordine; tastiera e hit area coerenti.
- [x] Supportare gli artifact gzip nel renderer locale: file equivalenti, corrotti e troppo grandi verificati prima del codice.
- [x] Browser responsive, estremi zoom/resize, filtri e menu, dati precedenti invariati; artifact, screenshot e commit locale.
- [x] Aggiornare la scheda dell’anteprima aperta sulla vecchia versione solo dopo la verifica della nuova.


### Esito dell’iterazione 10

- PASS locale: 24 reti utilizzabili in 17 città; aggiunti treni Prato (76 tratti) e Livorno (89). Precedenti 23 voci identiche; 41.418 geometrie validate.
- PASS: X del solo filtro linea, etichetta e menu associati, chevron non compresso; hit area almeno 44 px senza salto di altezza. Zoom preciso fino al massimo frazionario e controlli inattivi durante il caricamento/resize.
- PASS: 60 test offline (34 Python, 26 Node); 100 reti/fasce, 12 rimozioni filtro e 36 stati zoom nel Browser, quattro viewport. Versione offline con entrambe le nuove città verificata; nessuna connessione consentita dalla CSP.
- PASS: gzip con budget espanso, scritture atomiche e riuso degli asset identici. Recupero locale da ENOSPC senza eliminare raw o versioni: due copie identiche dell’analisi v8 consolidate come hard link, percorsi e SHA invariati.
- PASS: anteprima dell’utente aggiornata dopo le verifiche, preservando sorgente e stato della vista. Main remoto ancora 41a953e5; checkout principale preservato.
- Artifact: gtfs-20261101-v10 con dati gzip, HTML directory/offline, ricevute, osservazioni Browser, verificatore, screenshot e ricevuta del commit locale.
- NOT RUN: telefono fisico/touch/pinch, screen reader reale, integrazione corpus, gate Next/CI/deploy. Nessun push, PR, merge o build Vercel.

## Iterazione 11: navigazione e lettura della mappa

Base: c3fdcb9d. Solo ricerca locale, nessun push o deploy.

- [x] Branch pulito, preview v10 verificata e skill Emil letta.
- [x] Cercare reti ufficiali: navigazione ACTV e Sassari; conservare byte, ricevute, date e fallimenti. Nessun percorso inventato o cambio data silenzioso.
- [x] Prima del codice: riprodurre tooltip troppo vicino ai bordi o obsoleto dopo un cambio vista; definire criteri per scheda compatta, posizione e annullamento su camera/filtri/touch.
- [x] Integrare soltanto reti con geometrie e cartografia verificate. Contratto del nuovo mezzo prima dell’implementazione.
- [x] Migliorare tooltip e gerarchia visiva senza animazioni frequenti, richieste remote, nuove dipendenze o duplicazione dei dati.
- [x] Test Browser desktop/mobile: menu e tastiera, caricamenti/cambi rapidi, camera, tooltip ai bordi, filtri, dati, export e offline. Test pertinenti e confronto dei dataset precedenti.
- [x] Documentare Before/After e limiti, salvare prove/screenshot, commit locale e anteprima aggiornata preservando la vista dell’utente.


### Esito dell’iterazione 11

- PASS locale: navigazione ACTV separata dagli autobus e Sassari centro, 26 reti in 18 città; 42.986 geometrie. Precedenti 25 voci identiche.
- PASS: tooltip ricco ma compatto, senza overflow o informazioni obsolete dopo zoom; apertura sul centro delle nuove reti e Inquadra conservato.
- PASS: 61 test offline, 108 reti/fasce, 12 casi responsive e quattro tooltip ai bordi; CSV 434 righe e PNG reali, versione offline verificata.
- PASS: metadati, esclusioni, date diverse e riuso non dichiarato espliciti. Main remoto verificato a 41a953e5; checkout principale preservato.
- Artifact: gtfs-20261101-v11 con analisi gzip, HTML directory/offline, ricevute, screenshot, verificatore e commit locale.
- NOT RUN: dispositivo touch e screen reader reali, gate del prodotto, push/PR/merge/deploy. Nessuna build Vercel.

## Iterazione 12: meno testo, nuove reti e anteprima coerente

Base: 01122c62. Solo prototipo locale; nessun push o deploy.

- [x] Branch e main preservati; riletti skill Emil, contratti e feedback. Browser Ferrara corrente già centrato; la scheda annotata punta a una preview precedente.
- [x] Rimuovere data e badge dall’intestazione, testo tecnico del footer e CSS/codice divenuti inutili. Conservare data di servizio nelle fonti e negli export.
- [x] Verificare GTFS ufficiali ARST/ASPO: calendari, geometrie, licenze, perimetri e ricevute. Nuove città e nuove reti solo se utilizzabili.
- [x] Ridurre gli ingombri dell’intestazione mobile senza cambiare camera o significato dei dati.
- [x] Browser: date nelle fonti al cambio rete e su errore, tutte le fasce, mobile/desktop, menu, tastiera, filtri, zoom, selezione, export e offline; misure dei dataset precedenti identiche, correzione della sola licenza Sassari documentata.
- [x] Salvare Before/After, verificatore e screenshot; aggiornare in modo atomico anche la preview stabile 3274, mantenendo gli artifact storici e tutti i percorsi necessari.
- [x] Test offline pertinenti, main ricontrollato, commit solo locale e consegna della preview verificata.


### Esito dell’iterazione 12

- PASS locale: 28 reti in 19 città, 29 voci; aggiunti bus Olbia (853 tratti) e tram Cagliari (28). Sassari tram escluso perché le 84 corse MSS non hanno shape.
- PASS: 27 reti precedenti con misure e ricevute invariate; sola correzione della licenza Sassari autobus da catalogo ufficiale. 43.867 geometrie validate.
- PASS: data e badge rimossi dall'intestazione; data nelle fonti/export. Contatore senza ripetizione della linea, titolo mobile a tutta larghezza e target di almeno 44 px.
- PASS: 61 test offline, 116 combinazioni reti/fasce, 16 scenari responsive, errore d'integrità e recupero, CSV/PNG e HTML offline; screenshot finali e verificatore salvati.
- PASS: preview stabile 3274 promossa atomicamente e controllata nel Browser. Vecchio indice e asset storici preservati. Main remoto ancora 41a953e5 e checkout principale preservato.
- NOT RUN: telefono fisico, screen reader reale e gate del prodotto. Nessun push, PR, merge, deploy o build Vercel.

## Iterazione 13: ricerca dei mezzi e contesto leggibile

Base: 23c240f61774987ffac5695363e7ad9f84ad68ad. Solo ricerca locale, senza pubblicazione.

- [x] Branch pulito, main preservato e skill Emil rilette. Riprodotto nel Browser: cercare «Roma bus» nel menu città produce zero risultati benché Roma abbia bus.
- [x] Verificare GTFS Nuoro e ferrovie ARST: data esplicita, geometrie, licenza, perimetri e ricevute; riusare mappe solo con bounds identici.
- [x] Correggere ricerca a più parole e accenti, senza cambiare valori o fallback nativi. Definire casi negativi prima del codice; provare tastiera, vuoto, ritorno e cambi rapidi nel Browser.
- [x] Raffinare gerarchia della cartografia e lettura dei valori in tabella; i colori non sostituiscono i numeri. Nessuna modifica alle metriche o alla camera.
- [x] Verificare tutte le reti/fasce e i dati precedenti; Browser mobile/desktop, overflow, selezione, filtri, zoom, rotazione, menu, errori e offline. Screenshot e verificatore ripetibile.
- [x] Documentare Before/After, fonti, esclusioni e limiti. Promuovere la preview solo dopo i controlli; commit locale, nessun push/build Vercel.


### Esito dell’iterazione 13

- PASS locale: Nuoro bus (919 tratti), Nuoro treni (2) e Sassari treni (4), tutti con geometrie GTFS e perimetri dichiarati. 31 reti in 20 città, 44.792 geometrie; le 29 fonti precedenti sono interamente identiche.
- PASS: ricerca «Roma bus» corretta, parole invertite e accenti verificati. Indicatore velocità dalla palette condivisa e cartografia meno marcata, senza cambiare numeri o camera.
- PASS: 62 test offline, 128 reti/fasce con valori/colori, 16 scenari responsive, quattro scenari camera e due verifiche focus espanso. CSV/PNG reali e versione offline verificati.
- PASS: nuovo mirror OSM scelto esplicitamente dopo errori documentati; ricevute, hash, byte, perimetri e rifiuto dei provider estranei verificati prima dell'implementazione. Nessuna acquisizione nelle visite.
- PASS: origin/main aggiornato a c3fa7372; il commit concorrente modifica soltanto immersive-chrome.tsx e bdap-history.ts. Nessuna sovrapposizione o modifica a questi file. Checkout principale preservato.
- Artifact: gtfs-20261102-v13 con verificatori, dati congelati, ricevute, esiti Browser, export e screenshot. Preview stabile 3274 aggiornata dopo i controlli, indice precedente conservato.
- NOT RUN: telefono fisico, screen reader reale, gate Next/ETL/CI del prodotto e deploy. Nessun push, PR, merge o build Vercel; commit locale del solo prototipo.

## Iterazione 14: treni nazionali e lettura del ritardo

Base: fb3e8c0ca82e47539c5b6b76502b259d5fe810f2. Ricerca locale, nessuna pubblicazione.

- [x] Branch pulito, main e preview preservati; skill Emil rilette. Consultazione Gmail limitata ai numeri delle corse: nessun PNR, biglietto o dato personale da salvare nel progetto.
- [x] Fonte pubblica ViaggiaTreno: FR 8509 del 2 novembre, origine/data restituite dalla ricerca ufficiale. Dettaglio fermate disponibile; richieste API/HTTPS dirette 403, usare soltanto l'interfaccia pubblica accessibile.
- [x] Conservare rilevazioni pubbliche verificabili; distinguere ritardo cumulato, sua variazione, orario programmato, istante di acquisizione e cause non osservate. Una corsa non diventa una tendenza.
- [x] Prima del codice: definire rifiuti per data/numero incoerenti, tempi mancanti, corsa incompleta, mezzanotte ambigua e fonte alterata. Nessun valore mancante diventa zero o previsione effettiva.
- [x] Aggiungere una vista locale delle corse ferroviarie con percorso schematico, tempi e variazioni; nessun tracciato geografico inventato, polling o nuove spese. Mappa GTFS e offline precedenti restano funzionanti.
- [x] Verificare nuove fonti ufficiali GTFS ferroviarie/metro, date, geometrie, licenze e perimetri prima dell'integrazione. Documentare anche i candidati esclusi.
- [x] Migliorare UI/UX con Emil; Browser su mobile/desktop, tastiera, filtri, fonti, export, stati vuoti/errori, deep link e offline. Confrontare le 32 fonti precedenti.
- [x] Documentare Before/After, fonti, limiti e prove; main ricontrollato, promozione atomica della preview e commit locale. Nessun push/build Vercel.

Esito locale: 48 test Python + 28 Node; 136 combinazioni fonte/fascia,
8 viste ferroviarie responsive, CSV con assenze conservate, deep link,
camera/resize e due HTML autonomi con CSP senza connessioni. Nessuna nuova
città completa: la nuova copertura è ferroviaria e parziale, dichiarata.
L'estratto OSM nuovo non è stato acquisito; il limite non è mascherato.
Telefono fisico, screen reader, clipboard virtuale e gate/deploy del prodotto
non verificati. Main remoto c3fa7372 invariato dal controllo precedente.

## Pubblicazione del branch, 3 novembre 2026

Obiettivo: portare tutte le iterazioni sul branch GitHub dedicato, mantenendo
main invariato e riepilogando quanto resta. Base funzionale 9081fd07;
main verificato c3fa7372. Nessuna PR o deploy richiesta.

- [x] Albero pulito; destinazione remota e modifiche concorrenti controllate.
- [x] Merge di origin/main nel solo branch del prototipo, due file estranei preservati.
- [x] Test mirati ripetuti; risultati Browser precedenti distinti da nuove prove.
- [x] README aggiornato e STATO.md con funzionalità, copertura, limiti e prossimi passi.
- [x] Preparato un solo push senza force; verifica dello SHA remoto prevista dopo il trasferimento.
- [x] Vercel Preview → Branch Tracking verificato disabilitato nel Browser; nessuna impostazione cambiata.

Il commit pubblicato e il confronto remoto sono riportati nella consegna.

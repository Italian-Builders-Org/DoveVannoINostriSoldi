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

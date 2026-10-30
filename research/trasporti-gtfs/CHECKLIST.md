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


## Esito

- PASS: 11 test offline; Black e Prettier; sintassi JS; tre feed reali con ricevute verificate; main ancora 41a953e5.
- PASS Browser: 12 combinazioni città/fascia desktop, 9 combinazioni città/viewport mobile/tablet, tabella/dettaglio, 2D/3D, tastiera, controlli mappa e reset, tre stati senza servizio; console vuota e nessun overflow globale.
- Artifact: cartella gtfs-20261030 della visualizzazione della chat. HTML autosufficiente e analysis.json conservati fuori Git; raw originali nella cache ignorata di questa directory.
- NOT RUN: integrazione corpus e gate Next/CI/deploy del prodotto. Questa consegna è un prototipo di ricerca locale, non una feature pubblicata.
- Limiti: Roma solo linea 8 nel feed acquisito; GTT non commerciale; licenza Roma da verificare prima della pubblicazione. Firenze/Bologna/Genova/Napoli documentate come estensioni, non importate.
- Misura locale singola: pipeline per tre città 20,53 s, RSS massimo circa 232 MiB; HTML circa 1,2 MB. Nessuna proiezione economica da questi numeri.

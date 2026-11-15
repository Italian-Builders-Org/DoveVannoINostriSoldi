# Lettura locale Supabase

- Obiettivo: collegare il corpus del sito locale al DB già verificato, senza esporre credenziali o cambiare accessi pubblici. Ambito snapshot tematici in chiarimento.
- Base: 5fdcf744, dati c3fa7372; branch codex/supabase-local-reader, worktree proprio.
- Atteso: backend opt-in locale; stessi payload, filtri, cursori, limiti, provenance e controlli integrità del selettore. Nessun fallback silenzioso al filesystem quando DB non disponibile. Connessioni e query bounded, solo SELECT in transazioni read-only.
- Rischi: chunk divergente/mancante, release errata, catalog-only esposto, errori DB/timeout, credenziali nei log/client, scansioni illimitate, cache che nasconde corruzione.
- Verifica prevista: test isolati prima dell'implementazione per integrità/errori/configurazione, confronto reale API locale filesystem↔DB, browser mobile/desktop e typecheck. ETL non modificato; suite ETL NOT RUN. Nessuna PR/deploy richiesta.

## Esito

- Collegato il corpus via PostgreSQL privato, opt-in con `npm run dev:supabase`; credenziale letta dal file originale con `DVNS_ENV_FILE`, mai copiata al worktree. Nessun DDL/grant, scrittura o cambio del deploy.
- Reader: al massimo 2 connessioni, transazioni READ ONLY esplicite (startup options del Session pooler non sufficienti), timeout SQL 10 s e deadline 15 s. Due SELECT per chunk: ricevuta e max 1.000 payload tramite PK. Ordinamento sulla colonna numerica originale, non sull'alias testuale. Filtri/cursori e budget del selector restano invariati; niente nuove cache/query results o acquisizioni.
- Integrità: JSON canonico ricompresso nel gzip del contratto sorgente e confrontato con hash della prova locale. Fonte DB non verificata o mancante → errore 503/no-store; nessun fallback locale. Credenziali e dettagli driver redatti al confine.
- Test prima implementazione: nuovo file falliva per modulo mancante; verifiche successive PASS. 19 test mirati Node (4 nuovi + 15 contratti pubblici) PASS, eslint mirato PASS, typecheck PASS. Artifact `artifacts/supabase-reader/tests.log`, `reader-tests.log`, `typecheck.log`.
- E2E reale `node --env-file=/percorso/originale/.env.local --experimental-strip-types artifacts/supabase-reader/live-parity.mjs`: 7 confronti integrali filesystem↔DB PASS (ricerca, cursore, confine 999/1000, dataset sanitario, piccolo dataset, catalog-only). Nessuna modifica alle righe DB. `node artifacts/supabase-reader/http-check.mjs`: API 200, 400, 404 e no-store per errori PASS. Prova isolata DB non configurato: 503 con risposta generica, non cacheabile.
- Browser Chrome tramite Computer: ricerca IVECO inviata da tastiera, 33 risultati/389; desktop e mobile 390x844 PASS, nessun overflow globale e nessun errore console. Prove `desktop.png`, `mobile.png`. Browser su dev locale, produzione/build NOT RUN: nessun cambio UI o PR richiesta. ETL NOT RUN (producer e artifact immutati).
- Server locale lasciato attivo su http://127.0.0.1:43174, PID 57173, sessione di avvio 17583. Comando: `DVNS_ENV_FILE=/Users/andreaalbagli/Documents/DVNS/.env.local npm run dev:supabase -- --hostname 127.0.0.1 --port 43174`; log `artifacts/supabase-reader/server.log`. Il processo è di questa task, nessun server altrui riutilizzato/terminato.
- `origin/main` aggiornato e confrontato, base dati c3fa7372 invariata. Lavoro parallelo su altri branch conservato. Nessun push/PR/merge/deploy. SHA verificato e digest artifact in `artifacts/supabase-reader/evidence.json`.
- Perimetro comunicato in chat dopo chiarimento opzionale senza risposta: righe del corpus Dati su DB; catalogo/prove locali e snapshot tematici separati restano su file. Estendere gli adapter tematici richiede una modifica distinta.

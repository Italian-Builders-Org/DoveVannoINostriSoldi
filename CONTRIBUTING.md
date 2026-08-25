# Contribuire a DoveVannoINostriSoldi

Grazie per il contributo. Il progetto tratta dati pubblici che possono essere
facilmente interpretati oltre ciò che la fonte dimostra. Una modifica è pronta
quando sono corretti sia il codice sia il significato pubblicato.

## Prima di scrivere codice

Apri o collega una issue per cambiamenti sostanziali. Per una nuova fonte indica
titolare, URL ufficiale, licenza specifica, formato, geografia, periodo di
riferimento, data di pubblicazione e frequenza di aggiornamento. Spiega anche che
cosa il dato non misura.

Non distribuire totali nazionali fra territori senza una geografia pubblicata
dalla fonte. Non trasformare anomalie, differenze contabili o valori elevati in
affermazioni su spreco, frode, efficienza, qualità o responsabilità individuale.

## Ambiente e branch

Usa Node indicato da `.nvmrc` e installa le dipendenze con `npm ci`. Parti
dall'ultimo `origin/main` e mantieni la PR focalizzata. Se la checkout principale
contiene lavoro non tuo, usa un worktree isolato e non resettarla.

## Contratti dati

Ogni snapshot versionato deve avere un adapter fail-closed. Il contratto deve
bloccare almeno schema inatteso, provenienza non ufficiale, licenza o periodo
incoerenti, hash diversi, duplicati, importi non validi e riconciliazioni rotte.
Le date di riferimento, pubblicazione, osservazione e verifica restano campi
distinti.

## Verifica locale

La CI è organizzata in quattro job paralleli (`static`, `node`, `etl`,
`production`) aggregati da `CI / required`. Puoi riprodurre gli stessi gate
localmente con i comandi stabili:

```bash
npm ci
npm run ci:static
npm run test:node
npm run test:etl
npm run build
git diff --check
```

`ci:static` esegue lint, typecheck, design:check e brand:check insieme.
I test browser e Lighthouse richiedono un server `next start` attivo su
`127.0.0.1:3000`; vedi `scripts/ci/run-production-gates.sh` per l'orchestrazione
completa usata dalla CI.

Una modifica UI richiede anche verifica Browser a 390, 768 e 1280 px, tastiera,
focus, stati di errore/caricamento/vuoto, console e overflow. Una modifica MCP
richiede smoke test sul server HTTP reale e casi negativi. Specifica sempre ciò
che non hai potuto eseguire.

## Licenza dei contributi

Inviando una pull request accetti che il tuo contributo sia incluso nel progetto
sotto GNU Affero GPL v3 (vedi `LICENSE`). Per usi proprietari o commerciali
senza obblighi AGPL vale quanto descritto in `COMMERCIAL.md`.

## Review e merge

La CI verde è necessaria ma non sufficiente. La review valuta separatamente
correttezza, semantica dei dati, accessibilità, sicurezza, performance e
manutenibilità. I thread devono essere risolti con una modifica verificata o con
una motivazione concreta. Non usare force-push sulle branch dei contributor.

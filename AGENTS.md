## Strategia dei test

- Prima del codice, definisci il comportamento atteso e i modi in cui può
  fallire. Se serve un test unitario, scrivilo prima dell'implementazione;
  per un bug esistente, riproduci il difetto prima della correzione. Non
  aggiungere test a posteriori che si limitano a ricopiare il codice.
- Preferisci gli E2E per verificare funzionalità e flussi completi. Usali come
  unica verifica quando coprono anche gli errori e i confini rilevanti; mantieni
  test isolati per rischi non coperti, come integrità dei dati, quote e timeout.
- Ogni esecuzione E2E deve lasciare una prova verificabile e ripetibile:
  comando, revisione, fixture/configurazione, esito e artifact pertinenti
  (report, log, screenshot). Escludi credenziali e dati privati.
- Ogni test deve intercettare un bug reale. Prima di rimuoverlo, indica quale
  verifica rimasta copre lo stesso rischio; il numero o il tipo di test non
  dimostrano ridondanza. Per scegliere e rivedere i test leggi
  [tests/AGENTS.md](tests/AGENTS.md).

## Continuità del lavoro

Prima di fermarti, chiediti: “C’è un prossimo passo che l’utente vorrebbe che io facessi?” Se sì, continua: il lavoro non è finito.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lavorare in questo repository

- Se la task è in un dominio mappato, leggi solo la sua sezione in
  `docs/AGENT_CONTEXT.md`. Per una task non mappata parti da
  [ARCHITECTURE.md](docs/ARCHITECTURE.md) (percorsi del dato) e
  [CONTRIBUTING.md](CONTRIBUTING.md) (setup e gate). Non servono database, Docker o credenziali.
- MCP/API: leggi [MCP e API](docs/AGENT_CONTEXT.md#mcp-e-api) prima di toccare
  `src/lib/mcp/`. `/api/dati/[dataset]` è il corpus integrato, non un ID MCP.
- Percorsi: pagine/API `src/app/`; UI `src/components/`; adapter e aggregazioni
  `src/lib/`; contratti `src/lib/data/`; acquisizione `scripts/etl/`. Per le
  route del corpus integrato, il confine pubblico è `integrated-public-view.ts`
  e niente righe raw nei Client Component; per snapshot tipizzati e fonti live
  vedi la sezione pertinente di `docs/AGENT_CONTEXT.md`.
- Validazione e provenance restano al confine degli snapshot; zero, mancante e
  oscurato restano distinti.
- Parti da `git status --short --branch`. Per lavoro isolato usa un worktree con
  `node_modules`, `.venv`, `.next` e porta propri. Non copiare `.env` o
  condividere `.next`.
- Prima di modificare file, annota obiettivo, SHA di base e controlli previsti
  in una checklist della task. Verifica PR e modifiche concorrenti; conserva il
  lavoro altrui. Prima della consegna aggiorna `origin/main` e riesamina il diff
  rispetto alla base corrente, ripetendo i controlli dei contratti coinvolti.
- Per ogni file modificato, verifica comportamento, casi di errore e confini
  del dato. Aggiungi test che rilevino regressioni concrete e commenti che
  spieghino vincoli non evidenti; evita refactor estranei al ticket.
- Test mirati: `node --experimental-strip-types --test tests/NOME.test.mjs`
  (`--test-name-pattern='testo'` per un caso); ETL con virtualenv attivo:
  `DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_NOME.py'`.
- Per ogni ticket esegui solo i test ETL pertinenti ai producer, contratti o dati
  modificati; se il ticket non tocca ETL, riporta `NOT RUN`. La suite completa
  `npm run test:etl` richiede una richiesta esplicita di Lorenzo.
- Per ogni modifica UI verifica il flusso cambiato con Playwright CLI su mobile
  e desktop, inclusi tastiera, overflow ed errori console; riporta gli esiti.
- `npm run typecheck` genera i tipi Next anche senza `next dev`; leggi le guide
  installate nel blocco Next.
- Durante lo sviluppo esegui i test mirati del dominio modificato, come in
  [Feedback rapido](CONTRIBUTING.md#feedback-rapido); allarga la selezione ai
  contratti correlati prima di concludere la modifica.
- Prima di aprire una PR esegui gli altri gate del profilo completo:
  `npm run ci:static`, `npm run ci:action-pins`, `npm test`,
  `npm run test:snapshots`, `npm run build`,
  `NEXT_PORT=PORTA_LIBERA npm run test:production`, `git diff --check`.
  `npm run test:etl` richiede una richiesta esplicita di Lorenzo; altrimenti
  esegui i soli ETL mirati e segnala la suite completa come `NOT RUN`.
  Per ETL e snapshot attiva il network guard (CONTRIBUTING).
- Il runner di produzione possiede e termina il proprio server anche in errore.
  Log: `artifacts/production/next.log`; browser e screenshot: `artifacts/browser/`;
  Lighthouse: `.lighthouseci/`.
- Socket e Chromium richiedono loopback. `listen EPERM` è un limite d'ambiente,
  non una regressione; il build scarica Geist da Google Fonts. Distingui rete da
  contratti; non disattivare i gate per un verde.
- `npm run bench:runtime` misura gli hot path offline. Confronta revisioni sullo
  stesso runtime e a macchina libera, conservando i digest.
- Raggruppa le correzioni validate prima del push per evitare build duplicate.
  La consegna indica PR, SHA verificato, gate `PASS`/`FAIL`/`NOT RUN` e limiti
  residui. Merge e deploy seguono l'autorizzazione dell'utente; una CI verde
  non dimostra che la revisione sia online.
- Per deployment falliti o costi Vercel leggi
  [Diagnosi dei deployment](docs/CAPACITY_AND_INCIDENTS.md#diagnosi-dei-deployment).

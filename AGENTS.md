<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lavorare in questo repository

- Leggi `docs/ARCHITECTURE.md` per i percorsi reali del dato e `CONTRIBUTING.md`
  per setup e comandi. Non servono database, Docker o credenziali per avviare il sito.
- Pagine/API: `src/app/`; UI condivisa: `src/components/`; adapter e aggregazioni:
  `src/lib/`; contratti: `src/lib/data/`; acquisizione: `scripts/etl/`.
- Mantieni validazione e provenance al confine degli snapshot. Il corpus
  integrato pubblico passa da `integrated-public-view.ts`; non importare righe
  raw nei Client Component. Non confondere zero, dato mancante e cella oscurata.
- Parti da `git status --short --branch`. Per lavoro isolato usa un worktree
  con `node_modules`, `.venv`, `.next` e porta propri. Non copiare `.env` o
  condividere la directory `.next` tra checkout.
- Test Node mirato: `node --experimental-strip-types --test tests/NOME.test.mjs`.
  Per un singolo caso aggiungi `--test-name-pattern='testo'` prima del file.
- Test ETL mirato, con virtualenv attivo:
  `DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_NOME.py'`.
- `npm run typecheck` genera prima i tipi Next: funziona anche senza aver
  avviato `next dev`. Leggi le guide della versione installata indicate sopra.
- Prima della consegna: `npm run ci:static`, `npm run ci:action-pins`,
  `npm test`, `npm run test:etl`, `npm run test:snapshots`, `npm run build`,
  `NEXT_PORT=PORTA_LIBERA npm run test:production`, `git diff --check`.
  Per ETL e snapshot attiva il network guard come descritto in CONTRIBUTING.
- Il runner di produzione possiede il proprio server e lo termina anche in caso
  di errore. Log: `artifacts/production/next.log`; errori browser e screenshot:
  `artifacts/browser/`; misure Lighthouse: `.lighthouseci/`.
- I test con socket e Chromium richiedono loopback disponibile. Un errore
  `listen EPERM` è un limite dell'ambiente, non prova di regressione.
  Il build scarica Geist da Google Fonts. Distingui problemi di rete da errori
  di contratto; non disattivare i controlli per ottenere un esito verde.
- `npm run bench:runtime` misura gli hot path offline. Confronta revisioni sullo
  stesso runtime e a macchina libera; conserva anche i digest dei risultati.

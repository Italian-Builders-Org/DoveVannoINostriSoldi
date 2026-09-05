# Paper e ricerca

Archivio pubblico: `/paper`. Pubblicazione occasionale, distinta dai report mensili.
La v1 apre l'archivio senza pubblicare il primo studio ancora in lavorazione.

## Confine editoriale

- `src/content/papers/drafts`: appunti editoriali, mai importati dal sito.
- `src/content/papers/published/index.ts`: solo schede approvate.
- `src/lib/papers-contract.ts`: valida data, autori, versione, limiti, URL HTTPS
  pubblici, hash SHA-256 del PDF e link ai materiali riproducibili.
- `papers.listPublished()`: catalogo ordinato, isolato dalle mutazioni esterne.
- Navigazione, ricerca globale, sitemap e discovery LLM espongono l'archivio;
  la ricerca indicizza solo schede del registry pubblicato.

Le schede pubblicate hanno un'ancora stabile `/paper#slug`, un abstract HTML,
limiti espliciti e link al PDF e ai materiali riproducibili. Il PDF non è l'unica
spiegazione accessibile. La pubblicazione del primo studio richiede una PR
editoriale separata; questo cambiamento non attesta risultati o peer review.

## Primo studio e versioni

Il candidato è *Dai fondi ai posti*, relativo agli asili nido PNRR. Ricerca,
analisi e PDF restano nella branch `codex/paper-dati-spesa`; non copiarli da una
worktree attiva. Alla revisione finale fissare commit, autori e artefatti,
controllare che hash e URL coincidano con il PDF approvato e rendere disponibili
codice, dati consentiti e istruzioni di riproduzione.

Per una revisione successiva usare un PDF con URL versionata distinta,
conservare le versioni precedenti e documentare le correzioni nei materiali
pubblici. Non sostituire silenziosamente il PDF a parità di versione.

## Verifica

`node --experimental-strip-types --test tests/papers.test.mjs`

`npm run test:browser:papers` controlla archivio, stato vuoto, canonical,
navigazione attiva, tastiera e viewport 390/768/1280 px. Fa parte del runner
produzione, che deve essere eseguito dalla worktree di questa branch.

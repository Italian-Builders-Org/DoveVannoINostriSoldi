# ADR-003 — Snapshot storico Conto Annuale in Git

- **Stato:** proposto; accettazione subordinata ai gate della PR collegata alla issue #257
- **Data:** 7 settembre 2026
- **Ambito:** le due distribuzioni Conto Annuale 2020 della issue #257

## Misure

L'ADR-001 richiede una rivalutazione oltre 250 MiB nelle radici generate. La
base `9a616572997f8cfa1794a883153cfa3dbbe30939` le supera già: 358.071.265 byte
(341,48 MiB), misurati con `git ls-tree -rl` su `src/data/generated` e
`data/source-ledger`.

Il Conto Annuale aggiunge 347 chunk JSONL gzip per 28.924.630 byte (27,58 MiB).
Il chunk decompresso più grande misura 1.324.258 byte, sotto il limite runtime
di 2 MiB. I CSV originali, dizionari e metadati sono conservati come fixture
gzip, complessivamente circa 3,2 MiB, esclusi dal percorso runtime. Nessun file
nuovo si avvicina a 25 MiB; il costo della nuova storia Git resta visibile
nella PR. Il caricamento delle righe usa i budget esistenti di paginazione.

## Decisione limitata a questa integrazione

Conservare snapshot e piccoli input compressi in Git mantiene dati e codice
nello stesso commit e consente verifiche offline, rollback e disponibilità
anche quando il portale ufficiale non risponde. La duplicazione di circa
3,2 MiB delle fixture è intenzionale: prova ogni riga pubblicata contro i byte
ufficiali e la licenza, anziché verificare soltanto hash generati dal prodotto.

Non viene introdotto un servizio di storage o una dipendenza di rete in build
o runtime. Object storage resta l'alternativa per futuri raw voluminosi,
secondo il contratto dell'ADR-001; spostare questi due input richiederebbe
manifest immutabili, verifica, cache, backup e gestione dell'indisponibilità
per risparmiare pochi MiB di fixture. LFS e Releases mantengono i limiti già
valutati nell'ADR-001.

Questa decisione non autorizza refresh multipli o nuove annualità senza una
nuova misura. Prima del merge la PR registra build, tempi CI e dimensioni del
tracciamento delle funzioni interessate; un superamento dei limiti di deploy
blocca l'integrazione. La verifica locale non certifica un deployment remoto.

Limite prudenziale di confronto: 250 MB per le funzioni Node.js, come da
[documentazione Vercel](https://vercel.com/docs/functions/limitations),
controllata il 7 settembre 2026. Il supporto fino a 5 GB richiede requisiti e
abilitazione specifici; non viene assunto attivo né modificato da questa PR.

## Budget delle verifiche

Il gate ETL verde della base ha richiesto 19 minuti e 38 secondi
([run 34151719132](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/actions/runs/34151719132)).
Le 346.112 righe aggiunte aumentano del 23,5% le righe pubbliche e vengono
riconciliate anche contro i CSV originali. Il timeout del job passa da 20 a
30 minuti; suite, controlli snapshot e network guard restano tutti attivi.
Il tempo finale della nuova CI va registrato prima di accettare questa ADR.

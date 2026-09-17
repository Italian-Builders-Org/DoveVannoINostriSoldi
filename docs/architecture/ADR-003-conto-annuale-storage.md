# ADR-003 — Snapshot storico Conto Annuale in Git

- **Stato:** decisione per la PR #333; efficace al merge dopo i gate obbligatori
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

Le radici generate finali misurano 387.055.666 byte (369,13 MiB). La build
locale dell'applicazione `34b3d34df945e3883c7ca70f316765828a1cb640` passa.
Sommando i file unici risolti da ciascun `.nft.json` e il relativo entry point:

| Percorso | Byte tracciati | MiB |
| --- | ---: | ---: |
| `/enti/[codice]` | 463.155.751 | 441,70 |
| `/api/enti/[codice]` | 454.282.530 | 433,24 |
| `/enti/[codice]/appalti` | 432.453.877 | 412,42 |
| `/api/assistant/chat` | 290.720.059 | 277,25 |
| `/api/mcp` | 273.720.599 | 261,04 |
| `/dati/[dataset]` | 230.770.928 | 220,08 |

Nessun file manca nei 33 tracciamenti che includono i nuovi dati. Il dettaglio
è in [function-sizes.json](../pr-evidence/issue-257/function-sizes.json).
Queste sono misure del tracciamento Next locale, non delle funzioni assemblate
dal provider; non attribuiscono l'intera dimensione al Conto Annuale.

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
nuova misura. Il merge richiede tutti i gate verdi e una preview Vercel riuscita
sullo stesso HEAD; un rifiuto del provider per dimensione blocca l'integrazione.

Limite prudenziale di confronto: 250 MB per le funzioni Node.js, come da
[documentazione Vercel](https://vercel.com/docs/functions/limitations),
controllata il 7 settembre 2026. Il supporto fino a 5 GB richiede requisiti e
abilitazione specifici; non viene assunto attivo né modificato da questa PR.
Diversi tracciamenti locali superano il limite standard di confronto. Vercel
ha però accettato la [preview di `07a25b1f`](https://vercel.com/doms-projects-579ef5cf/dove-vanno-i-nostri-soldi/CdLNPpi1cisYwaSmfktB6jMcX5c6),
con gli stessi snapshot e il sigillo finale: prova concreta di accettazione
di quella build, senza dedurre il piano o le impostazioni del progetto.
La richiesta HTTP alla preview incontra l'autenticazione: questo controllo
non certifica il comportamento dell'API remota. Le verifiche funzionali sono
eseguite sulla build di produzione locale; lo stato dell'HEAD finale resta
nei check della PR.

## Budget delle verifiche

Il gate ETL verde della base ha richiesto 19 minuti e 38 secondi
([run 34151719132](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/actions/runs/34151719132)).
Le 346.112 righe aggiunte aumentano del 23,5% le righe pubbliche e vengono
riconciliate anche contro i CSV originali. Il timeout del job passa da 20 a
30 minuti; suite, controlli snapshot e network guard restano tutti attivi.
Il gate ETL con entrambi i nuovi snapshot passa in 18 minuti e 55 secondi
nel [run 34168268127](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/actions/runs/34168268127)
su `07a25b1f`; il margine evita che normali variazioni del runner superino
i precedenti 20 minuti. Il tempo finale della nuova CI viene registrato nella PR insieme al run,
senza richiedere un nuovo commit documentale che invalidi quel run.

# Procedimenti giudiziari dei parlamentari della XIX legislatura

Dataset `parlamento-giudiziario-xix`: procedimenti penali e della Corte dei conti
riferiti ai 626 deputati e senatori che hanno fatto parte della XIX legislatura,
compresi i cessati. Alimenta il blocco "Procedimenti giudiziari documentati"
nella scheda personale di `/politici` e la route `/api/politici/giudiziario`.

## Perimetro

| Voce | Valore |
| --- | --- |
| Periodo di riferimento | XIX legislatura, dal 13 ottobre 2022 |
| Parlamentari esaminati | 626 (414 Camera, 212 Senato, inclusi cessati e subentrati) |
| Titolare | raccolta curata DoveVannoINostriSoldi (`authority: secondary`) |
| Licenza | `not-declared`: si pubblicano fatto, attribuzione e link, mai il testo degli articoli |
| Aggiornamento | manuale, a ogni sviluppo processuale documentato |
| Chiavi di join | `d<numero>_19` (Camera) e `s<id>` (Senato), gli stessi id di `politici-camera-xix` e `politici-senato-xix` |

## Che cosa il dato NON misura

1. Non misura la colpevolezza. Una condanna non definitiva non e passata in
   giudicato: fino alla condanna definitiva l'imputato non e considerato
   colpevole (art. 27 della Costituzione).
2. Non misura tutti i procedimenti. In Italia il casellario giudiziale non e
   pubblico e gran parte delle sentenze di merito non viene pubblicata.
3. L'assenza di casi per un parlamentare non e un attestato: significa che la
   ricerca documentata non ne ha trovati. Per questo la scheda di chi non ha casi
   non mostra alcun blocco, invece di dichiarare "nessuna condanna".
4. Non misura la gravita. Le pene di gradi diversi dello stesso processo non si
   sommano e mesi di reclusione e danno erariale restano due scale separate.
5. Prescrizioni e assoluzioni non sono condanne: sono conteggiate a parte.

## Regole di evidenza

- Ogni caso richiede **un atto pubblicato dell'autorita competente** (sentenza,
  atto di Camera o Senato) **oppure almeno due editori indipendenti**. Due testate
  dello stesso gruppo editoriale contano come una sola fonte: i gruppi sono
  dichiarati in `rules.publisherGroups` nello spec, e una copia archiviata
  mantiene l'identita dell'editore archiviato.
- L'etichetta probatoria `official-finding` e ammessa **solo** per una condanna
  definitiva sostenuta da un atto pubblicato. Tutto il resto e
  `needs-explanation`.
- Una condanna non definitiva il cui ultimo sviluppo documentato e anteriore a
  sette anni entra nel bucket `esito_ignoto` ed esce dai conteggi: nessuna fonte
  dice come sia finito l'appello.
- Gli importi sono in **centesimi di euro interi**; un importo assente resta
  assente e non diventa zero.
- Le pene espresse in anni e giorni diventano mesi decimali (un anno e quindici
  giorni = 12,5 mesi): i totali in mesi sono arrotondati, non esatti al giorno.

## Verifica della ricerca

Ogni parlamentare e stato cercato e ogni caso candidato e stato riverificato da
zero da un verificatore indipendente, con controllo di omonimia e dello stato piu
recente del procedimento. La copertura e un campo pubblicato:
`coverage.membersSearched`, `coverage.membersSearchedWithQueryLog` (ricerche con
le query registrate una per una) e `coverage.membersNotSearched`.

Quattro persone con casi documentati non compaiono nel roster di `/politici`,
che contiene solo mandati aperti: sono elencate in
`coverage.membersNotInPoliticiRoster` e per loro il blocco non ha una scheda dove
apparire.

## Artefatti e comandi

| File | Ruolo |
| --- | --- |
| `data/parlamento-giudiziario/casi-verificati.json` | input verificato, bloccato per byte e sha256 nello spec |
| `scripts/etl/specs/parlamento-giudiziario-xix.source.json` | source lock, enumerazioni ammesse e regole |
| `scripts/etl/parlamento_giudiziario_xix_snapshot.py` | proiezione e gate fail-closed |
| `src/data/generated/parlamento-giudiziario-xix.json` | snapshot pubblicato |
| `src/lib/data/parlamento-giudiziario-contract.ts` | contratto zod `.strict()` |
| `src/lib/parlamento-giudiziario.ts` | modulo di dominio condiviso da pagina e route |

```bash
python3 scripts/etl/parlamento_giudiziario_xix_snapshot.py --check   # offline, non tocca il worktree
python3 scripts/etl/parlamento_giudiziario_xix_snapshot.py --write   # riproietta dall'input verificato
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_parlamento_giudiziario_xix_snapshot.py'
node --experimental-strip-types --test tests/parlamento-giudiziario-*.test.mjs
```

Entrambe le azioni sono offline: l'acquisizione e la ricerca documentata a monte,
non un download. Il controllo offline dimostra la coerenza interna e il rispetto
delle regole di evidenza, non la veridicita delle sentenze citate.

## Superfici pubbliche

- `/politici`: blocco "Procedimenti giudiziari documentati" nella scheda
  personale, con stato del procedimento, gradi di giudizio, pena dell'ultima
  sentenza, eventuale danno erariale e fonti in chiaro; marcatore sul nodo del
  grafo per le persone con almeno un procedimento.
- `/api/politici/giudiziario`: casi raggruppati per id del grafo, con copertura e
  caveat.

Il marcatore sul nodo dichiara **presenza**, non gravita: nessuna scala di
intensita per anni di pena o importi, perche sommerebbe misure incompatibili e
farebbe leggere l'assenza di dati come innocenza.

Nessun dataset MCP: l'assistente rifiuta per progetto le domande su reati e
responsabilita individuale (`docs/ASSISTENTE.md`), quindi esporre queste righe
all'assistente richiede prima una decisione esplicita dei maintainer.

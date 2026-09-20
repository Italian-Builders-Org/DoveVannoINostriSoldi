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

## Policy (da approvare dai maintainer)

Questa sezione mette per iscritto le decisioni che la issue #555 lasciava aperte.
Finche non sono approvate, il perimetro pubblicato e una proposta del contributor,
non una scelta del progetto: e il motivo per cui va chiusa.

### 1. Pubblicazione nominativa

I dati riguardano persone che esercitano una funzione pubblica elettiva, per fatti
gia pubblici. La pubblicazione nominativa e ammessa perche l'aggregazione non
raggiunge lo scopo civico: un conteggio per gruppo non consente di verificare il
singolo procedimento sulle fonti. Stato privacy proposto per
`scripts/etl/specs/source-corpus-policy.json`: **`named-public-office-judicial`**,
distinto da `named-professional-role` perche impone due obblighi in piu, il
tracciamento dello stato del procedimento e la decadenza del dato non riverificato.

### 2. Soglia di evidenza

Resta quella gia implementata: un atto pubblicato dell'autorita competente oppure
almeno due editori indipendenti. Al momento della scrittura 5 casi su 75 hanno un
atto pubblicato e 70 reggono su stampa concordante. Se il progetto preferisce la
soglia stretta, il perimetro scende a 5 casi su 5 persone e la riduzione va fatta
con una PR dedicata, non silenziosamente.

### 3. Etichette probatorie

`accertamento-ufficiale` solo per condanna definitiva sostenuta da un atto
pubblicato; `richiede-spiegazione` per tutto il resto. Prescrizioni e assoluzioni
non sono condanne e non compaiono nella lista delle condanne.

### 4. Titolarita e responsabilita editoriale

Il titolare del trattamento e l'editore del contenuto pubblicato e il progetto.
Il maintainer responsabile del dataset va indicato qui sotto, come previsto da
`GOVERNANCE.md` per le fonti nuove:

- maintainer responsabile: **da indicare**

### 5. Manutenzione e decadenza del dato

Il rischio maggiore non e pubblicare, e lasciare il dato fermo. Percio:

- ogni caso porta **due date distinte**, ed e la distinzione che regge tutto il
  resto: `statusAsOf` e la data dell'**ultimo atto documentato**, `verifiedAt` e la
  data dell'**ultimo controllo nostro**. La pagina le mostra entrambe ("stato al
  ... verificato il ..."). Il gate rifiuta una `statusAsOf` che non coincida con la
  data dell'ultimo grado di giudizio registrato: se si lascia scivolare in avanti
  quella data, per esempio prendendola dall'articolo che racconta la sentenza, un
  procedimento fermo da anni si presenta come recente;
- un procedimento **non definitivo** non riverificato entro
  `coverage.recheckAfterMonths` mesi (oggi 12) viene marcato `da-riverificare`:
  mantiene il suo ultimo stato noto, ma la pagina dichiara che nessuno lo controlla
  da oltre un anno. La finestra si misura su `verifiedAt`, non su `statusAsOf`: un
  processo puo restare fermo per anni senza che il dato sia inaffidabile, mentre e
  il nostro silenzio a renderlo tale;
- un procedimento non definitivo fermo da oltre sette anni esce dai conteggi
  (`esito_ignoto`);
- il workflow `parlamento-giudiziario-recheck.yml` gira ogni mese, ricontrolla lo
  snapshot offline e **fallisce** se un caso supera il doppio della finestra senza
  riverifica. Un controllo rosso e il segnale che il dato va aggiornato o ritirato.

Il contributor che ha portato il dataset non garantisce una manutenzione
continuativa: la riverifica periodica e un impegno del progetto, e il workflow
serve a renderlo visibile invece che implicito.

### 6. Rettifiche

Le segnalazioni arrivano dal canale privato indicato in `/privacy`
(`info@mantoventure.com`), non dalle issue pubbliche: una richiesta di rettifica su
un dato giudiziario non va aperta in chiaro su GitHub. Una rettifica documentata va
applicata e versionata: dal momento della segnalazione, continuare
a pubblicare un dato superato non e piu un errore scusabile. Il campo `correction`
del caso resta pubblicato accanto al dato corretto, cosi la pagina dice anche che
cosa diceva prima.

**Come e andata la prima volta.** La riverifica del 20/09/2026 ha trovato un caso
sbagliato fra i nostri, `case-009`. Era pubblicato come condanna non definitiva del
2017 con `statusAsOf` al 28/09/2022, che pero era la data di un articolo, non di un
atto. In calce al proprio pezzo del 2017 Il Sole 24 Ore pubblica una nota di
aggiornamento del 28/05/2025: il 20/06/2020 la Corte d'appello di Roma, riformando
il primo grado, ha emesso sentenza di non doversi procedere per prescrizione. Il
caso e stato riclassificato come `prescrizione`, il parlamentare e uscito dal
conteggio dei condannati (da 24 a 23) e la rettifica e visibile nella scheda.

Quella nota e una fonte sola, mentre la regola ne chiede due. Vale comunque, e la
regola va letta cosi: **le due fonti servono ad affermare un addebito, non a
mantenerlo.** Una fonte credibile che scagiona basta a togliere; per rimettere un
addebito servirebbero di nuovo due fonti o l'atto.

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

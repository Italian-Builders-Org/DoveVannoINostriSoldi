# Confronti descrittivi degli appalti tra Comuni

Slice dell’issue #185. La pagina `/enti/[codice]/appalti/confronti` confronta
Top 1, Top 10 e HHI con altri Comuni. L’issue resta aperta per le successive
slice: questi indicatori non dimostrano integrità, illecito o causalità.

## Perimetro e provenienza

Nessuna nuova acquisizione. L’indice derivato usa gli stessi profili ANAC e
la stessa classificazione CPV del filtro appalti: CIG pubblicati in tutti i
mesi del 2025, collegati a snapshot cross-temporali di aggiudicazioni e IPA.
Non è una copertura nazionale corrente e gli importi non sono pagamenti.
Le formule e i denominatori restano quelli del profilo originale.

L’identità comunale è un join esatto fra codice fiscale dell’ente ANAC e
ISTAT SITUAS al 31/12/2025 (`istat-municipality-geography.json`). La popolazione
è del **2024**, non del 2025. Popolazione assente o di altro anno non viene
imputata. Profili multipli dello stesso Comune sono tutti esclusi; il nome
non è una chiave. Nessun codice fiscale di aggiudicatario viene aggiunto.

La specifica `scripts/etl/specs/anac-procurement-peers.source.json` blocca gli
hash dei metadati ANAC/CPV, della specifica CPV e dello snapshot geografico.
La derivazione verifica integralmente gli shard e le righe CPV, i profili
municipali e la provenienza geografica. I rispettivi contratti rimangono
responsabili degli snapshot di origine. Fonti: [ANAC CIG 2025](https://dati.anticorruzione.it/opendata/dataset/cig-2025)
(CC BY-SA 4.0) e [ISTAT SITUAS](https://situas.istat.it/) (condizioni conservate
nello snapshot geografico; nessuna nuova licenza attribuita a ISTAT).

## Selezione del gruppo

Le soglie sono scelte editoriali esplicite di questa versione, **non standard
ANAC/ISTAT né un metodo validato per individuare illeciti**. Sono fisse e non
vengono allentate quando un Comune ha pochi pari.

Un Comune può partecipare al confronto per numero se dispone di popolazione
2024, almeno 30 aggiudicazioni e concentrazione calcolabile, almeno 90% delle
procedure con CPV interpretabile e almeno 90% delle aggiudicazioni con
aggiudicatari identificati. Le quote per numero pesano le relazioni
operatore–aggiudicazione; i multipartiti possono avere più relazioni.

Il confronto per valore richiede anche almeno 30 aggiudicazioni con importo
positivo attribuibile a un solo operatore, almeno 90% delle aggiudicazioni in
questa condizione e almeno 90% del valore positivo dichiarato attribuibile.
Gli importi mancanti, invalidi, in conflitto, nulli, negativi o multipartiti
non diventano importi attribuibili. Le due basi possono avere gruppi diversi.

Tra gli enti ammissibili, il gruppo di un Comune contiene gli altri Comuni con:

- popolazione da metà al doppio;
- numero di procedure da metà al doppio;
- sovrapposizione della composizione CPV di almeno 80%.

La sovrapposizione è `sum_k min(n_ak / N_a, n_bk / N_b)`, con `k` pari alle
prime due cifre dei CPV dal formato interpretabile, `n_ak` procedure di quella
categoria e `N_a` **tutte** le procedure del Comune. I codici mancanti restano
nel denominatore e non creano una categoria comune. Non si inferisce il CPV
dall’oggetto e il formato non certifica la nomenclatura.

Il valore totale non seleziona i pari: non si condiziona il gruppo anche a un
risultato economico da descrivere. La composizione è per numero di procedure,
non per importo; non controlla forma di affidamento, durata, funzioni svolte,
struttura degli operatori o altri fattori. Il confronto non isola l’effetto
delle scelte di un’amministrazione.

## Statistiche e navigazione

Servono **almeno dieci altri Comuni**, escludendo sempre il selezionato.
Sotto soglia i candidati restano consultabili ma mediana e percentile sono
assenti, non zero. Il percentile è `(inferiori + 0.5 * pari) / numero_pari`.
Una parità completa restituisce 50%. La mediana di un gruppo pari è la media
esatta dei due valori centrali. Ordinamenti, somme e confronti usano frazioni
intere esatte; la formattazione riusa gli indicatori ANAC esistenti.

Top 1, Top 10 e HHI del Comune e dei pari collegano ai rispettivi drill-down
esistenti, senza filtro CPV. Il link al confronto appare solo nel profilo
non filtrato. Parametri CPV sulla nuova pagina vengono rifiutati, evitando
un allargamento silenzioso del perimetro. La lista è paginata a 25 Comuni e
ordinata stabilmente per codice IPA; i riassunti usano l’intero gruppo.

Nello snapshot iniziale: 7.850 Comuni univoci su 23.737 profili ANAC, nessuna
identità municipale duplicata. 3.418 superano i requisiti per numero e 2.793
quelli per valore. Solo **Veroli (`c_l780`)** raggiunge dieci altri Comuni per
numero; Rodengo Saiano ne ha nove. Veroli non supera la copertura per valore.
Questa copertura limitata è un risultato della selezione, non una graduatoria
nazionale. Ogni estensione richiede nuovi dati o una revisione metodologica
esplicita; non basta ridurre una soglia per ottenere più risultati.

## Architettura e verifiche

Il piccolo indice materializza solo gli input del confronto e le tre misure
esatte, evitando di leggere 256 shard per richiesta. Non è un nuovo dataset
grezzo del corpus integrato: non duplica CIG, operatori o righe finanziarie.
`src/lib/data/anac-procurement-peers.ts` valida l’artefatto e seleziona i gruppi;
la pagina Server Component si limita alla presentazione. Non legge file raw
nei Client Component né interroga fonti live.

Il loader rifiuta file oltre budget, link simbolici, hash divergenti, snapshot
parent diversi, identità duplicate e coperture incoerenti. Non conserva una
risposta riuscita dopo modifiche ai file. La configurazione del tracing Next elenca
esplicitamente l’indice e i parent richiesti dalla nuova route.

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/anac_procurement_peers.py
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/anac_procurement_peers.py --check
node --experimental-strip-types --test tests/anac-procurement-peers.test.mjs
DVNS_BASE_URL=http://127.0.0.1:3000 npm run test:browser:procurement-peers
```

La verifica offline rigenera tutto il contenuto dai parent bloccati. I test
Node confrontano tutte le misure di Veroli e dei suoi dieci pari con i profili
originali, oltre a soglie, CPV mancanti, parità, precisione, minimi e corruzione.
I test browser coprono pubblicazione, sospensione per copertura/campione,
link ai contratti e desktop/tablet/mobile; sono parte del gate di produzione.

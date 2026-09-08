# Paginazione degli operatori ANAC

L'elenco `/appalti/operatori?vista=elenco` legge blocchi già ordinati di 1.000
operatori invece di decomprimere e ordinare 478.418 righe a ogni avvio del
processo. La scheda individuale conserva il dettaglio delle aggiudicazioni;
l'elenco e la ricerca mostrano nome, conteggio, valore attribuibile e anni.
La cache del lettore è limitata a 8 blocchi e 100 schede richieste.

## Derivazione e verifica

`src/data/generated/anac-operator-browse/` contiene due concatenazioni di blocchi
gzip (conteggio e valore) e un manifest di offset, dimensioni, righe e SHA-256.
Il manifest lega entrambi gli ordinamenti all'hash dell'indice pubblico di
ricerca e della sua source spec. Non aggiunge fonti né modifica importi,
identificativi o copertura. Ogni artefatto compresso è circa 15 MiB: la
ridondanza di circa 30 MiB evita ordinamenti e caricamenti nazionali nel runtime.
È un derivato pubblico normalizzato, coerente con ADR 001; nessun file raw
viene aggiunto al repository.

Dopo la rigenerazione dell'indice sorgente, eseguire con il runtime `.nvmrc`
e le dipendenze installate tramite `npm ci` (come nel job ETL di CI):

```sh
node --experimental-strip-types scripts/etl/anac-operator-browse.mjs
node --experimental-strip-types scripts/etl/anac-operator-browse.mjs --check
```

Il secondo comando ricostruisce entrambi gli ordinamenti e confronta tutti i
byte degli artefatti. È registrato in `test:snapshots`. La verifica offline
completa dell'indice sorgente rimane invariata. Nel runtime, metadati e source
spec vengono validati all'apertura; search, riepiloghi, shard e blocchi vengono
verificati sui byte effettivamente consumati prima di pubblicarne i dati.
Un errore in uno shard non richiesto viene quindi rilevato dal controllo offline
o dalla sua prima lettura, non dall'apertura della pagina riassuntiva.

La configurazione Next dichiara gli artefatti necessari e l'esclusione degli
shard delle schede dalla funzione dell'elenco. Nel trace locale di Next 16.3.3
i moduli condivisi includono ancora questi shard: il pacchetto osservato è
circa 239 MiB, contro circa 685 MiB prima della correzione del lettore.
Questa esclusione non viene quindi considerata una prova di riduzione ulteriore. Le letture con
file descriptor mantengono i controlli su dimensione e stabilità, senza far
tracciare l'intero repository.

## Verifica delle prestazioni

```sh
node --experimental-strip-types scripts/bench/operator-pages.mjs
node --experimental-strip-types --test tests/anac-operator-read-budget.test.mjs tests/anac-operator-integrity.test.mjs
```

Il benchmark riporta tempi, byte letti, memoria residente e digest. Confrontare
revisioni sullo stesso runtime e a macchina libera; i tempi non sono un gate
universale. Il test di regressione impone invece una proprietà deterministica:
metadati, riepiloghi e pagine iniziali, profonde e finali nei due ordinamenti
leggono meno di 2 MiB, senza scandire il corpus nazionale.

`scripts/browser/operatori.mjs`, eseguito dai gate di produzione, verifica a
390/768/1280px ordinamenti, navigazione, pagine profonde/finali, ricerca vuota
e apertura della scheda con i CIG. I miglioramenti di questo lettore riguardano
le pagine operatori e i suoi consumatori; non attestano tempi di tutte le
pagine del sito o del deployment pubblico.

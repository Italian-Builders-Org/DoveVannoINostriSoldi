# ADR-001 — Dove conservare gli artefatti dati

- **Stato:** accettato
- **Data:** 29 agosto 2026
- **Ambito:** snapshot normalizzati, sidecar, manifest e input raw voluminosi
- **Decisione:** Git per gli snapshot usati dal prodotto; object storage solo per raw e indici che superano i limiti definiti qui

## Contesto

Il sito usa snapshot verificati durante build e runtime. Il registro
`scripts/ci/generated-artifacts.json` assegna a ogni gruppo un proprietario,
una modalità di verifica, i file attesi e i test di riconciliazione. I refresh
automatici pubblicabili passano inoltre da una pull request gestita dal data
bot, con SHA della base e digest complessivo dei file.

Al 29 agosto 2026, su `main` (`55e8f61`):

- il registro contiene 27 gruppi e 48 percorsi dichiarati;
- i percorsi dichiarati coprono 509 file fisici per 137.417.106 byte
  (131,05 MiB);
- le due radici generate contengono 510 file per 137.432.973 byte
  (131,07 MiB); l'unico file escluso dal registro è la tabella TypeScript
  statica dichiarata nelle esclusioni;
- il file più grande è
  `src/data/generated/investigative-explorer-incarichi.json`: 35.948.901 byte
  (34,28 MiB);
- alla prima introduzione del registro (`dfb73d0`, 25 agosto 2026), le stesse
  radici occupavano 88.585.252 byte (84,48 MiB);
- la storia raggiungibile da `main` contiene 590 blob distinti in quelle
  radici, per 192.526.243 byte non compressi (183,61 MiB). Questa misura non è
  la dimensione di un clone, ma rende visibile il costo delle vecchie versioni.

La crescita osservata è quindi di 46,58 MiB in quattro giorni, ma deriva in
gran parte da una singola integrazione dell'Explorer. È una misura iniziale,
non un tasso mensile affidabile.

GitHub oggi avvisa per un singolo file oltre 50 MiB e blocca i file oltre
100 MiB. Il progetto è ancora sotto il primo limite, ma deve decidere prima di
raggiungerlo, non dopo.

## Decisione

Questo ADR non sposta file, non sceglie un provider e non modifica build o
runtime. Fissa il confine attuale e le condizioni per una futura decisione.

### 1. Snapshot del prodotto in Git

Restano in Git:

- snapshot normalizzati necessari a build, API, MCP e pagine;
- sidecar, manifest, source lock e definizioni di schema;
- hash, dimensioni, periodo, fonte, licenza e caveat;
- artefatti piccoli necessari a verifiche completamente offline.

Questo mantiene codice e dato nello stesso commit. Una pull request mostra
quale versione entra nel prodotto; un revert ripristina insieme codice,
contratti e snapshot. La build non dipende dalla disponibilità di un servizio
esterno per recuperare i dati già pubblicati.

Il commit Git e i check della pull request costituiscono la ricevuta minima.
Per i refresh gestiti dal data bot si aggiungono digest SHA-256 e trailer del
commit che legano in modo verificabile base, contenuto e revisione. Non sono
una firma esterna indipendente e operano dentro il confine di fiducia di Git e
GitHub protetto.

### 2. Nessun Git LFS per ora

Git LFS sostituisce il contenuto nel repository con un puntatore e richiede il
download dell'oggetto separato. Chi non ha LFS installato riceve solo il
puntatore; inoltre GitHub non mostra sempre il contenuto LFS nella review.

Non risolve il requisito principale del progetto: avere dati verificabili e
disponibili durante build e test offline. Aggiungerebbe invece una nuova
dipendenza, quote di storage/banda e un percorso diverso per collaboratori,
fork e CI.

### 3. GitHub Releases non è il backend del prodotto

Le Releases sono adatte a distribuire pacchetti collegati a un tag. Possono
essere rese immutabili tramite un'impostazione esplicita del repository, ma una
build dovrebbe comunque scaricare l'asset, associare tag, manifest e hash e
gestire indisponibilità o cancellazioni quando l'immutabilità non è abilitata.

Possono essere usate in futuro per esportazioni scaricabili dagli utenti, non
come origine runtime o build degli snapshot applicativi.

### 4. Object storage per raw e indici grandi

L'object storage è la destinazione prevista per:

- rilasci raw che non devono essere caricati in una richiesta Next.js;
- archivi sorgente grandi conservati per riproducibilità;
- indici persistenti che richiedono streaming o range request;
- oggetti che superano le soglie di rivalutazione qui sotto.

OpenCUP, con un rilascio nazionale superiore a 1,7 GB, è già un caso adatto:
il raw può vivere fuori da Git, mentre nel repository restano manifest,
trasformazione, ricevuta e snapshot di prodotto verificato.

## Contratto per un futuro object storage

Una migrazione non può limitarsi a spostare file. Deve garantire:

1. chiavi immutabili indirizzate dal contenuto, per esempio
   `sha256/<digest>`;
2. manifest versionato in Git con URI, byte, SHA-256, formato, schema, fonte,
   periodo, licenza e timestamp di osservazione;
3. verifica di dimensione e hash prima di ogni uso;
4. versioning del bucket e backup verificato in un dominio di guasto separato
   (account e regione diversi, oppure un provider diverso); blocco contro la
   riscrittura (Object Lock/WORM) quando il modello di rischio lo richiede;
5. cache lunga solo sugli URL hashati; nessuna cache immutabile su `latest`;
6. rollback tramite revert del manifest, senza riscrivere l'oggetto;
7. una ricevuta CI che leghi commit, manifest e digest scaricato;
8. conservazione di ogni oggetto ancora referenziato da `main`, da un deploy
   attivo o da un manifest nella finestra di rollback dichiarata;
9. test periodico di recupero con esito registrato, non soltanto presenza del
   backup.

Se lo storage non risponde:

- un refresh ETL fallisce e mantiene pubblicato l'ultimo snapshot valido;
- una build che richiede un oggetto preciso fallisce, salvo una cache locale
  già verificata con lo stesso hash;
- un deploy che contiene già l'artefatto continua a servire quella versione;
- un runtime che dipende dallo storage risponde con un errore esplicito, per
  esempio `503`, e non presenta dati di un'altra versione;
- non si usa silenziosamente `latest`, un hash differente o una versione meno
  recente.

Il runtime non deve scaricare raw voluminosi durante una richiesta utente.

## Quando riaprire questa decisione

L'ADR va rivalutato prima di un merge se si verifica almeno una condizione:

- un file nuovo o aggiornato supera 25 MiB senza una nota nella pull request
  che motivi formato, duplicazione, uso runtime e alternativa compressa;
- un file tracciato raggiunge 50 MiB;
- le radici generate superano complessivamente 250 MiB;
- le radici crescono di oltre 100 MiB in una finestra mobile di 90 giorni;
- nel job CI `etl`, la somma dei tempi wall-clock dei passaggi `Checkout` e
  `Validate committed generated artifacts (offline)` supera il 25% del tempo
  wall-clock totale per dieci esecuzioni completate consecutive;
- la dimensione del bundle o del deploy raggiunge l'80% del limite del provider
  in uso, con link alla documentazione e misura in byte riportati nella pull
  request;
- un input raw supera 500 MiB o richiede streaming, range request o retention
  indipendente dal ciclo dei deploy;
- il prodotto deve interrogare il raw completo invece di uno snapshot
  normalizzato e limitato.

Le soglie non autorizzano una migrazione automatica. Obbligano a misurare di
nuovo dimensioni, tempi, costi, disponibilità e rischio operativo, quindi ad
accettare un nuovo ADR.

## Conseguenze

### Vantaggi

- build, test e rollback restano riproducibili senza rete;
- il data bot e la review delle pull request restano il confine di
  pubblicazione;
- non introduciamo credenziali o costi operativi prima che servano;
- raw molto grandi hanno già una destinazione e un contratto chiari.

### Svantaggi

- clone e storia Git continuano a crescere quando cambiano snapshot grandi;
- i diff di JSON voluminosi restano poco leggibili;
- sarà necessario misurare regolarmente tree e tempi CI;
- superare una soglia richiederà una nuova decisione e una migrazione distinta.

## Alternative considerate

| Opzione | Versione e rollback | Build offline | Review | Costo operativo | Decisione |
| --- | --- | --- | --- | --- | --- |
| Git | stesso commit di codice e dati | sì | PR, hash e contratti | basso oggi; storia crescente | adottato per snapshot |
| Git LFS | commit con puntatore separato | solo con oggetto LFS disponibile | spesso solo puntatore | client, quote e banda | non adottato ora |
| GitHub Releases | tag e asset separati | no, salvo cache preparata | separata dalla PR dati | automazione e download | solo export futuri |
| Object storage immutabile | manifest e oggetto hashato | no per il primo download | richiede ricevuta dedicata | provider, credenziali, traffico e monitoraggio | previsto per raw grandi |

## Riferimenti

- [GitHub Docs — About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [GitHub Docs — About Git Large File Storage](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)
- [GitHub Docs — Collaboration with Git Large File Storage](https://docs.github.com/en/repositories/working-with-files/managing-large-files/collaboration-with-git-large-file-storage)
- [GitHub Docs — Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [`ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`DATA_SOURCES.md`](../DATA_SOURCES.md)
- [`source-corpus-integration.md`](source-corpus-integration.md)

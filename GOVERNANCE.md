# Governance

Questo documento spiega chi mantiene DoveVannoINostriSoldi e come vengono prese
le decisioni sul repository. L'obiettivo è proteggere correttezza, chiarezza e
continuità del progetto senza aggiungere burocrazia inutile.

Queste regole sono convenzioni operative applicate manualmente dai maintainer.
Le impostazioni GitHub attuali non le garantiscono tutte: eventuali protezioni
automatiche di `main` richiedono una modifica infrastrutturale separata.

## Maintainer

I maintainer attuali sono:

- [@dg996](https://github.com/dg996);
- [@metaforismo](https://github.com/metaforismo).

I maintainer possono revisionare e integrare contributi, gestire release,
workflow e incidenti, e decidere il perimetro del prodotto. L'elenco viene
aggiornato quando cambiano le responsabilità effettive nel repository.

Qui “maintainer” indica una responsabilità nel progetto, non implica che i due
account abbiano lo stesso livello tecnico di permessi GitHub.

Le responsabilità sono condivise. Per ogni lavoro sostanziale uno dei
maintainer si dichiara responsabile nella issue o nella PR, anche quando la
modifica è proposta da un altro maintainer o da un contributor.

## Aree di responsabilità

- **Prodotto e UI:** gerarchia delle pagine, testo, accessibilità, resa su
  mobile e desktop e coerenza con `DESIGN.md`.
- **Dati:** fonti ufficiali, licenze, periodi, trasformazioni, riconciliazioni e
  limiti dichiarati.
- **Infrastruttura e sicurezza:** CI, workflow con privilegi, deploy, header di
  sicurezza, dipendenze e superficie MCP/API.
- **Repository:** triage di issue e PR, documentazione, release e pulizia delle
  branch.

Queste aree non assegnano proprietà esclusiva a una persona. Servono a rendere
chiaro chi deve verificare un cambiamento prima del merge.

## Come prendiamo le decisioni

Per modifiche piccole e reversibili basta una PR focalizzata con prove
proporzionate. Per nuove fonti, nuove superfici pubbliche o cambiamenti ampi si
parte da una issue o da una draft PR che descriva problema, perimetro e rischi.

Le decisioni si basano su fonti, test e comportamento osservabile. Non usiamo
votazioni formali o comitati. Se ci sono opinioni diverse, i maintainer
documentano il punto controverso e cercano la soluzione più piccola e
reversibile. Se le prove non bastano, resta il comportamento attuale.

## Regole per le pull request

Ogni PR deve:

1. partire dal `main` corrente e avere un perimetro comprensibile;
2. non cancellare o riscrivere lavoro concorrente senza coordinamento;
3. spiegare risultato, rischi e controlli non eseguiti;
4. aggiungere test utili al comportamento modificato, senza duplicare test che
   non riducono un rischio reale;
5. superare i gate pertinenti descritti in `CONTRIBUTING.md`;
6. risolvere i commenti di review con codice verificato o una motivazione
   concreta.

La CI verde è necessaria, ma non dimostra da sola che dati, UI o deploy siano
corretti. Prima del merge si ricontrollano testa della PR, `main`, file
sovrapposti, check e ambiente servito quando rilevante.

Le PR vengono integrate una alla volta. Lo squash è il metodo predefinito; si
mantengono più commit solo quando la loro storia è utile e ogni commit resta
coerente. Se la testa della PR o `main` cambia durante l'ultimo controllo, il
merge si ferma e la verifica ricomincia.

## Quando serve una review umana

Non usiamo auto-merge per:

- redesign o modifiche UI ampie;
- nuove fonti o cambiamenti al significato dei dati;
- workflow con permessi di scrittura, deploy o pubblicazione;
- policy di sicurezza bloccanti, inclusa una CSP bloccante;
- licenze, privacy o condizioni di riuso.

Questi cambiamenti richiedono l'approvazione esplicita di un maintainer che non
sia l'autore. Un redesign ampio viene inoltre coordinato tra entrambi i
maintainer prima del merge.

Le PR tecniche piccole e indipendenti possono essere integrate dal maintainer
responsabile dopo tutti i check, purché non abbiano commenti aperti, conflitti o
modifiche concorrenti.

## Requisiti per una nuova fonte pubblica

Una nuova fonte è accettabile solo quando sono espliciti:

- ente titolare e URL ufficiale;
- licenza o condizioni di riuso;
- formato, geografia e copertura;
- periodo di riferimento, data di pubblicazione e data di osservazione;
- schema e identificativi usati nei join;
- hash o altra ricevuta riproducibile per gli snapshot;
- trasformazioni, riconciliazioni e controlli fail-closed, cioè capaci di
  fermarsi quando i dati sono incoerenti;
- cosa il dato non misura.

I test offline verificano gli artefatti committati. La corrispondenza con la
fonte remota deve essere provata dal flusso di refresh o da una verifica live
separata: non viene attribuita a un test che non usa la rete.

Quando un flusso gestito pubblica un nuovo snapshot, non scrive direttamente su
`main`: produce una branch dedicata, conserva le ricevute previste dal contratto
e apre una PR. Il merge resta una decisione umana dopo la validazione. I
workflow di sola verifica possono invece limitarsi a segnalare una variazione o
a produrre un artefatto candidato, senza cambiare i dati pubblicati.

## Conflitti, sicurezza e incidenti

Un conflitto Git non viene risolto scegliendo automaticamente una versione. Si
ricostruisce l'intento di entrambe le modifiche e si ripetono i test sulle
superfici coinvolte.

Le vulnerabilità non corrette seguono il canale privato descritto in
`SECURITY.md`. Segreti, credenziali e dettagli sfruttabili non vanno inseriti in
issue o log pubblici.

In un incidente di sicurezza o disponibilità un maintainer può fare un revert
o un hotfix limitato senza attendere la normale review. Deve però conservare le
prove, avvisare l'altro maintainer e aprire appena possibile una PR o una nota
che spieghi causa, modifica e verifica. Il rollback normale è il revert della
singola PR; non si riscrive la storia di `main`.

## Accesso e continuità

I permessi vengono assegnati con il minimo livello necessario. Un contributor
non diventa maintainer solo per il numero di commit: contano continuità,
correttezza delle review, cura dei dati e capacità di gestire incidenti.

L'aggiunta o la rimozione di un maintainer viene documentata con una PR che
aggiorna questo file. Nessun maintainer è proprietario esclusivo del progetto o
di una sua area.

## Documenti collegati

- [Come contribuire](CONTRIBUTING.md)
- [Template delle pull request](.github/pull_request_template.md)
- [Segnalazione privata delle vulnerabilità](SECURITY.md)
- [Architettura](docs/ARCHITECTURE.md)
- [Freshness e refresh delle fonti](docs/FRESHNESS_AND_REFRESH.md)
- [Principi legali ed etici](docs/LEGAL_AND_ETHICS.md)

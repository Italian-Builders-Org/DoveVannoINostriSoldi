# Governance del progetto

Questo documento spiega chi mantiene DoveVannoINostriSoldi e come vengono prese
le decisioni sul repository. L'obiettivo è proteggere qualità, fonti e lavoro
degli altri senza aggiungere burocrazia inutile.

[CONTRIBUTING.md](CONTRIBUTING.md) descrive requisiti tecnici, verifiche e
comandi. Questo documento definisce soltanto ruoli, soglie di review, ordine di
integrazione e gestione dei disaccordi.

In questo documento, *maintainer* indica una persona responsabile del progetto e
*PR* indica una pull request. Le regole si applicano alle PR aperte o aggiornate
dopo l'adozione di questo documento. Finché GitHub non le rende automatiche con
un ruleset, i maintainer le verificano manualmente prima del merge.

## Maintainer

I maintainer attuali sono:

- [@dg996](https://github.com/dg996);
- [@metaforismo](https://github.com/metaforismo).

Entrambi possono lavorare su codice, interfaccia, dati e infrastruttura. Le aree
seguenti indicano chi deve essere coinvolto nella review, non chi è autorizzato a
scrivere il codice.

- **Interfaccia e prodotto:** i redesign ampi, la gerarchia delle pagine e le
  scelte visuali importanti richiedono una review esplicita di entrambi. Le
  modifiche piccole e non controverse possono essere approvate da un maintainer.
- **Dati e fonti:** chi propone una fonte deve dimostrarne provenienza, contratto
  e limiti. Le modifiche che cambiano significato, copertura o trasformazioni
  richiedono la review di un secondo maintainer.
- **Infrastruttura e sicurezza:** workflow con permessi di scrittura, deploy,
  segreti, autenticazione e policy di sicurezza richiedono una review di un
  maintainer diverso dall'autore. Le modifiche alle impostazioni GitHub vengono
  eseguite da chi ha i permessi amministrativi, dopo la stessa review.

I maintainer possono aggiornare questa lista con una pull request approvata da
entrambi.

## Come viene accettata una pull request

Una pull request deve avere uno scopo chiaro e il più possibile atomico. La
descrizione deve indicare cosa cambia, come è stato verificato e quali rischi
restano.

Per il merge servono:

1. testa della PR e `main` ricontrollati subito prima dell'integrazione;
2. conflitti risolti manualmente senza cancellare il lavoro già presente;
3. test proporzionati al cambiamento e check richiesti verdi;
4. almeno una approvazione maintainer;
5. approvazione di entrambi per redesign ampi, modifiche alla Content Security
   Policy (CSP) che possono bloccare pagine, script o integrazioni, e modifiche
   ad alto impatto su dati, sicurezza, pubblicazione o infrastruttura.

I check verdi sono necessari, ma non bastano se il significato dei dati, la
provenienza o l'esperienza utente non sono stati verificati.

Le PR vengono mergiate una alla volta. Se `main`, la testa della PR o un file in
conflitto cambiano durante la verifica, il merge si ferma e i controlli vengono
ripetuti. Un rollback si fa con il revert della singola PR, non riscrivendo la
cronologia condivisa.

## Auto-merge

Se viene abilitato su GitHub, l'auto-merge può essere usato solo per modifiche
tecniche a basso rischio, con ambito stabile, review completata e tutti i check
verdi. Al momento resta disabilitato.

Non viene usato per:

- redesign o modifiche UI importanti;
- modifiche CSP che possono bloccare pagine, script o integrazioni;
- nuove fonti o cambiamenti al significato dei dati;
- workflow con nuovi permessi di scrittura;
- modifiche che pubblicano, cancellano o migrano dati.

## Requisiti per una nuova fonte pubblica

La checklist tecnica e i controlli obbligatori sono definiti in
[CONTRIBUTING.md](CONTRIBUTING.md#contratti-dati). La PR deve rendere verificabili
ente responsabile, URL ufficiale, licenza, periodo, copertura, valori mancanti,
trasformazioni e limiti del dato.

Per ogni snapshot o artefatto versionato sono obbligatori URL, dimensione,
SHA-256, schema, periodo e date distinte di riferimento, pubblicazione,
osservazione o recupero e verifica. Per una fonte live senza artefatto si
documentano il contratto e l'assenza di un hash.

Prima della pubblicazione si controllano presenza di dati personali, necessità
di oscuramenti e minimizzazione dei dati. Ricevute e hash pubblici si calcolano
solo dopo gli oscuramenti richiesti.

I dati dimostrativi non vengono pubblicati come dati reali. Un valore mancante
non diventa zero. Segnali, anomalie e confronti descrittivi non vengono presentati
come prove di spreco, illecito, causalità o responsabilità individuale.

## Conflitti e lavoro parallelo

Prima di integrare una modifica ampia si controllano PR aperte, branch attivi e
file sovrapposti. I maintainer lavorano in una worktree isolata creata dal
`main` aggiornato; chi contribuisce dall'esterno può usare un branch o fork
pulito.

Quando due contributi toccano lo stesso comportamento:

1. si decide l'ordine di integrazione;
2. il secondo contributo viene aggiornato sul primo già integrato;
3. i conflitti vengono ricomposti conservando entrambe le intenzioni valide;
4. i test vengono ripetuti sul risultato combinato.

Nessun contributo viene sostituito o eliminato in silenzio.

## Sicurezza

Le vulnerabilità non ancora corrette non vanno pubblicate in una issue. Si usa
la procedura privata descritta in [SECURITY.md](SECURITY.md).

Una correzione di sicurezza limita il più possibile lo scope, include test di
regressione e non espone segreti o dettagli sfruttabili prima della mitigazione.
Le modifiche distruttive o irreversibili richiedono approvazione esplicita.

## Decisioni e disaccordi

Le decisioni tecniche vengono motivate nella issue o nella pull request. Si
preferiscono fonti primarie, test riproducibili e cambiamenti reversibili.

Se resta un disaccordo, i maintainer cercano una soluzione più piccola e
verificabile. Se non è possibile, decidono insieme in base alla sicurezza del
progetto, alla correttezza dei dati e all'utilità per chi usa il sito. Non sono
previsti comitati, votazioni formali o quote di approvazione oltre alle regole
indicate qui.

Questo documento può essere modificato con una pull request separata e una
review esplicita di entrambi i maintainer.

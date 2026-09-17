# Pagella politico-economica dei governi italiani

Questa pagina aiuta a leggere come è cambiata l'economia italiana durante ciascun governo, confrontando gli stessi anni con Francia, Germania e Spagna.

Non è una classifica, non sceglie un vincitore e non assegna meriti o colpe politiche. Offre un voto indicativo, dati consultabili e un contesto documentato.

> Questo voto descrive come è andata l'economia nel periodo; non misura quanta parte dei risultati sia stata causata dal governo.

## Cosa trova il cittadino

La pagina pubblica `/governi` mostra il governo in carica. L'archivio permette di aprire la scheda di ogni governo dal 1995 e di affiancarne due.

Ogni scheda contiene, nello stesso ordine:

1. voto da 0 a 100, stato del voto e cinque aree riassuntive;
2. nove grafici con Italia, Francia, Germania e Spagna;
3. contesto del mandato: sintesi, situazione ereditata, crisi e guerre, BCE, misure economiche e cronologia;
4. archivio cronologico e confronto fra due governi;
5. spiegazione semplice del calcolo, seguita dai dettagli tecnici apribili.

Le fonti dei grafici e delle schede di contesto sono raggiungibili dalla pagina.

## Scarica i dati

La voce "Scarica i dati" porta a due file principali: "Dati usati nel voto" per controllare il punteggio e "Dati di grafici e contesto" per ricostruire ciò che appare nella pagina. Metodo, cronologia e contratti di provenienza restano disponibili nel pannello espandibile "File tecnici per verificare i dati".

Il link "Indice tecnico dei download" scarica il manifest `/api/governi/dati`, che dichiara per ciascun file formato, compressione, byte e SHA-256 esatti. Ogni download è su allowlist chiusa: un identificatore ignoto restituisce 404. Ogni indicatore conserva fonte, serie o query, unità, frequenza, periodo, vintage, trasformazione, data di acquisizione e SHA-256.

| Download | Contenuto |
| --- | --- |
| `/api/governi/dati/score-data` | dati annuali usati nel voto |
| `/api/governi/dati/page-data` | dati generali dei grafici e contesto editoriale documentato; download `government-scorecard-page-data.json.gz` compresso con gzip |
| `/api/governi/dati/methodology` | metodo di calcolo |
| `/api/governi/dati/chronology` | cronologia istituzionale |
| `/api/governi/dati/score-provenance` | contratto di provenienza dei dati del voto |
| `/api/governi/dati/page-provenance` | contratto di provenienza dei dati della pagina |

La validazione offline controlla snapshot congelati, calcolo, hash e catena valore mostrato → record → fonte. Il repository non conserva nuovi payload raw e quindi non dichiara che la validazione offline possa ricreare i byte originali delle fonti.

Il refresh online resta separato: il workflow `government-scorecard-refresh.yml` interroga le fonti ufficiali, valida i nuovi payload e propone gli aggiornamenti tramite una PR dati.

La Function rifiuta in modo fail-closed qualsiasi risposta oltre 4.500.000 byte. Soltanto `page-data` usa gzip per restare sotto questo limite: decomprimendo il file si ottiene esattamente il JSON canonico. Gli altri download restano JSON non compressi.

## Come leggere il voto

Il punto di riferimento è 50:

- vicino a 50: l'Italia si è mossa in modo simile al valore mediano di Francia, Germania e Spagna;
- sopra 50: nel complesso l'Italia ha avuto un andamento migliore;
- sotto 50: nel complesso l'Italia ha avuto un andamento peggiore.

“Migliore” dipende dall'indicatore. Per esempio, una crescita maggiore delle retribuzioni reali è positiva; un aumento maggiore della disoccupazione o del debito rispetto al PIL è negativo.

Il voto è `storico` per un governo concluso e `provvisorio` per quello in carica. Un governo con meno di 365 giorni o senza tutti i dati obbligatori mostra il motivo e non riceve un numero.

La stabilità indica quanto il risultato cambia provando scelte metodologiche alternative già definite. Non cambia il voto pubblicato.

## Perché il voto arriva al 2024

Il voto usa soltanto anni osservati, completi e disponibili per tutti e quattro i paesi. Nel vintage AMECO Spring 2026:

- il 2024 è l'ultimo anno comune osservato;
- il 2025, 2026 e 2027 sono previsioni;
- le previsioni non entrano mai nel voto.

Per questo il governo in carica può avere grafici aggiornati oltre il 2024, ma il suo voto resta basato sull'ultima finestra annuale completamente osservata. Quando AMECO pubblicherà un nuovo anno osservato, l'aggiornamento passerà attraverso una PR dati verificabile.

## Dati del voto e dati della pagina

Sono due insiemi distinti.

### Dati usati nel voto

Provengono da AMECO e comprendono sei indicatori annuali:

| Area | Indicatore | Un andamento migliore significa |
| --- | --- | --- |
| Potere d'acquisto | Retribuzione reale per lavoratore | crescita maggiore |
| Lavoro | Tasso di disoccupazione | diminuzione maggiore |
| Crescita | PIL reale per abitante | crescita maggiore |
| Finanza pubblica | Debito pubblico / PIL | diminuzione maggiore |
| Finanza pubblica | Saldo primario / PIL | aumento maggiore |
| Capacità futura | Investimenti / PIL | aumento maggiore |

Ogni indicatore usa gli stessi quattro paesi, la stessa finestra temporale e la stessa formula.

### Dati mostrati per capire il periodo

La pagina mostra nove serie. La frequenza più alta serve a leggere cosa è
successo dentro il mandato; non sostituisce le serie annuali AMECO usate nel
voto.

| Grafico | Frequenza e fonte | Ultimo periodo nello snapshot | Entra nel voto |
| --- | --- | --- | --- |
| Inflazione armonizzata | mensile, Eurostat `prc_hicp_minr` | agosto 2026, stimato | no |
| Retribuzione reale per dipendente | annuale, AMECO | 2024, osservato | sì |
| Disoccupazione | mensile, Eurostat `une_rt_m` | luglio 2026 | no |
| Occupazione | trimestrale, Eurostat `lfsi_emp_q` | primo trimestre 2026 | no |
| PIL reale per abitante | trimestrale, Eurostat `namq_10_pc` | secondo trimestre 2026 | no |
| Debito pubblico / PIL | trimestrale, Eurostat `gov_10q_ggdebt` | primo trimestre 2026 | no |
| Debito pubblico per abitante | annuale, Eurostat `gov_10dd_edpt1` + `nama_10_pe` | 2025 | no |
| Saldo primario / PIL | trimestrale, Eurostat `gov_10q_ggnfa` | primo trimestre 2026 | no |
| Investimenti / PIL | trimestrale, Eurostat `namq_10_gdp` | secondo trimestre 2026 | no |

“Stimato” e “provvisorio” sono stati pubblicati dalla fonte e vengono mostrati
come tali. Questi punti aiutano a leggere il periodo, ma non entrano nel voto:
il calcolo usa solo le osservazioni annuali AMECO descritte sopra.

Il debito per abitante è calcolato solo quando Eurostat fornisce, per lo stesso paese e lo stesso anno, debito pubblico consolidato e popolazione. Non vengono interpolati valori mancanti.

Le schede di contesto raccolgono eventi e decisioni da fonti istituzionali. Servono a spiegare in quale situazione ha operato il governo, ma hanno sempre impatto zero sul voto.

## Come viene calcolato, in cinque passaggi

1. Guardiamo come è cambiata l'Italia.
2. Guardiamo gli stessi dati in Francia, Germania e Spagna.
3. Confrontiamo i cambiamenti negli stessi anni.
4. Uniamo cinque aree con lo stesso peso.
5. Otteniamo un numero da 0 a 100. Se l'Italia si muove come gli altri tre paesi, il risultato resta vicino a 50.

Esempio: se la disoccupazione scende di 2 punti in Italia e il calo mediano degli altri tre paesi è anch'esso di 2 punti, la differenza è zero e quell'indicatore vale 50.

## Quale periodo appartiene a un governo

Le date istituzionali non sono stimate:

- l'inizio è il giorno del giuramento;
- la fine esclusiva è il giorno del giuramento del governo successivo;
- il governo in carica termina, provvisoriamente, alla data di aggiornamento;
- gli intervalli sono trattati come `[inizio, fine esclusiva)`, quindi un giorno non appartiene a due governi.

Il voto usa dati annuali. A ogni anno è associata la data di riferimento del 1º luglio. Un anno entra nella finestra del governo soltanto se quella data cade nel suo mandato. La variazione è calcolata fra il primo e l'ultimo anno assegnato; servono due estremi distinti.

Questa regola è uguale per tutti e impedisce di scegliere manualmente gli anni più favorevoli.

I grafici seguono una regola diversa perché possono essere mensili,
trimestrali o annuali: iniziano dal periodo che contiene il giorno del
giuramento e terminano all'ultimo periodo pubblicato o alla fine del mandato.
Il primo punto può quindi includere alcuni giorni precedenti al giuramento; la
pagina lo segnala esplicitamente. Questa scelta amplia soltanto il contesto
visivo e non cambia il voto.

## Stati possibili

| Stato interno | Cosa vede l'utente | Regola |
| --- | --- | --- |
| `scored_final` | voto storico | governo concluso, durata e dati sufficienti |
| `scored_provisional` | voto provvisorio | governo in carica, durata e dati sufficienti |
| `not_scored_short` | voto non calcolato | mandato inferiore a 365 giorni |
| `not_scored_data` | voto non calcolato | manca almeno un input obbligatorio o una finestra valida |

Anche senza voto, la scheda resta disponibile con grafici e contesto documentato.

## Storia del metodo

Le versioni precedenti hanno aiutato a capire cosa non funzionava, ma non restano nel codice di produzione.

1. **Valori assoluti.** Mostravano l'andamento italiano, senza separare bene ciò che avveniva nello stesso momento nel resto d'Europa.
2. **Normalizzazione interna.** Provava a rendere confrontabili indicatori con unità diverse, ma lasciava troppo spazio alla scelta degli estremi e alla lettura politica del numero.
3. **Confronto europeo aggregato.** Introduceva gli altri paesi, ma una sola media nascondeva differenze e rendeva poco leggibile il risultato.
4. **Metodo attuale.** Usa gli stessi dati e anni per Italia, Francia, Germania e Spagna, prende la mediana dei tre paesi di confronto, applica regole temporali fisse, esclude le previsioni e rende visibili dati, fonti e limiti.

La storia serve a spiegare l'evoluzione del progetto. Solo il metodo descritto qui è eseguibile e supportato.

## Fonti

### Voto

- **AMECO**, Commissione europea, DG ECFIN: sei serie annuali macroeconomiche.
- Licenza dichiarata: CC BY 4.0 salvo diversa indicazione.
- Vintage corrente: Spring 2026 Economic Forecast.

### Grafici aggiuntivi

- **Eurostat `prc_hicp_minr`**: inflazione armonizzata mensile;
- **Eurostat `une_rt_m`**: disoccupazione mensile destagionalizzata;
- **Eurostat `lfsi_emp_q`**: tasso di occupazione trimestrale destagionalizzato;
- **Eurostat `namq_10_pc`**: PIL reale trimestrale per abitante;
- **Eurostat `gov_10dd_edpt1`**: debito pubblico consolidato;
- **Eurostat `gov_10q_ggdebt`**: debito pubblico trimestrale in rapporto al PIL;
- **Eurostat `gov_10q_ggnfa`**: saldo netto e interessi usati per ricavare il saldo primario trimestrale;
- **Eurostat `namq_10_gdp`**: investimenti trimestrali in rapporto al PIL;
- **Eurostat `nama_10_pe`**: popolazione annuale.

### Date e contesto

- Presidenza della Repubblica e articolo 93 della Costituzione per i giuramenti;
- BCE, Commissione europea, Banca d'Italia, Parlamento, Normattiva e altre fonti istituzionali indicate nelle singole schede.

Ogni osservazione conserva fonte, periodo, data di acquisizione e impronta SHA-256. Le schede di contesto conservano anche il criterio di selezione e l'impronta dell'evidenza mostrata.

## Aggiornamento e manutenzione

### Controllo automatico

Il workflow `government-scorecard-refresh.yml` viene eseguito ogni settimana e può essere avviato manualmente. La frequenza settimanale serve a rilevare tempestivamente una nuova pubblicazione; non significa che i dati ufficiali cambino ogni settimana.

Il workflow:

1. scarica AMECO ed Eurostat dalle origini consentite;
2. convalida formato, serie, filtri, paesi, periodi, unità e ricevute;
3. ricostruisce entrambi gli artefatti con la stessa data di acquisizione;
4. esegue controlli ETL e test del calcolo;
5. propone una PR dati separata soltanto se gli artefatti cambiano.

Nessun aggiornamento pubblica direttamente su `main`.

### Frequenze e responsabilità

L'unico workflow `government-scorecard-refresh.yml` interroga AMECO e le nove
query Eurostat ogni martedì, quindi più spesso del minimo semestrale. Si può
avviare anche manualmente. Il log registra l'ora del controllo, l'esito e la
scadenza del contesto; `retrieved_at` resta la data di acquisizione del payload,
non quella dell'ultimo polling riuscito. Un controllo fallito non prova che i
dati siano aggiornati: il manutentore responsabile delle fonti deve esaminare
le run fallite e ripetere l'acquisizione entro il semestre.

Il manutentore editoriale rivede contesto economico, europeo e internazionale
entro tre mesi di calendario dalla revisione precedente e al cambio di governo.
La ricevuta `refreshPolicy.contextReview` nel contratto di provenienza della
pagina lega la data ai contenuti completi e al registro dei giuramenti tramite
SHA-256. La ricevuta iniziale identifica il catalogo congelato del 3 settembre
2026; questa modifica tecnica non aggiunge una nuova revisione editoriale.
Alla scadenza, il workflow continua a osservare le serie ma blocca la
pubblicazione e segnala la revisione necessaria. Non inventa contesto né aggiorna
la data della revisione da solo. Anche una revisione senza cambiamenti richiede
la registrazione esplicita della nuova data da parte del manutentore.

### Aggiornamento manuale e errori

Usare un checkout pulito e l'orchestratore del workflow, non una sequenza di
write indipendenti dei singoli ETL:

```bash
python3 scripts/etl/government_scorecard_refresh.py --observe --retrieved-at <timestamp-UTC>
```

`--observe` controlla schema, identità, unità, flag e completezza e stampa le
ricevute acquisite senza scrivere snapshot o candidati. Un nuovo payload non
approvato resta bloccato: confrontare periodo, fonte, termini di riuso, hash e
valori con il rilascio precedente prima di riportare le ricevute nel
`refreshPolicy` di `government-scorecard-page.source.json`. Non approvare un
hash soltanto perché è quello restituito dal download.

Per un nuovo vintage AMECO aggiornare insieme source spec e manifest metodologico
(vintage, anni osservati e anni di previsione). `scoreAcquiredAt` e
`coreArtifactSha256` fissano esattamente l'acquisizione approvata. Una revisione
storica richiede un confronto esplicito dei voti e l'aggiornamento motivato dei
test di riferimento; non viene accettata silenziosamente dal polling.

```bash
python3 scripts/etl/government_scorecard_refresh.py --retrieved-at <timestamp-UTC>
python3 scripts/ci/source-snapshot-inventory.py --write
npm run government-scorecard:verify
npm run test:etl
npm run test:snapshots
```

Preparare nello stesso contributo le modifiche editoriali/metodologiche e gli
snapshot che le applicano: non pubblicare un contratto nuovo con dati vecchi.
Se cambia il periodo del voto, aggiornare l'inventario prima del refresh
(l'inventario deriva dal source spec); il refresh ne controlla l'allineamento.
I file immutati non vengono riscritti. Il manifest pubblico, i download e le
ricevute sono derivati dai medesimi file validati, senza un secondo generatore.

Timeout, payload parziale, cambiamento inatteso di schema, fonte, licenza,
identità, periodo o hash interrompono il refresh. I dati sono preparati in
memoria; un errore nella sostituzione locale o nella verifica finale ripristina
i byte precedenti. La pubblicazione usa l'unico commit/candidato del publisher
esistente: una run interrotta non raggiunge quel passo. L'atomicità pubblica è
quella dell'albero Git, non una transazione fra file di un server in esecuzione.
Non eseguire l'ETL nella directory di un'applicazione in servizio.

Il publisher rimane limitato ai due artifact generati: cronologia, metodologia
e approvazioni editoriali richiedono un contributo umano. Nessun commit o
candidato viene prodotto se non cambia alcun dato. I log delle run conservano
la prova dei controlli che non hanno prodotto modifiche.

### Cambio di governo

1. Verificare il giuramento sulla notizia specifica della Presidenza della
   Repubblica. Aggiungere al registro ID univoco, nome, data, URL e locator;
   aggiornare `asOfDate` e `verifiedAt`. I 17 giuramenti già verificati sono
   protetti; nuove voci sono ammesse solo in coda e in ordine temporale.
2. Il modello chiude il mandato precedente alla data esclusiva del successore.
   Nel catalogo `contexts` dello snapshot della pagina aggiornare la scheda
   cronologica precedente e aggiungere le sei categorie del nuovo governo,
   con fonti, periodo e canale economico. Una categoria vuota richiede comunque
   la revisione del catalogo; non copiare automaticamente il contesto precedente.
3. Ricalcolare gli hash degli elementi modificati con
   `government_scorecard_page._canonical_hash` sull'evidenza (tutti i campi
   eccetto `retrieved_at` e `evidence_sha256`), poi gli hash del catalogo e del
   registro nella ricevuta `contextReview`. Registrare la data della revisione.
   Date, nomi, fonti e confini del mandato devono riconciliare.
4. Eseguire l'orchestratore e le verifiche sopra; aggiornare i test di riferimento
   del governo diventato storico e aggiungere il nuovo caso. Verificare in browser
   governo corrente, archivio, confronto e download.
5. Il nuovo governo compare dal registro, ma resta senza voto finché non supera
   durata minima e finestra annuale comune completa. Solo osservazioni AMECO
   entrano nel calcolo; previsioni e serie di contesto non possono sostituirle.

## I due artefatti mantenuti

| File | Contenuto | Può cambiare il voto |
| --- | --- | --- |
| `src/data/generated/government-scorecard.json` | pannello AMECO minimo per il calcolo | sì |
| `src/data/generated/government-scorecard-page.json` | nove grafici, fonti e contesto dei 17 governi | no |

Il secondo file contiene l'impronta del primo. Se i due non appartengono allo stesso aggiornamento, la validazione fallisce.

Il file della pagina è l'eccezione tipizzata prevista dallo
[standard di import](DATA_IMPORT_STANDARD.md): le serie hanno frequenze e stati
diversi, due indicatori sono derivati da componenti che devono riconciliare e
ogni punto conserva fonte e hash. Non duplica un dataset già pubblicato nel
corpus integrato. Il contratto TypeScript/Zod e l'ETL rifiutano campi, filtri,
periodi o provenienze inattesi.

I tre assi obbligatori sono trattati così:

- **soldi:** quasi tutte le serie sono indici, tassi o rapporti; lo stock di
  debito in milioni di euro viene usato soltanto per ricavare il valore pro
  capite e non viene sommato a pagamenti, impegni o previsioni;
- **periodo:** ogni punto conserva periodo di riferimento, frequenza e stato;
- **provenienza:** titolare, URL di query e landing, condizioni di riuso, data
  della fonte, acquisizione, dimensione e SHA-256 restano separati. Il controllo
  di validità avviene durante la stessa acquisizione registrata.

Nell'inventario generale il periodo `2024` della riga `government-scorecard`
indica l'ultimo anno osservato del voto. Gli ultimi periodi dei nove grafici
sono elencati nella tabella sopra e nel secondo artefatto.

## Verifica locale

```bash
npm run government-scorecard:verify
npm run ci:static
npm run test:etl
npm run test:snapshots
npm run build
```

La verifica browser copre pagina corrente, governo con voto storico, mandato breve, dati mancanti e confronto. Deve controllare grafici, tutte le schede di contesto, navigazione da tastiera, zoom e assenza di overflow.

## Dettagli tecnici del punteggio

Per ogni indicatore `i` calcoliamo il cambiamento italiano e quello dei tre paesi di confronto sulla stessa finestra.

Per gli indici di livello usiamo una variazione logaritmica:

```text
cambiamento = 100 × [ln(valore finale) − ln(valore iniziale)]
```

Per tassi e rapporti usiamo la differenza in punti:

```text
cambiamento = valore finale − valore iniziale
```

Il segno viene orientato in modo che un numero maggiore significhi sempre un risultato migliore. Poi calcoliamo:

```text
gap_i = cambiamento orientato Italia
        − mediana(cambiamento orientato Francia, Germania, Spagna)
```

Indicatori diversi hanno unità diverse. Per renderli confrontabili stimiamo una scala robusta `s_i` sulle finestre storiche dal 1995 con la stessa durata del mandato. La scala usa la deviazione assoluta mediana, con l'intervallo interquartile come fallback. Servono almeno 20 finestre e una capacità di almeno 6 finestre non sovrapposte.

Il punteggio dell'indicatore è:

```text
punteggio_i = 50 × [1 + tanh(gap_i / (2 × s_i))]
```

La funzione `tanh` limita il risultato tra 0 e 100 e riduce il peso dei valori estremi. Se `gap_i = 0`, il punteggio è esattamente 50.

I sei indicatori formano cinque aree. Debito/PIL e saldo primario valgono ciascuno metà dell'area finanza pubblica. Le cinque aree pesano tutte il 20%:

```text
voto finale = 20% potere d'acquisto
            + 20% lavoro
            + 20% crescita
            + 20% finanza pubblica
            + 20% capacità futura
```

Il valore interno conserva la precisione completa; la pagina arrotonda all'intero più vicino con regola half-up.

## Limiti tecnici

- Il confronto riduce alcuni shock comuni, ma non dimostra causalità.
- Francia, Germania e Spagna sono un riferimento fisso e trasparente, non l'unico possibile.
- I dati annuali non descrivono ciò che accade dentro ogni mese del mandato.
- L'ultimo vintage AMECO può rivedere anche anni passati; la PR dati rende visibile ogni variazione.
- Alcuni assi dello stress test non hanno ancora una seconda fonte o un vintage precedente congelato. Sono mostrati come stress parziale e non alterano il voto.
- Un numero sintetico non sostituisce la lettura dei singoli indicatori, dei grafici e del contesto.

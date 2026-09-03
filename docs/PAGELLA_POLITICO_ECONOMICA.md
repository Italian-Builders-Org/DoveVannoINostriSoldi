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

### Cadenza editoriale

- **Dati del voto:** verifica a ogni nuovo vintage AMECO e comunque almeno ogni sei mesi.
- **Grafici Eurostat:** rilevazione automatica settimanale; revisione dei cambiamenti tramite PR.
- **Contesto:** revisione almeno trimestrale, dopo eventi economici internazionali rilevanti e al cambio di governo.
- **Cronologia:** aggiornamento al giuramento di un nuovo governo, usando una fonte della Presidenza della Repubblica.

Il contesto non viene generato da notizie senza revisione. Un elemento nuovo richiede periodo, breve spiegazione del possibile canale economico, fonte autorevole e verifica umana.

### Cambio di governo

Quando giura un nuovo governo occorre:

1. aggiungere il nuovo giuramento al registro cronologico e verificare la fonte;
2. chiudere automaticamente il mandato precedente con quella stessa data esclusiva;
3. aggiungere il contesto iniziale del nuovo governo;
4. rigenerare i due artefatti;
5. eseguire test e controllo visivo prima della PR.

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
python3 scripts/ci/check-government-scorecard-artifacts.py
python3 -m unittest \
  tests/etl/test_government_scorecard_snapshot.py \
  tests/etl/test_government_scorecard_chronology.py \
  tests/etl/test_government_scorecard_page.py
node --experimental-strip-types --test tests/government-scorecard-*.test.mjs
npm run ci:static
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

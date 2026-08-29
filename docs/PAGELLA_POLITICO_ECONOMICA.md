# Pagella politico-economica dei governi italiani

## Stato del documento

Questa nota definisce la strategia e documenta la prima implementazione della
pagella economica dei governi italiani. La pagina `/governi` calcola oggi un
**indice annuale sperimentale dei risultati economici nel periodo** con dati AMECO reali, fonti
verificabili e limiti espliciti. Non va confuso con la futura pagella
socio-economica completa né interpretato come una stima causale.

La domanda a cui il prodotto deve rispondere è:

> Come è cambiata la situazione economica durante questo governo, rispetto a
> quella ereditata, agli altri Paesi e al contesto storico del periodo?

Il risultato non deve essere presentato come la misura esatta del merito o della
colpa di un governo. L'economia dipende anche da Parlamento, enti territoriali,
BCE, Unione europea, governi precedenti, ciclo internazionale e shock esterni.

## Obiettivo per l'utente

La pagina deve permettere a una persona non specialista di capire in pochi
minuti:

1. cosa è migliorato e cosa è peggiorato durante un governo;
2. se l'Italia è andata meglio o peggio di Paesi sottoposti a condizioni simili;
3. quale situazione il governo ha ereditato;
4. quali shock hanno condizionato il periodo;
5. quali misure economiche rilevanti sono state approvate e realmente attuate;
6. quanto sono solide le conclusioni e cosa i dati non possono dimostrare;
7. per il governo in carica, come sta andando finora e quali sono gli scenari dei
   successivi dodici-ventiquattro mesi.

Il nome pubblico può essere **Pagella economica dei governi**. Il numero deve
però chiamarsi **risultato economico osservato nel periodo**, per non suggerire
un'attribuzione causale automatica.

## Principi non negoziabili

- Nessun numero senza fonte, periodo, unità, perimetro e data di aggiornamento.
- Nessun voto basato su dati dimostrativi o inventati.
- Dati osservati, previsioni, obiettivi governativi e stime causali restano
  separati.
- Una misura annunciata non è una misura approvata; una misura approvata non è
  necessariamente attuata; una misura attuata non è automaticamente efficace.
- Una correlazione temporale non dimostra che una politica abbia prodotto un
  risultato.
- I dati mancanti non vengono sostituiti con zero e i pesi non vengono
  rinormalizzati per far apparire completo un governo incompleto.
- Ogni ricalcolo conserva versione del metodo, vintage dei dati e cronologia
  delle revisioni.
- Il metodo viene congelato prima di pubblicare il primo confronto fra governi.
- Il governo in carica riceve soltanto un risultato **provvisorio** e distinto
  dalla previsione.

## Revisione v3: dal Core macro al benessere del cittadino

Il feedback sul primo prototipo evidenzia un errore di prodotto: sei indicatori
macroeconomici non possono essere mostrati come se fossero già la pagella
economica completa. Da questa revisione in avanti distinguiamo tre risultati:

1. **benessere del cittadino**: cosa è successo a reddito, costi essenziali,
   lavoro, risparmio, casa e opportunità;
2. **performance nel contesto**: quanto l'Italia è migliorata o peggiorata
   rispetto alla traiettoria ereditata e a Paesi esposti allo stesso periodo;
3. **impatto delle politiche**: quali manovre sono state approvate e quali
   effetti possono essere collegati ad esse da valutazioni indipendenti.

Il terzo livello non viene sommato automaticamente ai primi due. Altrimenti lo
stesso risultato verrebbe contato una volta come dato economico e una seconda
volta come presunto merito politico.

### I dieci dati da mostrare al cittadino

La schermata principale deve ridurre centinaia di serie a dieci domande. Le
prime sei formano il candidato **Score cittadino**; le ultime quattro sono
diagnostiche finché copertura e ritardi non consentono confronti equi tra
governi.

| # | Domanda | Indicatore | Fonte primaria | Uso proposto |
| ---: | --- | --- | --- | --- |
| 1 | Quanto resta davvero alle famiglie? | reddito disponibile reale per abitante | [Eurostat `nasq_10_ki`](https://ec.europa.eu/eurostat/databrowser/view/nasq_10_ki/default/table?lang=it) | voto |
| 2 | Quanto pesano cibo, energia e casa? | IPCA delle spese essenziali rispetto al reddito | [Eurostat `prc_hicp_aind`](https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_aind/default/table?lang=it) | voto |
| 3 | Quante persone lavorano davvero? | occupazione 20-64 anni | [Eurostat `lfsi_emp_a`](https://ec.europa.eu/eurostat/databrowser/view/lfsi_emp_a/default/table?lang=it) | voto |
| 4 | Quanto reddito non viene assorbito dai consumi? | tasso di risparmio delle famiglie | [Eurostat `nasq_10_ki`](https://ec.europa.eu/eurostat/databrowser/view/nasq_10_ki/default/table?lang=it) | diagnostico: verso ambiguo |
| 5 | Quanti sono schiacciati dal costo della casa? | housing cost overburden, soglia 40% | [Eurostat `ilc_lvho07a`](https://ec.europa.eu/eurostat/databrowser/view/ilc_lvho07a/default/table?lang=it) | voto |
| 6 | Quanti giovani sono senza lavoro e formazione? | NEET 15-29 anni | [Eurostat `edat_lfse_20`](https://ec.europa.eu/eurostat/databrowser/view/edat_lfse_20/default/table?lang=it) | voto |
| 7 | Il lavoro crea più valore? | produttività reale per ora | [Eurostat `nama_10_lp_ulc`](https://ec.europa.eu/eurostat/databrowser/view/nama_10_lp_ulc/default/table?lang=it) | voto |
| 8 | Le persone riescono a realizzare i progetti di figli? | fecondità, natalità e primo figlio | [Eurostat `demo_find`](https://ec.europa.eu/eurostat/databrowser/view/demo_find/default/table?lang=it) | diagnostico: ritardo lungo |
| 9 | Il Paese trattiene e riporta capitale umano? | saldo dei laureati italiani 25-34 anni | [Istat, tavola 13](https://demo.istat.it/tavole/?l=it&t=apr4) | diagnostico: serie dal 2013 e solo Italia |
| 10 | Famiglie diverse hanno davvero capacità di investire e rischiare? | ricchezza netta, debiti e attività finanziarie per fascia | [Banca d'Italia, conti distributivi](https://www.bancaditalia.it/statistiche/tematiche/conti-patrimoniali/conti-distributivi/) | diagnostico: copertura recente |

Risparmio, fecondità e migrazione dei laureati devono essere valutati e mostrati, ma non
possono ricevere lo stesso peso di un indicatore trimestrale: dipendono da
decisioni maturate in molti anni e, per i governi più vecchi, la copertura non è
comparabile. Escluderle dalla schermata sarebbe sbagliato; trasformarle subito
in punti di voto sarebbe altrettanto arbitrario.

### Perché questi dati sono ancora fuori dal numero

La disponibilità di una fonte non basta per assegnare punti. Ogni indicatore
deve superare insieme sei controlli: stessa definizione nel tempo, copertura dei
governi della classe, stesso perimetro per i peer, frequenza adeguata alla
finestra, regole sulle revisioni e assenza di doppio conteggio.

| Indicatore | Frequenza che possiamo usare | Blocco da risolvere prima del voto |
| --- | --- | --- |
| reddito reale disponibile | trimestrale dal 2002 per Italia e peer | validare endpoint dei mandati, revisioni e medie su quattro trimestri |
| spese essenziali | IPCA mensile dal 1996 | fissare categorie e pesi del paniere; non contare due volte l'inflazione già incorporata nel reddito reale |
| occupazione | trimestrale; annuale per la serie proposta | gestire stagionalità e rotture; non duplicare la disoccupazione |
| risparmio delle famiglie | trimestrale dal 2002 per Italia e peer | non esiste un verso sempre positivo: picchi possono indicare prudenza, restrizioni o insicurezza |
| costo della casa | annuale | ritardo e discontinuità d'indagine impediscono un monitoraggio corrente omogeneo |
| NEET | annuale nella serie proposta | verificare se la serie LFS trimestrale mantiene definizione e copertura storica sufficienti |
| produttività oraria | annuale nella serie proposta; conti trimestrali come alternativa | scegliere una serie unica e non duplicare PIL e investimenti |
| fecondità | annuale | ritardo causale lungo e forte influenza di fattori non economici |
| migrazione dei laureati | annuale e solo Italia nel perimetro proposto | definizioni e peer non ancora omogenei; serie breve |
| ricchezza distributiva | trimestrale con circa cinque mesi di ritardo | serie recente, componente stimata e revisioni: non copre equamente i governi dal 1995 |

Per il governo in carica possiamo quindi costruire un **cruscotto corrente** più
frequente del voto storico: inflazione, categorie essenziali, credito e tassi
mensili; lavoro, reddito, risparmio, PIL e produttività trimestrali. Il voto fra
governi resta invece sulla maggiore frequenza comune e validata. Non sommeremo
una lettura mensile del presente a un confronto annuale del passato.

Il primo modulo corrente implementato usa l'IPCA mensile Eurostat
`prc_hicp_minr` per prezzi complessivi, alimentari e casa-acqua-energia. Mostra
la variazione cumulata da ottobre 2022, il tasso degli ultimi dodici mesi e la
mediana nello stesso periodo di Francia, Germania e Spagna. Questi segnali sono
diagnostici: descrivono l'andamento armonizzato dei prezzi, ma non assegnano
punti e non misurano il costo della vita specifico di ogni famiglia.

Un algoritmo perfetto e interamente causale non è ottenibile: manca il mondo
controfattuale in cui lo stesso Paese, nello stesso momento, è governato da un
altro esecutivo. Possiamo però rendere perfetti in senso tecnico provenienza,
riproducibilità e formula; e rendere esplicita l'incertezza dell'attribuzione.

L'audit del 29 agosto 2026 sulla API Eurostat ha verificato questa copertura
trimestrale per Italia, Francia, Germania e Spagna:

| Serie | Copertura verificata | Decisione |
| --- | --- | --- |
| reddito disponibile lordo reale per abitante, `nasq_10_ki`, `B6G_R_HAB_2010` | 2002-Q1–2026-Q1, 97 osservazioni per ciascun Paese | candidato prioritario al monitoraggio corrente e al paniere dal 2005 |
| tasso di risparmio lordo, `nasq_10_ki`, `SRG_S14_S15` | 2002-Q1–2026-Q1, 97 osservazioni per ciascun Paese | diagnostico, senza verso positivo automatico |
| occupazione 20-64, `lfsq_ergan` | Italia e Spagna complete; Francia e Germania hanno osservazioni mancanti | non entra finché rotture e buchi non sono gestiti senza imputazioni arbitrarie |
| produttività reale per ora, `namq_10_lp_ulc`, `RLPR_HW` | 2002-Q1–2026-Q1 per l'Italia; peer fino a 2026-Q2 | candidato, usando soltanto l'ultimo trimestre comune |

Questa verifica prova disponibilità e copertura, non autorizza ancora a sommare
le serie al Core: servono adapter fail-closed, vintage, test sugli endpoint e
controlli contro il doppio conteggio.

### Stabilità e capacità futura

Accanto allo Score cittadino mostriamo un modulo di sostenibilità, separato e
visibile, composto da:

- debito, spesa per interessi e costo di rifinanziamento;
- condizioni del credito, banche e trasmissione dei tassi;
- investimenti produttivi pubblici e privati, ricerca e sviluppo.

Lo spread BTP-Bund appartiene a questo modulo. Non è il confronto “Italia vs
peer” oggi mostrato dal Core: è la differenza fra rendimento dei titoli italiani
e Bund tedeschi. Poiché il Bund è il riferimento, non esiste uno “spread
BTP-Bund della Germania” direttamente confrontabile con quello italiano. Per
confrontare il rischio sovrano mostreremo rendimento, differenza rispetto a un
benchmark comune, spesa per interessi e condizioni del credito senza confondere
queste misure con il reddito del cittadino.

Score cittadino e sostenibilità futura restano due moduli visibili e separati
finché non esiste evidenza sufficiente per giustificare un rapporto di peso.
I pesi interni non vengono congelati finché il paniere non supera l'audit di
copertura e ridondanza. In particolare reddito, salari e consumi, oppure debito,
interessi e spread, non devono contare più volte lo stesso fenomeno.

### Come il contesto modifica il confronto, non il dato

Non assegniamo un bonus manuale per “pandemia”, “guerra” o “crisi energetica”.
Per ogni indicatore costruiamo tre confronti verificabili:

1. variazione italiana durante il mandato;
2. scarto rispetto a Paesi nello stesso periodo, scelti usando caratteristiche
   precedenti al mandato;
3. scarto rispetto alla traiettoria italiana ereditata prima del mandato.

La formula pubblicata resta intenzionalmente semplice: 50% confronto con
finestre storiche italiane della stessa durata e 50% confronto con peer
contemporanei. La traiettoria ereditata viene mostrata separatamente e non
riceve un peso finché non supera test di pre-trend e stabilità.

Le variabili usate per scegliere o pesare i peer devono esistere prima di vedere
il risultato: dipendenza energetica, struttura industriale, apertura commerciale,
debito e scadenze, condizioni bancarie, regime monetario e spazio fiscale. Se il
controfattuale non supera i test di pre-trend, la pagina conserva il confronto
descrittivo e abbassa la comparabilità invece di forzare un aggiustamento.

La UI deve chiamarlo “risultato economico nel periodo”, mostrare i grafici e i
punti che lo compongono e dichiarare l'attribuzione causale come non stimata.

Inflazione, condizioni europee e globali e decisioni UE entrano in tre posti
diversi, senza diventare bonus discrezionali:

- l'inflazione delle spese essenziali entra negli esiti del cittadino; reddito e
  salari restano espressi in termini reali per evitare illusioni nominali;
- ciclo dell'area euro, prezzi energetici e delle importazioni, domanda estera,
  tassi BCE e condizioni del credito descrivono lo shock comune e l'esposizione
  italiana precedente allo shock;
- regolamenti, decisioni UE e PNRR entrano nel registro delle politiche con data,
  risorse, traguardi e stato di attuazione. L'approvazione di un atto non assegna
  punti finché non esiste un risultato o una valutazione indipendente.

Le fonti candidate sono l'[IPCA mensile Eurostat](https://ec.europa.eu/eurostat/web/hicp/information-data),
le [statistiche energetiche Eurostat](https://ec.europa.eu/eurostat/web/energy/information-data),
i [tassi bancari armonizzati BCE](https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/bank_interest_rates/mfi_interest_rates/html/index.en.html),
il [Bollettino economico BCE](https://www.ecb.europa.eu/press/economic-bulletin/html/index.en.html),
lo [scoreboard ufficiale del dispositivo per la ripresa e la resilienza](https://ec.europa.eu/economy_finance/recovery-and-resilience-scoreboard/milestones_and_targets.html) e gli
atti autentici pubblicati su [EUR-Lex](https://eur-lex.europa.eu/oj/direct-access.html?locale=it).

### Come valutare le manovre

Ogni manovra deve avere una scheda con atto, destinatari, costo o copertura,
meccanismo atteso, data di attuazione, indicatore che dovrebbe muovere e fonte
indipendente. L'esito assume uno dei quattro stati:

- **effetto stimato**: valutazione causale o quasi-sperimentale adeguata;
- **contributo plausibile e quantificato**: modello ufficiale o indipendente con
  assunzioni visibili;
- **risultato coerente ma non attribuibile**: il dato si muove nella direzione
  prevista, senza controfattuale;
- **impatto non ancora quantificabile**: è noto l'atto, non l'effetto.

Sussidi e incentivi alle imprese non ricevono punti perché spendono molto. Sono
valutati attraverso addizionalità degli investimenti, produttività, occupazione,
innovazione, esportazioni, costo per risultato ed eventuali effetti di
sostituzione. Lo stesso vale per misure fiscali, bonus e tagli di imposta.

## Copertura storica: nessuna soglia rigida al 2005

Vogliamo includere anche i governi precedenti al 2005 ogni volta che le fonti lo
permettono. Non useremo però lo stesso voto per serie statistiche con qualità e
copertura diverse.

Ogni governo riceve sempre una **scheda di valutazione**. La disponibilità dei
dati decide quale parte della valutazione può diventare un numero, non se il
governo merita o meno un approfondimento. Ogni esecutivo viene inoltre assegnato
a una classe di comparabilità:

| Classe | Copertura attesa | Risultato pubblicabile |
| --- | --- | --- |
| A · completa | Indicativamente dal 2005, da confermare con l'audit | Risultato completo, cinque aree, confronto europeo e comparabilità |
| B · macro armonizzata | Indicativamente 1995-2004 | Voto macro separato, ottenuto da un paniere fisso più ristretto |
| C · storica | Prima del 1995 | Nessun voto aggregato; serie, governi, regimi e shock nel loro contesto |
| D · documentale | Copertura insufficiente o mandato troppo breve | Valutazione di eredità, contesto, decisioni e risultati disponibili; nessun aggregato artificiale |

Le date sono indicative: sarà l'audit per indicatore a stabilire il primo governo
valutabile in ogni classe. La disponibilità di una sola serie, per esempio il
PIL, non basta per produrre un voto economico complessivo.

### Regole minime di ammissibilità

- Tutti i governi hanno una pagina con situazione ereditata, periodo economico e
  geopolitico, misure adottate, risultati disponibili e limiti di attribuzione.
- Meno di quattro trimestri completi: nessun voto macro trimestrale, ma
  valutazione documentale completa delle decisioni e degli esiti osservabili.
- Da quattro a sette trimestri: risultato indicativo con comparabilità bassa.
- Da otto trimestri: voto standard, se il paniere della classe è completo.
- Nel Core annuale provvisorio è sufficiente almeno un intervallo tra due
  osservazioni annuali. Una finestra di un anno è indicativa e riceve
  comparabilità C; senza intervallo annuale non si forza un numero.
- Ogni classe usa un paniere obbligatorio fisso. Se manca un indicatore
  obbligatorio, il governo mostra un risultato parziale ma non entra nel
  confronto aggregato di quella classe.
- I voti A e B non vengono mescolati nella stessa graduatoria; la classe C non
  produce un voto aggregato.

In questo modo possiamo valutare ogni governo senza fingere che gli indicatori
disponibili per un governo di pochi mesi o degli anni Cinquanta formino la stessa
pagella dei dati trimestrali contemporanei.

## Cronologia e attribuzione temporale

La cronologia canonica parte dall'[elenco storico del Senato](https://www.senato.it/legislature/repubblica/governi-della-repubblica)
e viene verificata con i giuramenti e i comunicati del
[Quirinale](https://archivio.quirinale.it/aspr/mostre-digitali/i-giuramenti-governi)
e con la Presidenza del Consiglio.

Per ogni governo conserviamo separatamente:

- data del giuramento;
- data delle dimissioni;
- data di entrata in carica del successore;
- periodo di gestione degli affari correnti;
- Presidente del Consiglio, composizione e legislatura;
- eventuali cambi di maggioranza senza cambio di governo.

La finestra di base è la media degli ultimi quattro trimestri completi prima del
giuramento. La finestra finale è la media degli ultimi quattro trimestri completi
prima dell'insediamento del successore. Per il governo in carica si usano gli
ultimi quattro trimestri completi disponibili.

Le serie mensili usano finestre di dodici mesi. Le serie annuali conservano il
loro anno di riferimento e non vengono artificialmente distribuite sui mesi. Gli
stock, come il debito, non vengono ripartiti in base ai giorni di governo.

## Le cinque aree del voto completo

I pesi iniziali sono una scelta editoriale da validare e poi congelare nella
versione 1 del metodo.

| Area | Peso | Indicatori candidati principali |
| --- | ---: | --- |
| Potere d'acquisto | 25% | reddito disponibile reale delle famiglie per abitante; retribuzione reale per ora; consumi reali per abitante |
| Lavoro | 20% | tasso di occupazione 20-64; ore lavorate per residente in età da lavoro |
| Crescita e produttività | 20% | PIL reale per abitante; produttività reale per ora lavorata |
| Finanza pubblica | 20% | debito/PIL; saldo primario/PIL |
| Capacità futura | 15% | investimenti privati reali; investimenti pubblici reali; ricerca e sviluppo/PIL |

Inflazione, disoccupazione, inattività, occupazione femminile e giovanile,
povertà, disuguaglianza, produzione industriale, deficit e pressione fiscale
restano visibili come indicatori diagnostici. Non entrano automaticamente nel
voto se duplicano effetti già catturati, se la serie presenta rotture importanti
o se il loro significato richiede un modulo separato.

### Paniere storico

Per i periodi precedenti alla copertura completa costruiremo un paniere storico
fisso usando soltanto serie con definizioni ricostruibili e continuità sufficiente.
I candidati sono:

- PIL reale per abitante;
- inflazione o deflatore dei consumi;
- occupazione, ore lavorate o un indicatore del lavoro coerente per il periodo;
- investimenti reali;
- debito pubblico in rapporto al PIL;
- retribuzioni o consumi reali, se la serie supera l'audit.

Il paniere definitivo non verrà deciso in base ai risultati politici prodotti.
Prima sarà pubblicata una matrice governo × indicatore con copertura, rotture di
serie e qualità; poi verrà congelato il paniere della classe C.

## Fonti dei dati

La fonte viene scelta per definizione, copertura e riproducibilità, non perché
produce il risultato più favorevole.

### Risultati economici

| Dominio | Fonti primarie preferite | Uso |
| --- | --- | --- |
| Conti nazionali e famiglie | [Istat](https://www.istat.it/), [Eurostat](https://ec.europa.eu/eurostat/) | PIL, consumi, reddito disponibile, investimenti, conti settoriali |
| Lavoro e retribuzioni | Istat, Eurostat, OECD | occupazione, ore, retribuzioni e produttività |
| Prezzi | Istat ed Eurostat | NIC/FOI per il contesto italiano, IPCA per confronti armonizzati |
| Finanza pubblica | Eurostat EDP, Banca d'Italia, MEF e RGS/OpenBDAP | debito, saldo, interessi, spesa e misure di bilancio |
| Confronti internazionali | Eurostat, [AMECO](https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database/download-annual-data-set-macro-economic-database-ameco_en), OECD | Italia, Francia, Germania, Spagna, area euro e serie annuali storiche |
| Previsioni | Istat, Banca d'Italia, Commissione europea, OECD, FMI | scenari correnti e vintage disponibili all'insediamento |

Per la parte precedente al 1995 useremo anche le
[statistiche storiche della Banca d'Italia](https://www.bancaditalia.it/statistiche/tematiche/stat-storiche/stat-storiche-economia/index.html),
che includono ricostruzioni di contabilità nazionale, lavoro, capitale, debito e
bilancia dei pagamenti. Queste ricostruzioni devono essere etichettate come tali:
non hanno lo stesso status di una serie armonizzata corrente.

### Misure economiche dei governi

Per dire cosa un governo ha fatto useremo questa gerarchia:

1. **atto giuridico**: Gazzetta Ufficiale, Normattiva, legge di bilancio, decreto
   o regolamento;
2. **dimensione finanziaria ex ante**: relazione tecnica RGS/MEF e prospetti
   degli effetti sui saldi;
3. **spiegazione indipendente**: dossier di Camera e Senato;
4. **valutazione**: Ufficio parlamentare di bilancio, Banca d'Italia, Corte dei
   conti, Istat, Commissione europea o ricerca causale sottoposta a revisione;
5. **stato di attuazione**: Dipartimento per il programma di Governo, RGS,
   amministrazione titolare e monitoraggi specifici.

Un comunicato del governo può documentare l'obiettivo dichiarato o lo stato
amministrativo, ma non costituisce da solo una valutazione indipendente
dell'effetto economico.

### Contratto minimo di ogni osservazione

Ogni valore acquisito deve conservare:

```text
source_id
series_id
definition
unit
frequency
geography
reference_period
published_at
observed_at
ingested_at
vintage
seasonal_adjustment
methodology_version
breaks_and_revisions
transformation
source_url
raw_hash
limitations
```

Raw, normalized e semantic layer restano separati secondo l'architettura
esistente del progetto. Un aggiornamento non sostituisce l'ultimo snapshot
valido finché schema, copertura, riconciliazioni e test non sono superati.

## Algoritmo del voto

### La valutazione viene prima del voto

La scheda segue sempre cinque passaggi distinti:

1. **Eredità**: baseline, traiettoria dei periodi precedenti, debito, lavoro,
   crescita e fattori già in corso all'insediamento.
2. **Contesto economico e geopolitico**: ciclo internazionale, energia, guerre,
   banche, BCE, Unione europea e shock documentati.
3. **Risposta del governo**: atti approvati, dimensione finanziaria, attuazione,
   meccanismo atteso e continuità con governi precedenti o successivi.
4. **Risultati durante il mandato**: valori iniziali e finali, variazione,
   confronto storico e confronto con paesi esposti allo stesso periodo.
5. **Attribuzione**: forza dell'evidenza che collega una misura al risultato,
   ritardi plausibili e ciò che il dato non può dimostrare.

L'indice macro sintetizza soltanto il quarto passaggio, contestualizzato attraverso
storia e peer. Eredità, contesto e risposta non diventano bonus discrezionali:
servono a spiegare il risultato e limitare le
conclusioni causali. Le singole politiche possono ricevere una valutazione
separata quando esistono studi o stime indipendenti adeguate.

### 1. Variazione osservata

Per ogni indicatore `i` e governo `g` calcoliamo la variazione tra finestra
iniziale e finale. Usiamo:

- variazione logaritmica cumulata per livelli strettamente positivi;
- differenza in punti percentuali per tassi;
- differenza in punti di PIL per debito e saldi pubblici.

Ogni indicatore ha un verso esplicito: per esempio più reddito reale è positivo,
più debito/PIL è negativo. Nessun segno viene deciso dopo avere visto il
risultato.

### 2. Confronto con la storia italiana

La variazione viene confrontata con finestre storiche italiane della stessa
durata. Escludiamo tutte le finestre che si sovrappongono per una durata positiva
al periodo valutato, così gli stessi anni non contribuiscono al proprio benchmark.
Usiamo mediana e deviazione assoluta mediana
robusta (`1,4826 × MAD`), limitiamo lo z-score a `±3` e lo trasformiamo in un
punteggio `0-100` tramite la distribuzione normale standard.

### 3. Confronto internazionale

Il primo benchmark pubblico è:

- Francia;
- Germania;
- Spagna;

Calcoliamo lo scarto fra la variazione italiana e quella del benchmark nello
stesso periodo. Il confronto usa definizioni Eurostat/AMECO compatibili. Un
eventuale gruppo dinamico di Paesi verrà introdotto solo dopo e sarà selezionato
esclusivamente su caratteristiche precedenti al mandato.

### 4. Punteggio dell'indicatore

Per ogni indicatore del Core:

```text
indicatore = 50% punteggio_storico + 50% punteggio_relativo_ai_peer
```

Se il confronto internazionale o il paniere obbligatorio non sono completi,
non viene pubblicato alcun risultato aggregato. I dati disponibili restano visibili
come storia, senza trasformare una copertura parziale in un confronto.

### 5. Punteggio delle aree e totale

Il punteggio complessivo della classe A è:

```text
totale =
  25% potere_acquisto +
  20% lavoro +
  20% crescita_produttivita +
  20% finanza_pubblica +
  15% capacita_futura
```

Il risultato non viene moltiplicato per un coefficiente politico di
"controllabilità". Comparabilità dei dati e attribuzione causale sono due campi
separati: la prima descrive la precisione del confronto, la seconda resta “non
stimata” finché non esiste una valutazione causale specifica.

### 6. Robustezza

Per ogni governo vengono calcolate automaticamente dieci varianti:

- tutti gli indicatori con pesi uguali;
- sei risultati, ciascuno senza uno degli indicatori;
- tre risultati, ciascuno senza uno dei peer.

Il minimo e il massimo formano l'intervallo di stress. Lo scarto massimo dal
risultato base produce un'etichetta esplicita: stabile fino a 5 punti, sensibile
fra 5 e 10, molto sensibile oltre 10. Queste soglie descrivono la robustezza del
numero e non l'affidabilità dell'attribuzione politica.

## Shock e contesto storico

Gli shock non producono sconti manuali al voto. Nell'implementazione corrente il
registro è descrittivo: non cambia peer, pesi o risultato. Mostra l'esposizione
iniziale e rende espliciti i limiti dell'attribuzione.

Il registro deve includere almeno:

- ricostruzione e boom economico;
- fine di Bretton Woods;
- shock petroliferi del 1973 e 1979;
- inflazione e indicizzazione salariale;
- crescita del debito negli anni Ottanta;
- crisi della lira e dello SME del 1992;
- convergenza a Maastricht e introduzione dell'euro;
- globalizzazione e crisi dot-com;
- crisi finanziaria globale 2007-2009;
- crisi dei debiti sovrani 2010-2013;
- crisi bancaria, sofferenze e restrizione del credito;
- quantitative easing e politiche BCE;
- pandemia Covid-19;
- strozzature delle catene di fornitura;
- Superbonus e crediti fiscali differiti;
- PNRR;
- crisi energetica, guerre e sanzioni;
- rialzi dei tassi BCE;
- demografia, terremoti e altri disastri documentati.

Quando possibile l'esposizione viene misurata prima dello shock: dipendenza dalle
importazioni energetiche, quota export, fabbisogno di rifinanziamento, condizioni
del sistema bancario o spazio fiscale ereditato.

## Registro delle misure economiche

La pagella dei risultati e il registro delle politiche sono collegati, ma non
fusi. Per ogni governo selezioniamo le misure economicamente più rilevanti in
base a criteri pubblici:

- impatto finanziario ex ante;
- numero di persone o imprese coinvolte;
- rilevanza strutturale;
- valutazione indipendente disponibile;
- durata degli effetti;
- relazione con una delle cinque aree della pagella.

Ogni misura conserva:

```text
measure_id
government_id
title
legal_act
introduced_at
enacted_at
implemented_at
expired_at
status
objective
economic_channel
fiscal_cost_or_saving
reference_years
population_or_firms_covered
inherited_from_previous_government
continued_by_successor
ex_ante_expected_effect
observed_outcome
causal_evidence_grade
source_ids
caveats
```

La scheda distingue:

- **annunciata**;
- **approvata**;
- **finanziata**;
- **attuata**;
- **valutata**.

Una misura può essere presentata come "ha contribuito" solo quando una fonte
indipendente quantifica almeno il meccanismo o l'effetto. In assenza di questa
evidenza scriveremo "aveva l'obiettivo di" o "la fonte associa a", senza
trasformare la sequenza temporale in causalità.

Per ogni governo mostreremo tre-cinque misure principali e tre-cinque fattori di
contesto. Includeremo anche effetti negativi, costi futuri o risultati ambigui:
selezionare soltanto ciò che sembra avere aiutato renderebbe la pagina
promozionale e non verificabile.

La responsabilità viene divisa quando necessario. Per esempio, una misura
progettata da un governo, approvata da un altro e attuata da un terzo conserva
tutti e tre i passaggi. Il PNRR non viene attribuito integralmente al governo che
si trova in carica quando una rata o un investimento produce effetti.

## Governo in carica e previsione

Il governo in carica ha tre blocchi distinti.

### Risultato osservato finora

Usa soltanto dati pubblicati e gli ultimi quattro trimestri completi. È
ricalcolato a ogni nuovo snapshot e porta sempre le etichette:

- `provvisorio`;
- `dati fino al ...`;
- `metodo v...`;
- `vintage dati ...`.

Non viene trattato come risultato definitivo di un governo concluso.

### Traiettoria dei prossimi 12-24 mesi

Non creeremo inizialmente una previsione proprietaria opaca. Mostreremo le
previsioni ufficiali di Istat, Banca d'Italia, Commissione europea, OECD e FMI,
con:

- data di pubblicazione e data limite delle informazioni usate;
- scenario centrale;
- intervallo fra le istituzioni;
- principali assunzioni;
- scenario avverso, quando pubblicato;
- differenza rispetto alla previsione precedente.

Il prodotto può calcolare un **punteggio di traiettoria** applicando il metodo
agli indicatori previsti, ma deve essere chiamato previsione e non sommato al
voto osservato. L'orizzonte è fisso a 12 o 24 mesi: non assumiamo una data futura
di fine del governo.

Nel prototipo annuale AMECO lo scenario viene pubblicato soltanto se sono
presenti tutte le 72 celle richieste: sei indicatori, quattro paesi e tre anni
2025-2027. Una copertura parziale non invalida i risultati osservati, ma rende la
previsione non pubblicabile e viene dichiarata come tale nel registro fonti.

### Misure e stato di attuazione

Mostra le misure approvate dal governo in carica, il loro stato e la valutazione
indipendente disponibile. Il numero di decreti attuativi adottati misura capacità
amministrativa, non crescita economica, e resta separato dal voto economico.

## Implementazione corrente: Core annuale v4

La versione corrente usa un solo vintage coerente, **AMECO Spring
2026**, e non finge di avere già il paniere trimestrale completo. Il Core
annuale contiene:

- retribuzione reale per dipendente, peso 25%;
- disoccupazione, peso 20%;
- PIL reale per abitante, peso 20%;
- debito/PIL e saldo primario/PIL, 10% ciascuno;
- investimenti fissi lordi sul PIL, peso 15%.

Pesi, direzioni, trasformazioni, soglie e regole di endpoint sono scelte
analitiche versionate del progetto: non sono valutazioni ufficiali di AMECO,
Eurostat o della Presidenza del Consiglio. Il manifest del metodo le blocca
insieme ai codici fonte; ogni modifica richiede una nuova versione e una review
esplicita.

Il risultato è calcolabile dal 1995 soltanto quando tutti i sei indicatori, i tre
peer e almeno un intervallo annuale tra gli endpoint sono presenti. Una finestra
di un anno è pubblicata come indicativa con comparabilità C. Francia, Germania e
Spagna formano il benchmark; mediana e MAD robusto limitano la dipendenza dagli
estremi. Nessuna finestra storica sovrapposta al mandato entra nel suo benchmark
e gli stress test sono pubblicati accanto al numero. I governi anteriori al 2005 che superano le
stesse regole sono inclusi.

Le osservazioni terminano al 2024. I valori AMECO 2025-2027 alimentano soltanto
uno scenario separato e non il voto provvisorio. Poiché una serie annuale non
può seguire esattamente il giorno del giuramento, la versione v4 usa una regola
semestrale esplicita. Se un governo inizia tra gennaio e giugno, la baseline è
l'anno precedente; se inizia tra luglio e dicembre, è l'anno di inizio, che
appartiene per la maggior parte al governo precedente. Per la fine si applica
la regola speculare rispetto al confine finale pubblicato dalla fonte. È una
approssimazione mensile: riduce, ma non elimina, i mesi attribuibili a due
governi e non ha precisione giornaliera. Per questo la comparabilità non supera
B e scende a C nei periodi con shock rilevanti o per il governo in carica.
L'attribuzione causale non viene mai dedotta da questo badge.

La pipeline `scripts/etl/government_scorecard_snapshot.py` verifica URL, ZIP,
dimensione, schema CSV, codici AMECO, copertura, paesi, pesi, cronologia, hash e
riconciliazioni prima di sostituire atomicamente lo snapshot. Nomi, ordine e
governo in carica devono coincidere con l'elenco ufficiale della Presidenza.
Poiché quella pagina non pubblica più le date dei cinque governi anteriori al
2001, quei confini sono verificati su pagine ufficiali del Portale storico della
Camera e conservati con URL, dimensione e SHA-256 separati. `startDate` ed
`endDate` indicano i confini istituzionali pubblicati: non sono date di
dimissioni individuali né prove di responsabilità causale. Un nuovo governo o
un disallineamento blocca il refresh. Il runtime applica un secondo contratto
fail-closed. Il refresh schedulato apre una proposta di aggiornamento, senza
pubblicare silenziosamente dati non validati.

La pipeline `scripts/etl/government_current_signals.py` acquisisce invece il
JSON-stat Eurostat e valida origine, query, identità del dataset, unità,
categorie, paesi, continuità mensile e presenza di ogni osservazione. Timestamp
e hash della risposta restano nello snapshot; un drift della fonte blocca
l'aggiornamento.

Il controllo automatico del Core viene eseguito ogni settimana, ma AMECO viene
aggiornato con i principali esercizi previsivi della Commissione, normalmente
primavera e autunno: controllare più spesso non crea osservazioni nuove. Per il
cruscotto corrente il primo flusso IPCA controlla ogni settimana se è disponibile
un nuovo mese; la pubblicazione Eurostat resta mensile. Le prossime pipeline
seguiranno il calendario della singola fonte: tassi bancari ogni mese; lavoro,
reddito, risparmio e conti nazionali ogni trimestre; casa, demografia e
migrazione ogni anno. Ogni nuova release genera un candidato validato e una proposta revisionabile, non una
pubblicazione cieca.

## Fotografia corrente da usare per validare il prototipo

Alla data di aggiornamento di questa nota, **29 agosto 2026**, la
[pagina istituzionale della Presidenza del Consiglio](https://presidenza.governo.it/AmministrazioneTrasparente/Organizzazione/OrganiIndirizzoPolitico/index.html)
indica il Governo Meloni in carica dal 22 ottobre 2022. Questa informazione deve
arrivare dal registro istituzionale, non essere scritta permanentemente nel
componente UI.

Le fonti ufficiali mostrano già perché previsione e risultato osservato devono
restare separati:

- il [Bollettino economico di Banca d'Italia di luglio 2026](https://www.bancaditalia.it/pubblicazioni/bollettino-economico/2026-3/index.html)
  registra crescita del PIL dello 0,3% nel primo trimestre e un rallentamento
  stimato nel secondo; descrive condizioni del lavoro ancora positive, ma anche
  inflazione al 3% nel secondo trimestre e un rapporto debito/PIL atteso in
  aumento nel 2026;
- le proiezioni di giugno di Banca d'Italia indicano nello scenario di base una
  crescita corretta per i giorni lavorativi dello 0,5% nel 2026 e dello 0,4% nel
  2027;
- la [previsione Istat di giugno 2026](https://www.istat.it/comunicato-stampa/prospettive-delleconomia-italiana-anni-2026-2027/)
  indica +0,7% per il PIL sia nel 2026 sia nel 2027, investimenti +2,2% nel 2026
  sostenuti dagli interventi connessi al PNRR, occupazione in rallentamento ma
  ancora crescente e inflazione in aumento;
- il [monitoraggio governativo aggiornato al 30 giugno 2026](https://www.programmagoverno.gov.it/it/approfondimenti/monitoraggio-dello-stato-di-attuazione/relazioni-sul-monitoraggio-del-governo-meloni/)
  documenta lo stato dei provvedimenti e dei decreti attuativi, ma va trattato
  come fonte del governo e non come prova indipendente dell'impatto economico;
- i dossier parlamentari sulla
  [legge di bilancio 2026](https://temi.camera.it/leg19/provvedimento/la-legge-di-bilancio-2026.html)
  permettono di ricostruire le misure, gli anni finanziari e gli effetti attesi
  sui saldi.

Questa fotografia resta più ampia del Core annuale del Governo Meloni. Serve a
interpretare il numero: la crescita è contenuta, il lavoro presenta segnali
migliori, gli investimenti ricevono sostegno dal PNRR, l'inflazione energetica e
il debito introducono rischi, e le istituzioni pubblicano previsioni diverse.
L'interfaccia mostra questa composizione e segnala che il Core non è ancora la
pagella socio-economica completa.

Tra le misure da censire per il Governo Meloni, verificandone atto, dimensione,
attuazione ed eventuale effetto indipendente, rientrano almeno:

- modifiche a cuneo fiscale e IRPEF nelle leggi di bilancio;
- attuazione e revisione del PNRR, distinguendo misure ereditate e decisioni del
  governo in carica;
- incentivi agli investimenti, inclusi Transizione 5.0 e ZES unica;
- interventi energetici e riduzioni temporanee delle accise;
- percorso di riduzione del disavanzo e gestione del debito;
- rifinanziamenti con impatto su sanità, contratti pubblici e sostegno ai
  redditi.

L'elenco indica il perimetro di ricerca, non afferma che ogni misura abbia già
prodotto un miglioramento misurabile.

## Come mostrarlo agli utenti

### Pagina `/governi`

La pagina segue una gerarchia unica, dal presente alla verifica:

1. governo attualmente in carica e micro-spiegazione della valutazione;
2. dati osservati del governo attuale, prezzi mensili e scenario separato;
3. situazione ereditata;
4. contesto economico e geopolitico;
5. misure adottate e prove disponibili;
6. archivio degli altri governi;
7. confronto diretto fra due governi e confronto dettagliato con i peer;
8. formula, provenienza dei dati, dati ancora esclusi e disclaimer.

La sigla tecnica di comparabilità non viene mostrata da sola. L'interfaccia usa
invece etichette leggibili, periodo, stress test e limiti dell'attribuzione.

L'archivio non dichiara un vincitore: apre la scheda di ogni governo e il
confronto sovrapposto fra due periodi scelti dall'utente.

### Pagina `/governi/[governo]`

Ordine consigliato:

1. risultato nel periodo, comparabilità e stress test;
2. tre frasi: miglioramenti, peggioramenti, contesto;
3. cinque aree con contributo al voto;
4. Italia rispetto ai peer;
5. dati iniziali e finali, con unità;
6. misure economiche principali e stato di attuazione;
7. shock ed eredità;
8. previsione, solo per il governo in carica;
9. sensibilità a pesi, indicatori e peer;
10. fonti, dataset, revisioni e formula;
11. riquadro permanente **Cosa questo voto non dimostra**.

Il linguaggio deve essere concreto. Per esempio:

> Durante il governo il tasso di occupazione è aumentato di X punti. Nello stesso
> periodo è aumentato di Y nel gruppo di confronto. Il dato descrive il periodo,
> ma non isola l'effetto delle singole politiche.

Non useremo frasi come "il governo ha creato X punti di PIL" senza una valutazione
causale specifica.

### Livelli di approfondimento

- **Subito comprensibile:** risultato, intervallo di sensibilità e sei indicatori.
- **Verificabile:** grafici, valori iniziali/finali, peer e misure.
- **Auditabile:** formula, dati scaricabili, query API/MCP, vintage, hash e
  revisioni.

## API, MCP e assistente

I dati devono essere pubblicati dagli stessi adapter usati dalla UI. Dataset
previsti:

```text
governi_cronologia
governi_indicatori
governi_punteggi
governi_misure
governi_shock
governi_previsioni
```

Il MCP resta in sola lettura e consente di risalire dal voto alle osservazioni.
L'assistente può rispondere a domande come "perché questo governo ha ricevuto
questo voto?" soltanto usando questi record verificati. Non deve generare
spiegazioni causali libere o completare dati mancanti.

## Ordine di sviluppo

### Fase 1 — audit e metodo congelato

- matrice di copertura per tutti i governi dal 1946;
- cronologia canonica;
- dizionario degli indicatori;
- classi di comparabilità;
- pesi e formule versionati;
- criteri di selezione delle misure;
- revisione metodologica indipendente prima dei risultati pubblici.

### Fase 2 — pipeline moderna

- acquisizione Istat, Eurostat, Banca d'Italia e AMECO;
- snapshot, provenance e test;
- calcolo della classe A e B;
- confronto Francia/Germania/Spagna/area euro;
- analisi di sensibilità.

### Fase 3 — estensione storica

- acquisizione delle ricostruzioni storiche;
- audit delle rotture di serie;
- dashboard storica senza voto aggregato;
- nessuna classifica fra epoche non confrontabili.

### Fase 4 — misure economiche

- registro atti e relazioni tecniche;
- costo o risparmio per anno;
- stato di attuazione;
- valutazioni indipendenti;
- attribuzione condivisa fra governi quando necessaria.

### Fase 5 — governo in carica e previsioni

- risultato provvisorio osservato;
- archivio dei vintage previsivi;
- consenso e intervallo fra istituzioni;
- scenari avversi;
- ricalcolo automatico senza fondere previsione e consuntivo.

### Fase 6 — pubblicazione

- UI accessibile;
- API e MCP;
- download dei dati;
- pagina metodologia;
- revision history;
- test deterministici del calcolo e test browser delle spiegazioni.

Durante lo sviluppo possiamo usare alcuni governi di epoche diverse per testare
il metodo internamente. La prima pubblicazione non deve però scegliere soltanto
governi convenienti: deve includere tutti quelli che superano le stesse regole
di ammissibilità.

## Condizioni per considerare il sistema pronto

- Lo stesso input e la stessa versione producono lo stesso voto.
- Ogni numero è riconducibile a un'osservazione originale.
- Una revisione della fonte crea un nuovo vintage e non cancella il precedente.
- Nessun governo incompleto riceve un voto completo.
- Le classi storiche non vengono confrontate come se fossero equivalenti.
- Le misure hanno atto, costo, stato e fonte indipendente chiaramente distinti.
- Il voto provvisorio non contiene valori previsti.
- La previsione mostra fonte, data, intervallo e assunzioni.
- Le conclusioni cambiano in modo visibile quando sono sensibili ai pesi.
- La UI spiega sempre cosa il voto non può dimostrare.

## Decisione proposta

Costruire una pagella completa dal periodo in cui il paniere moderno supera
l'audit; usare nel frattempo il Core annuale dal 1995 come risultato distinto;
pubblicare per ogni governo una scheda di eredità, contesto, risposta e risultati;
lasciare senza aggregato soltanto le finestre in cui il dato non consente un
numero difendibile.

Per il governo in carica mostrare contemporaneamente, ma senza sommarli:

1. risultato osservato finora;
2. confronto con peer e storia;
3. previsione ufficiale a 12-24 mesi;
4. misure approvate, attuazione ed evidenza disponibile;
5. shock, eredità e limiti di attribuzione.

Questa soluzione mantiene la forza comunicativa della "pagella", ma rende ogni
voto contestabile sui dati e verificabile nel metodo invece di trasformarlo in
un giudizio editoriale opaco.

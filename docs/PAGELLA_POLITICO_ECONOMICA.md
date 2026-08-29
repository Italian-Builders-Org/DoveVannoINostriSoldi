# Pagella politico-economica dei governi italiani

## Stato del documento

Questa nota definisce la strategia e documenta la prima implementazione della
pagella economica dei governi italiani. La pagina `/governi` calcola oggi un
**Core macroeconomico annuale sperimentale** con dati AMECO reali, fonti
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

Il nome pubblico può essere **Pagella economica dei governi**. La definizione
metodologica deve però restare **risultati economici osservati durante il
governo**, per non suggerire un'attribuzione causale automatica.

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
- Il metodo viene congelato prima di calcolare la prima classifica pubblica.
- Il governo in carica riceve soltanto un risultato **provvisorio** e distinto
  dalla previsione.

## Copertura storica: nessuna soglia rigida al 2005

Vogliamo includere anche i governi precedenti al 2005 ogni volta che le fonti lo
permettono. Non useremo però lo stesso voto per serie statistiche con qualità e
copertura diverse.

Ogni governo viene assegnato a una classe di comparabilità:

| Classe | Copertura attesa | Risultato pubblicabile |
| --- | --- | --- |
| A · completa | Indicativamente dal 2005, da confermare con l'audit | Voto complessivo, cinque aree, confronto europeo e affidabilità |
| B · macro armonizzata | Indicativamente 1995-2004 | Voto macro separato, ottenuto da un paniere fisso più ristretto |
| C · storica | Prima del 1995 | Nessun voto aggregato; serie, governi, regimi e shock nel loro contesto |
| D · contesto | Copertura insufficiente o mandato troppo breve | Nessun voto; cronologia, indicatori disponibili, shock e misure |

Le date sono indicative: sarà l'audit per indicatore a stabilire il primo governo
valutabile in ogni classe. La disponibilità di una sola serie, per esempio il
PIL, non basta per produrre un voto economico complessivo.

### Regole minime di ammissibilità

- Meno di quattro trimestri completi: nessun voto complessivo.
- Da quattro a sette trimestri: voto indicativo con affidabilità bassa.
- Da otto trimestri: voto standard, se il paniere della classe è completo.
- Per serie soltanto annuali, un governo deve coprire almeno due anni completi.
- Ogni classe usa un paniere obbligatorio fisso. Se manca un indicatore
  obbligatorio, il governo mostra un risultato parziale ma non entra nella
  classifica di quella classe.
- I voti A e B non vengono mescolati nella stessa graduatoria; la classe C non
  produce un voto aggregato.

In questo modo possiamo andare indietro nella storia senza fingere che gli
indicatori disponibili per un governo degli anni Cinquanta formino la stessa
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

### 1. Variazione osservata

Per ogni indicatore `i` e governo `g` calcoliamo la variazione tra finestra
iniziale e finale. Usiamo:

- variazione logaritmica annualizzata per livelli strettamente positivi;
- differenza in punti percentuali per tassi;
- differenza in punti di PIL per debito e saldi pubblici.

Ogni indicatore ha un verso esplicito: per esempio più reddito reale è positivo,
più debito/PIL è negativo. Nessun segno viene deciso dopo avere visto il
risultato.

### 2. Confronto con la storia italiana

La variazione viene confrontata con finestre storiche italiane della stessa
durata. Usiamo mediana e deviazione assoluta mediana per ridurre l'effetto degli
trasformato in un punteggio `0-100`.

### 3. Confronto internazionale

Per la classe A il primo benchmark pubblico è:

- Francia;
- Germania;
- Spagna;
- area euro al netto dell'Italia, quando disponibile.

Calcoliamo lo scarto fra la variazione italiana e quella del benchmark nello
stesso periodo. Il confronto usa definizioni Eurostat/AMECO compatibili. Un
eventuale gruppo dinamico di Paesi verrà introdotto solo dopo e sarà selezionato
esclusivamente su caratteristiche precedenti al mandato.

### 4. Punteggio dell'indicatore

Per la classe A:

```text
indicatore = 50% punteggio_storico + 50% punteggio_relativo_ai_peer
```

Se il confronto internazionale o il paniere obbligatorio non sono affidabili,
non viene pubblicato alcun voto aggregato. I dati disponibili restano visibili
come storia, senza trasformare una copertura parziale in una classifica.

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

Il voto non viene moltiplicato per un coefficiente politico di
"controllabilità". Controllabilità, qualità e ritardi dei dati determinano un
badge di affidabilità, non uno sconto matematico invisibile.

### 6. Robustezza

Prima della pubblicazione calcoliamo almeno questi scenari di peso:

- base;
- pesi uguali;
- maggiore peso sociale;
- maggiore peso alla crescita;
- maggiore peso alla finanza pubblica;
- maggiore peso agli investimenti futuri.

La pagina mostra se il governo rimane nella stessa fascia oppure cambia molto al
cambiare dei pesi. Se il risultato è instabile, questa informazione deve essere
visibile accanto al voto.

## Shock e contesto storico

Gli shock non producono sconti manuali al voto. Vengono usati per scegliere il
confronto corretto, mostrare l'esposizione iniziale e spiegare i limiti
dell'attribuzione.

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

Non entra nella classifica definitiva dei governi conclusi.

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

### Misure e stato di attuazione

Mostra le misure approvate dal governo in carica, il loro stato e la valutazione
indipendente disponibile. Il numero di decreti attuativi adottati misura capacità
amministrativa, non crescita economica, e resta separato dal voto economico.

## Prima implementazione: Core annuale v1

La prima versione pubblicabile usa un solo vintage coerente, **AMECO Spring
2026**, e non finge di avere già il paniere trimestrale completo. Il Core
annuale contiene:

- retribuzione reale per dipendente, peso 25%;
- disoccupazione, peso 20%;
- PIL reale per abitante, peso 20%;
- debito/PIL e saldo primario/PIL, 10% ciascuno;
- investimenti fissi lordi sul PIL, peso 15%.

Il punteggio è calcolabile dal 1995 soltanto quando tutti i sei indicatori, i tre
peer e almeno due anni tra gli endpoint sono presenti. Francia, Germania e
Spagna formano il benchmark; mediana e MAD robusto limitano la dipendenza dagli
estremi. I governi anteriori al 2005 che superano le stesse regole sono inclusi.

Le osservazioni terminano al 2024. I valori AMECO 2025-2027 alimentano soltanto
uno scenario separato e non il voto provvisorio. Poiché una serie annuale non
può seguire esattamente il giorno del giuramento, la versione v1 usa l'anno di
inizio o fine soltanto quando il governo ne copre almeno metà; questa
approssimazione impedisce un'affidabilità superiore a B e porta a C nei periodi
con shock rilevanti o per il governo in carica.

La pipeline `scripts/etl/government_scorecard_snapshot.py` verifica URL, ZIP,
dimensione, schema CSV, codici AMECO, copertura, paesi, pesi, cronologia, hash e
riconciliazioni prima di sostituire atomicamente lo snapshot. Il runtime applica
un secondo contratto fail-closed. Il refresh schedulato apre una proposta di
aggiornamento, senza pubblicare silenziosamente dati non validati.

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

La prima pagina è implementata come sintesi leggibile prima della tabella. Mostra:

- governo e periodo;
- voto e classe di comparabilità;
- stato finale, provvisorio o non valutabile;
- affidabilità A, B o C;
- una frase su cosa è migliorato;
- una frase su cosa è peggiorato;
- il principale shock del periodo.

In una fase successiva l'utente potrà filtrare per epoca e aprire classifiche
soltanto all'interno della stessa classe di comparabilità.

### Pagina `/governi/[governo]` (fase successiva)

Ordine consigliato:

1. voto complessivo e affidabilità;
2. tre frasi: miglioramenti, peggioramenti, contesto;
3. cinque aree con contributo al voto;
4. Italia rispetto ai peer;
5. dati iniziali e finali, con unità;
6. misure economiche principali e stato di attuazione;
7. shock ed eredità;
8. previsione, solo per il governo in carica;
9. sensibilità ai pesi;
10. fonti, dataset, revisioni e formula;
11. riquadro permanente **Cosa questo voto non dimostra**.

Il linguaggio deve essere concreto. Per esempio:

> Durante il governo il tasso di occupazione è aumentato di X punti. Nello stesso
> periodo è aumentato di Y nel gruppo di confronto. Il dato descrive il periodo,
> ma non isola l'effetto delle singole politiche.

Non useremo frasi come "il governo ha creato X punti di PIL" senza una valutazione
causale specifica.

### Livelli di approfondimento

- **Subito comprensibile:** voto, cinque aree e tre frasi.
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
estendere all'indietro dati e contesto senza un voto aggregato; lasciare senza
voto i governi per cui copertura o durata non reggono.

Per il governo in carica mostrare contemporaneamente, ma senza sommarli:

1. risultato osservato finora;
2. confronto con peer e storia;
3. previsione ufficiale a 12-24 mesi;
4. misure approvate, attuazione ed evidenza disponibile;
5. shock, eredità e limiti di attribuzione.

Questa soluzione mantiene la forza comunicativa della "pagella", ma rende ogni
voto contestabile sui dati e verificabile nel metodo invece di trasformarlo in
un giudizio editoriale opaco.

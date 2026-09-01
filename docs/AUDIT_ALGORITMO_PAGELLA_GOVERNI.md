# Audit avversariale dell'algoritmo della Pagella dei governi

Data dell'audit: 1 settembre 2026

Versione analizzata: `core-annual-v4`, commit base `7afca0a`

Perimetro: calcolo del Core macroeconomico, dati AMECO, scelta degli endpoint, normalizzazione, peer, pesi, aggregazione, stress test e significato pubblico del risultato.

## Verdetto

L'implementazione e la filiera dati sono solide sul piano ingegneristico: il metodo è versionato, il paniere è fisso, la provenienza è verificabile, i dati mancanti fanno fallire il calcolo e il risultato è scomponibile. Il numero, però, **non è ancora difendibile come “pagella” di un governo**.

Può essere difeso come **indice descrittivo degli esiti macroeconomici osservati durante una finestra annuale**. Non misura il contributo causale del governo e, nello stato attuale, presenta due problemi bloccanti:

1. **Il significato pubblico di 50 nel confronto con i peer è falso.** Il sito dice che 50 significa andamento in linea con Francia, Germania e Spagna. La formula assegna 50 a una performance relativa uguale alla mediana storica dell'Italia, non a uno scarto pari a zero. Nella finestra Meloni 2022-2024, un'Italia esattamente allineata ai peer sui sei indicatori otterrebbe circa **66,5**, non 50.
2. **Il risultato dipende troppo dalla discretizzazione annuale dei confini del mandato.** Spostare un solo endpoint statistico di un anno produce variazioni fino a 36,5 punti nei casi osservati. Gli stress test pubblicati non provano questa fonte di incertezza e possono quindi chiamare “stabile” un risultato che non è stabile rispetto alla finestra temporale.

Prima di presentare il numero come voto, confronto sintetico o base per giudizi sui governi, servono almeno: correzione della semantica peer, analisi degli endpoint, analisi di correlazione e doppio conteggio, sensibilità estesa a normalizzazione/pesi/peer/vintage, e una decisione esplicita sul grado di compensazione ammesso tra dimensioni diverse.

## Cosa è stato verificato

L'audit usa come fonti autoritative:

- il [manifest metodologico](../scripts/etl/specs/government-scorecard-methodology.json), che fissa indicatori, direzioni, trasformazioni e pesi;
- il [calcolo TypeScript](../src/lib/government-scorecard.ts), che costruisce distribuzioni, normalizza, aggrega e genera gli stress test;
- lo [snapshot AMECO](../src/data/generated/government-scorecard.json), release Spring 2026, con osservazioni fino al 2024 e previsioni dal 2025;
- la [specifica delle fonti e dei dossier](../scripts/etl/specs/government-scorecard.source.json);
- i [test di dominio](../tests/government-scorecard-domain.test.mjs) e i [test ETL](../tests/etl/test_government_scorecard_snapshot.py);
- il testo effettivamente mostrato nella [pagina dei governi](../src/app/governi/page.tsx).

Come riferimento esterno per valutare un indice composito è stato usato l'[Handbook on Constructing Composite Indicators](https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html) di OECD e JRC. Il manuale chiede di legare pesi e aggregazione a un quadro teorico, analizzare correlazione e compensabilità, e includere nell'incertezza scelte come normalizzazione, inclusione degli indicatori, schema di pesatura e sistema di aggregazione. Il [COIN Tool del JRC](https://knowledge4policy.ec.europa.eu/composite-indicators/toolkit_en/coin-tool_en) applica lo stesso principio: verificare relazioni tra indicatori e robustezza rispetto alle assunzioni metodologiche.

Non sono stati valutati design visivo, accessibilità, prestazioni o affidabilità generale del sito, salvo quando il testo dell'interfaccia cambia l'interpretazione dell'algoritmo.

## Come funziona davvero l'algoritmo

### 1. Paniere e pesi

Il Core usa sei indicatori AMECO:

| Indicatore | Peso | Verso desiderato | Trasformazione |
| --- | ---: | --- | --- |
| Retribuzione reale per dipendente | 25% | maggiore | variazione logaritmica |
| Tasso di disoccupazione | 20% | minore | variazione in punti |
| PIL reale per abitante | 20% | maggiore | variazione logaritmica |
| Debito pubblico/PIL | 10% | minore | variazione in punti |
| Saldo primario/PIL | 10% | maggiore | variazione in punti |
| Investimenti totali/PIL | 15% | maggiore | variazione in punti |

I pesi sommano a 100%. Sono protetti contro modifiche accidentali dal contratto e dai test, ma il repository non fornisce una derivazione empirica, una procedura deliberativa o una funzione di benessere che giustifichi perché, per esempio, la retribuzione media valga 25% e la combinazione debito-saldo primario valga 20%.

### 2. Conversione delle date del governo in anni statistici

Per i dati annuali, l'implementazione converte le date istituzionali in due endpoint:

- se il governo inizia tra gennaio e giugno, la baseline è l'anno precedente;
- se inizia tra luglio e dicembre, la baseline è l'anno corrente;
- se termina tra gennaio e giugno, l'endpoint è l'anno precedente;
- se termina tra luglio e dicembre, l'endpoint è l'anno corrente;
- per il governo in carica, l'endpoint è l'ultimo anno osservato.

La regola è implementata in `endpointYears` e produce, per esempio:

- Prodi-I: 1995 → 1998;
- Berlusconi-II: 2000 → 2004;
- D'Alema-II: 1999 → 1999, quindi nessun punteggio;
- Meloni-I: 2022 → 2024.

È una convenzione trasparente, ma introduce una soglia discontinua: tra il 30 giugno e il 1 luglio l'endpoint statistico cambia di un anno intero.

### 3. Variazione orientata

Per ogni indicatore e Paese viene calcolata una variazione tra baseline ed endpoint.

Per retribuzione reale e PIL reale pro capite:

```text
variazione = direzione × 100 × [ln(valore finale) − ln(valore iniziale)]
```

Per disoccupazione, debito/PIL, saldo primario/PIL e investimenti/PIL:

```text
variazione = direzione × (valore finale − valore iniziale)
```

`direzione` vale +1 quando “più alto è meglio” e −1 quando “più basso è meglio”. Dopo l'orientamento, un numero maggiore è sempre trattato come migliore.

### 4. Due distribuzioni di confronto

L'algoritmo non assegna punti direttamente alla variazione. Per ogni indicatore costruisce due distribuzioni usando tutte le finestre italiane di uguale durata disponibili dal 1995 al 2024:

1. **distribuzione storica italiana**: variazioni dell'Italia;
2. **distribuzione relativa**: variazione Italia meno mediana delle variazioni di Francia, Germania e Spagna.

Le finestre che si sovrappongono positivamente al periodo valutato vengono escluse. È una protezione corretta contro l'uso diretto del periodo per definire il proprio benchmark. Le finestre possono però condividere un endpoint con il periodo e, tra loro, sono largamente sovrapposte e serialmente correlate.

### 5. Normalizzazione robusta

Ogni variazione viene trasformata in uno z-score robusto:

```text
centro = mediana(distribuzione)
MAD = mediana(|osservazione − centro|)
z = clamp((valore − centro) / (1,4826 × MAD), −3, +3)
punteggio = 100 × Φ(z)
```

`Φ` è la funzione di ripartizione della normale standard. Di conseguenza:

- 50 significa “uguale alla mediana della distribuzione usata”;
- i valori oltre ±3 MAD normalizzati saturano a circa 0,1 o 99,9;
- il punteggio è un posizionamento robusto rispetto a un benchmark, non una misura assoluta di benessere.

### 6. Componente storica e componente peer

Per ogni indicatore:

```text
punteggio indicatore = 50% × percentile storico
                      + 50% × percentile relativo ai peer
```

Il punteggio complessivo è la media pesata dei sei punteggi indicatore. Separatamente vengono pubblicate anche la media pesata dei percentili storici (“Andamento Italia”) e quella dei percentili relativi (“Italia rispetto ai peer”).

### 7. Stress test pubblicati

Per ogni governo con un risultato vengono calcolati dieci scenari:

- pesi uguali;
- esclusione, uno alla volta, dei sei indicatori;
- esclusione, uno alla volta, dei tre peer.

La massima distanza dal risultato base genera l'etichetta:

- stabile: deviazione massima ≤ 5;
- sensibile: deviazione massima ≤ 10;
- molto sensibile: deviazione massima > 10.

Questo è un controllo deterministico di specifiche alternative limitate. Non è un intervallo di confidenza e non misura l'incertezza complessiva del risultato.

## Ricostruzione del risultato Meloni-I

La finestra osservata è 2022 → 2024. Il risultato pubblicato è **66,3/100**, formato da:

- andamento rispetto alla storia italiana: **58,3**;
- andamento relativo ai tre peer: **74,4**;
- media 50/50: **66,3**.

| Indicatore | Peso | Storico | Peer | Indice | Contributo rispetto a 50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Retribuzione reale per dipendente | 25% | 40,1 | 36,0 | 38,0 | −2,99 |
| Disoccupazione | 20% | 81,6 | 97,8 | 89,7 | +7,94 |
| PIL reale per abitante | 20% | 54,5 | 84,7 | 69,6 | +3,92 |
| Debito/PIL | 10% | 76,2 | 45,3 | 60,8 | +1,08 |
| Saldo primario/PIL | 10% | 99,8 | 99,9 | 99,9 | +4,99 |
| Investimenti/PIL | 15% | 23,1 | 95,8 | 59,4 | +1,41 |

Le contribuzioni sommano a circa +16,3 punti rispetto al centro 50. Il risultato è quindi sostenuto soprattutto da disoccupazione, saldo primario e PIL pro capite; la retribuzione reale lo riduce. Il saldo primario è già sul tetto della trasformazione e non distingue miglioramenti ulteriori.

Gli stress test integrati producono un intervallo deterministico 60,5-75,8 e l'etichetta “sensibile”. Il valore minimo si ottiene rimuovendo la disoccupazione; il massimo rimuovendo la retribuzione reale. Rimuovere la Francia porta a 61,6, rimuovere la Spagna a 71,0. Questo dimostra che paniere e scelta dei peer incidono materialmente anche senza toccare endpoint, normalizzazione o vintage.

## Risultati dell'attacco

### F1 — Critico: “50 = in linea con i peer” non è vero

**Claim pubblico.** La pagina dice: “50 significa andamento in linea; sopra 50 migliore, sotto 50 peggiore”.

**Formula reale.** Il codice calcola prima `relative = variazione Italia − mediana peer`, poi applica `robustScore(relative, relativeWindows)`. `robustScore` assegna 50 quando `relative` è uguale alla **mediana storica delle differenze Italia-peer**, non quando `relative = 0`.

**Controesempio riproducibile.** Applicando la formula corrente a uno scarto Italia-peer pari a zero, con le distribuzioni della finestra 2022-2024:

| Indicatore | Punteggio relativo quando Italia = peer |
| --- | ---: |
| Retribuzione reale | 75,6 |
| Disoccupazione | 47,6 |
| PIL reale pro capite | 89,4 |
| Debito/PIL | 33,6 |
| Saldo primario/PIL | 64,9 |
| Investimenti/PIL | 68,8 |
| **Media pesata** | **66,5** |

Un altro caso concreto è Prodi-I: la retribuzione reale italiana cresce di circa 1,508 log-punti contro 1,813 dei peer, quindi sottoperforma di 0,305; il relativo mostrato dall'algoritmo è comunque **88,9**, perché quella sottoperformance è migliore della mediana storica italiana relativa per finestre triennali.

**Conseguenza.** Il lettore attribuisce al numero un'origine che non ha. Il risultato peer misura “quanto l'Italia è andata meglio o peggio del proprio tipico divario storico con quei peer”, non “quanto è andata meglio o peggio dei peer nel periodo”.

**Correzione minima possibile.** O si centra esplicitamente la trasformazione relativa sullo zero, mantenendo una scala robusta stimata dalla distribuzione storica, oppure si cambia tutta la semantica pubblica in “50 = mediana storica della performance relativa italiana” e si mostra accanto lo scarto corrente con segno. Per una pagina destinata ai cittadini è preferibile la prima soluzione.

### F2 — Critico: gli endpoint annuali possono dominare il giudizio

La soglia semestrale minimizza l'errore medio, ma crea salti discreti. È stata ricalcolata la stessa formula spostando di un anno uno solo degli endpoint, senza cambiare dati, pesi, peer o normalizzazione.

| Governo | Base | Finestra alternativa | Risultato alternativo | Differenza |
| --- | ---: | --- | ---: | ---: |
| Conte-II | 29,3 (2019→2020) | 2019→2021 | 65,8 | +36,5 |
| Draghi-I | 87,7 (2020→2022) | 2021→2022 | 73,7 | −14,0 |
| Draghi-I | 87,7 (2020→2022) | 2019→2022 | 63,3 | −24,3 |
| Renzi-I | 42,2 (2013→2016) | 2014→2016 | 61,5 | +19,3 |
| Prodi-II | 58,6 (2005→2007) | 2005→2008 | 36,7 | −21,9 |
| Conte-I | 56,7 (2017→2019) | 2017→2020 | 33,2 | −23,5 |
| Meloni-I | 66,3 (2022→2024) | 2022→2023 | 58,9 | −7,4 |

Le alternative non sono stime migliori del mandato: alcune includono mesi o anni fuori dal mandato. Servono a misurare la fragilità causata dall'approssimazione. In presenza di pandemia o rimbalzo post-pandemico, un solo endpoint può trasformare radicalmente il numero.

**Conseguenza.** L'etichetta di robustezza corrente può sottostimare la fragilità. Conte-I è chiamato “stabile” dagli stress test integrati (deviazione massima 4,3), ma includere l'endpoint 2020 cambia il risultato di 23,5 punti.

**Correzione raccomandata.** Per ogni mandato pubblicare un insieme di finestre plausibili e il relativo range; non pubblicare un numero singolo per i governi di grado C. In prospettiva, usare dati trimestrali coerenti per tutte le componenti oppure dichiarare che confronti tra governi con finestre brevi non sono disponibili.

### F3 — Alto: “stabile” copre solo dieci perturbazioni scelte

Gli stress test variano pesi in un solo modo, rimuovono un indicatore alla volta e rimuovono un peer alla volta. Non variano:

- endpoint;
- rapporto 50/50 tra storia e peer;
- metodo di normalizzazione e valore del cap;
- schema dei pesi entro intervalli plausibili;
- aggregazione lineare e grado di compensabilità;
- vintage AMECO;
- trasformazioni logaritmiche/in punti;
- composizione del gruppo peer oltre alla sottrazione di uno dei tre Paesi;
- trattamento di shock, rimbalzi e cambi di regime;
- correlazione e ridondanza tra indicatori.

Chiamare il risultato “stabile” senza questo perimetro esplicito può essere interpretato come robustezza generale. È invece stabilità locale rispetto a dieci scenari prefissati.

### F4 — Alto: correlazione e doppio conteggio del ciclo non sono misurati

Quattro indicatori su sei dipendono direttamente dal PIL o dalla stessa dinamica ciclica:

- PIL reale pro capite entra direttamente con peso 20%;
- debito/PIL, saldo primario/PIL e investimenti/PIL sommano un altro 35%;
- disoccupazione e retribuzione reale sono anch'esse procicliche e reagiscono con ritardi diversi.

Una recessione può quindi peggiorare contemporaneamente produzione, occupazione, saldo primario e rapporto debito/PIL. Una ripresa può produrre l'effetto opposto. La media pesata tratta queste dimensioni come sei contributi separati senza stimare correlazioni, fattori latenti o peso effettivo del ciclo.

Nel caso Draghi-I, il rimbalzo 2020-2022 porta PIL pro capite, investimenti e debito rispettivamente a 99,9, 99,9 e 99,5. Non sono tre esperimenti indipendenti; sono in parte tre manifestazioni dello stesso shock e del successivo rimbalzo.

**Conseguenza.** I pesi nominali non coincidono necessariamente con l'influenza statistica effettiva. L'indice può sovrappesare le fasi cicliche e sottopesare dimensioni meno correlate.

**Correzione raccomandata.** Pubblicare matrice di correlazione per livelli e variazioni, PCA/factor analysis come diagnostica, regressione dell'indice sui componenti e contributi alla varianza. Se la ridondanza è alta, raggruppare gli indicatori in pilastri con tetto di peso o rinunciare alla media unica.

### F5 — Alto: il paniere e i pesi incorporano giudizi normativi non giustificati

Il manifest protegge le scelte, ma non le legittima. Le direzioni “più è sempre meglio” o “meno è sempre meglio” non sono universalmente valide:

- un saldo primario più alto durante una recessione può riflettere una stretta prociclica;
- un investimento/PIL maggiore non prova qualità, addizionalità o rendimento;
- un tasso di disoccupazione minore può coesistere con uscita dalla forza lavoro, meno ore o lavoro peggiore;
- la retribuzione media per dipendente può crescere per effetto composizione se spariscono posti a bassa paga;
- debito/PIL e saldo primario dipendono da denominatore, ciclo, tassi, stock-flow adjustment e misure una tantum.

Le limitazioni sono correttamente scritte nel manifest, ma il calcolo continua ad applicare una relazione monotona e pienamente compensabile.

**Conseguenza.** Il numero è una funzione di valore scelta dagli autori, non una conseguenza neutrale dei dati. La trasparenza della formula non sostituisce la giustificazione della funzione di valore.

### F6 — Alto: il confronto con tre peer non identifica il controfattuale

Francia, Germania e Spagna sono vicine e comprensibili, ma il repository non documenta criteri ex ante per sceglierle né verifica il parallelismo pre-trattamento. La mediana di tre Paesi:

- è determinata dal Paese centrale e ignora la distanza degli altri due;
- cambia definizione quando uno viene escluso: con due Paesi la “mediana” diventa la loro media;
- non controlla differenze in struttura produttiva, demografia, dipendenza energetica, spazio fiscale o tempi degli shock;
- non è un synthetic control e non produce una stima causale.

Il fatto che la componente peer pesi 50% non risolve l'attribuzione. Riduce alcuni shock comuni, ma non quelli asimmetrici e non separa decisioni nazionali da condizioni iniziali.

### F7 — Medio-alto: benchmark mobile, retrospettivo e non stazionario

Le distribuzioni di confronto includono finestre dal 1995 al 2024, escluso il periodo valutato. Per un governo storico entrano anche anni successivi al suo mandato; per il governo corrente entrano soprattutto anni precedenti. Il benchmark attraversa:

- convergenza e introduzione dell'euro;
- crisi finanziaria e crisi sovrana;
- tassi nulli e acquisti BCE;
- pandemia, rimbalzo e shock energetico.

Finestre della stessa durata non sono necessariamente scambiabili tra questi regimi. Inoltre, aggiungere un nuovo anno osservato cambia la distribuzione e può cambiare retroattivamente tutti i punteggi storici anche a dati del mandato invariati.

Lo snapshot usa l'ultimo vintage AMECO anche per i periodi storici. Questo migliora la coerenza ex post, ma introduce revisioni non disponibili ai decisori del tempo e rende il voto riproducibile solo rispetto a quel preciso vintage.

**Correzione raccomandata.** Versionare e pubblicare ogni vintage, mostrare la variazione dei punteggi fra vintage e distinguere esplicitamente analisi ex post da informazione disponibile in tempo reale.

### F8 — Medio: il cap comprime gli estremi e crea molti quasi-pareggi

Il cap a ±3 produce punteggi minimi e massimi di circa 0,1 e 99,9. Sulle 180 componenti storico/peer dei governi con score, **22 componenti (12,2%)** sono già sotto 0,2 o sopra 99,8.

Esempi:

- Draghi-I: PIL pro capite e investimenti 99,9;
- Meloni-I: saldo primario 99,9;
- Monti-I: retribuzione, PIL pro capite e varie componenti vicine a 0,1.

Il cap protegge dagli outlier, ma rende indistinguibili esiti estremi di magnitudine diversa. La presentazione a un decimale suggerisce più precisione di quella disponibile agli estremi.

### F9 — Medio: aggregazione lineare completamente compensabile

Ogni risultato negativo può essere compensato da un risultato positivo in un'altra dimensione. Non esistono soglie minime, penalità per squilibri o regole di non compensazione.

Per Meloni-I, la retribuzione reale a 38,0 è più che compensata da disoccupazione 89,7 e saldo primario 99,9. Il modello afferma quindi implicitamente che i contributi sono scambiabili secondo i pesi fissati. Questa è una scelta politica/metodologica che deve essere esplicita e stressata con aggregazioni alternative, non una proprietà naturale dei dati.

### F10 — Medio: contesti e misure migliorano la lettura, ma non il numero

Shock e misure sono fonti contestuali, deliberatamente esclusi dal calcolo. È una scelta prudente: evita bonus e penalità manuali. Tuttavia:

- la presenza di una crisi porta al massimo a un grado C;
- il valore puntuale resta invariato;
- l'utente vede comunque un numero, un'etichetta e un confronto tra governi.

Il caveat “non prova causalità” è corretto, ma compete con il framing molto più forte di “pagella”, `/100`, “positivo/debole” e confronto per governo. Il rischio di attribuzione non viene eliminato dalla presenza di una nota metodologica in fondo alla pagina.

### F11 — Medio: le finestre storiche non sono osservazioni indipendenti

Per costruire il benchmark si usano finestre mobili adiacenti della stessa durata. Le finestre 2000-2004 e 2001-2005, per esempio, condividono quasi tutti gli anni. Il conteggio pubblicato (`historicalWindowCount`) va da 19 a 28 nei casi osservati, ma non rappresenta 19-28 esperimenti indipendenti.

L'algoritmo usa mediana e MAD, non errori standard, quindi non commette direttamente un test inferenziale scorretto. Resta però una distribuzione che sovrappesa regimi persistenti e la cui numerosità apparente non misura forza statistica.

## Cosa resiste agli attacchi

L'audit non ha trovato un algoritmo improvvisato o opaco. Questi elementi sono difendibili e vanno preservati:

1. **Provenienza forte.** Serie, codici, unità, release, hash e cronologia sono espliciti.
2. **Metodo versionato.** Pesi, direzioni, trasformazioni e peer non possono cambiare silenziosamente senza rompere contratto e test.
3. **Fail closed.** Manca uno score se manca un indicatore obbligatorio, un peer o un numero sufficiente di finestre.
4. **Separazione osservato/previsione.** Il 2025-2027 non viene mescolato con i risultati fino al 2024.
5. **Niente bonus manuali per shock o misure.** Contesto e atti non alterano arbitrariamente il numero.
6. **Esclusione del periodo dal benchmark.** Le finestre sovrapposte al mandato non definiscono direttamente il proprio score.
7. **Normalizzazione robusta.** Mediana e MAD sono meno fragili di media e deviazione standard rispetto a singoli outlier.
8. **Scomposizione.** Il numero può essere riconciliato con indicatori, pesi e contributi.
9. **Caveat causale esplicito.** Il codice dichiara correttamente che l'attribuzione non è stimata.
10. **Primi stress test reali.** Leave-one-out e pesi uguali sono utili, purché presentati come sottoinsieme e non come certificazione completa.

Queste qualità rendono il Core una buona base di ricerca. Non risolvono i difetti semantici e metodologici indicati sopra.

## Piano di correzione raccomandato

### P0 — Prima di promuovere o interpretare il numero

1. **Correggere l'asse peer.** Fare in modo che scarto zero produca 50 per ogni indicatore, oppure riscrivere fedelmente etichetta, spiegazione e legenda.
2. **Rinominare il risultato.** Fino a una validazione più forte, usare “indice degli esiti macroeconomici del periodo”, non “voto al governo”.
3. **Mostrare lo scarto grezzo.** Accanto al percentile relativo, mostrare Italia meno mediana peer con unità e segno.
4. **Non mostrare un punto unico per grado C.** Usare almeno il range delle finestre temporali plausibili.
5. **Aggiungere test semantici.** In particolare: `relativeChange = 0 ⇒ relativeScore = 50` se questa resta la promessa pubblica.

### P1 — Prima di confrontare due governi con un indice unico

1. Aggiungere sensibilità su endpoint, rapporto storia/peer, pesi, normalizzazione, cap, trasformazioni, peer e aggregazione.
2. Pubblicare una matrice di correlazione e misurare l'influenza effettiva di ogni componente.
3. Definire il paniere tramite un quadro teorico e criteri pubblici, distinguendo benessere, stabilità, crescita e sostenibilità.
4. Valutare pilastri non compensabili o un dashboard senza totale quando le dimensioni confliggono.
5. Documentare la selezione dei peer e confrontarla con gruppi alternativi o un controfattuale sintetico.
6. Versionare i risultati per vintage AMECO e quantificare le revisioni retrospettive.

### P2 — Validazione e governance

1. Preparare un protocollo di validazione ex ante e congelarlo prima di guardare i nomi dei governi associati ai risultati.
2. Far revisionare metodo, pesi e comunicazione da competenze indipendenti in statistica, economia pubblica e causal inference.
3. Pubblicare i dati intermedi necessari a riprodurre ogni distribuzione, mediana, MAD e scenario.
4. Definire condizioni di stop: se identità del “migliore/peggiore” o classe qualitativa cambia spesso nelle specifiche plausibili, non pubblicare il totale.

## Test di accettazione proposti

Una versione successiva dovrebbe soddisfare almeno questi invarianti:

1. uno scarto corrente Italia-peer pari a zero ha esattamente il significato dichiarato nell'interfaccia;
2. nessuna etichetta di stabilità è assegnata senza includere la sensibilità agli endpoint;
3. il range pubblicato include tutte le specifiche dichiarate plausibili, non solo leave-one-out;
4. pesi nominali e influenza empirica sono entrambi pubblicati;
5. il punteggio storico è riproducibile per vintage e la revisione fra vintage è visibile;
6. una classe qualitativa non viene mostrata se il suo confine cade dentro il range di sensibilità;
7. la pagina distingue sempre esito del periodo, confronto descrittivo e attribuzione causale;
8. l'aggregazione è accompagnata da una regola esplicita sulla compensabilità;
9. per mandati senza almeno una finestra temporale sufficientemente precisa viene mostrato il dossier, non il numero;
10. ogni claim dell'interfaccia ha un test che verifica la semantica, non soltanto la riconciliazione aritmetica.

## Conclusione

Il Core `core-annual-v4` è tracciabile e riproducibile, ma la sua precisione ingegneristica supera la sua validità interpretativa. Il problema più urgente non è un dato errato: è che il numero comunica una relazione con i peer diversa da quella calcolata. Il secondo problema è che una convenzione temporale ragionevole ma discreta può determinare il giudizio più dei pesi sottoposti agli stress test.

La decisione prudente è mantenere online dati, grafici, fonti, dossier e scomposizione, correggere subito la promessa “50 = in linea”, e trattare il totale come indice sperimentale degli esiti del periodo finché la robustezza estesa non dimostri che la conclusione sopravvive a endpoint, correlazioni, peer, pesi, normalizzazione e vintage.

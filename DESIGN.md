# DoveVannoINostriSoldi — Design System

## 01 Overview

**Direzione: “Il conto pubblico.”**

DoveVannoINostriSoldi è un prodotto operativo di consultazione e verifica. Deve sembrare un'infrastruttura civica contemporanea: autorevole, leggibile e densa quanto serve, senza sembrare né un portale ministeriale legacy né una dashboard cyber.

La direzione è **dati subito, fonte vicina, superfici semplici**.

La schermata deve far capire rapidamente:

1. che cosa si sta guardando;
2. qual è il dato o confronto principale;
3. da quale fonte arriva e quanto è fresco;
4. come approfondirlo fino al record originale.

Una sola metrica può dominare una superficie. Le altre diventano confronti, serie, metadata o dettagli. Grafici e mappe devono ridurre il tempo necessario per capire un pattern, mai decorare uno spazio vuoto.

Il tricolore è una firma di identità. Non è la palette predefinita delle visualizzazioni.

## 02 Colors

La palette è blu-notte istituzionale con accenti freddi desaturati. Evitare nero puro, bianco puro, neon, glow e colori eccessivamente saturi.

### Core tokens

- `--bg: #06131f` — fondo applicazione;
- `--bg-deep: #030c14` — fondo più profondo;
- `--panel: rgba(8, 29, 46, .84)` — superficie primaria;
- `--panel-2: rgba(11, 38, 60, .72)` — superficie secondaria;
- `--line: rgba(123, 184, 221, .16)` — separatore;
- `--line-strong: rgba(123, 184, 221, .28)` — separatore/focus secondario;
- `--text: #f4f8fb` — testo principale;
- `--muted: #93a9b8` — testo secondario;
- `--blue: #55b8ef` — azione e informazione primaria;
- `--green: #6ee7a8` — fonte verificata / stato positivo;
- `--amber: #f0c56c` — attenzione / integrazione incompleta;
- `--violet: #a78bda` — scenario o scelta di policy;
- `--red: #ff7a7a` — errore o variazione negativa, non “colpevolezza”.

### Data visualization tokens

- `--chart-primary: #72aeca`;
- `--chart-secondary: #78ad8d`;
- `--chart-tertiary: #c3a66c`;
- `--chart-policy: #a78bda`;
- `--chart-negative: #ca7d7d`.

Nelle pagine di audit i colori hanno un significato stabile: blu per dati osservati,
ambra per aree da approfondire, viola per scenari di policy e rosso attenuato per stock
o passività. Testo e spiegazione accompagnano sempre il colore.

Le serie devono avere luminosità comparabile e il colore deve significare qualcosa. Non usare automaticamente rosso/verde per giudicare enti o persone. Il colore non può essere l'unico mezzo per comunicare uno stato.

Niente gradient text. Niente palette viola/ciano da “AI dashboard”. I gradienti di sfondo già presenti possono essere usati solo come profondità ambientale molto discreta e non come sostituto della gerarchia.

## 03 Typography

Font principale: stack di sistema.

`ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

Monospace soltanto per identificativi tecnici come CIG, CUP, Codice IPA, codice fiscale, resource ID ed endpoint.

### Ramp

- display: `clamp(44px, 6vw, 76px)`, peso 520–580, tracking negativo controllato;
- page title: `clamp(34px, 5vw, 62px)`, peso 540–580;
- section title: 20–28px;
- component title: 14–18px;
- body: 13–16px, line-height 1.55–1.75;
- metadata e label: minimo 11px;
- identificativi monospace: minimo 11px.

Uppercase soltanto per metadata brevi. Evitare eyebrow celebrativi e marker numerici decorativi. I numeri grandi sono riservati alle metriche che dominano davvero la vista, non a una griglia di KPI tutti equivalenti.

## 04 Elevation

**Flat by default.**

La struttura nasce da ritmo, separatori e differenza di superficie, non da ombre e card annidate.

- radius principale: 8–11px;
- pill radius ammesso solo per badge/stati;
- ombre: rare e leggere, principalmente per tooltip, overlay o stato flottante;
- niente border + shadow pesante sullo stesso contenitore;
- niente glassmorphism;
- niente glow sugli accenti;
- non racchiudere ogni gruppo in una card: usare righe, separatori e definizioni piatte quando basta.

Focus: anello visibile con `--focus-ring`, senza affidarsi al solo cambio colore.

## 05 Components

### Navigation

Header sticky, brand compatto, un livello di navigazione principale. La ricerca globale futura deve diventare un'azione primaria senza trasformare l'header in una toolbar affollata.

### Search

Campo ampio, label accessibile, stato focus evidente, bottone con feedback press `scale(.97)`. Nessuna animazione di apertura per una ricerca usata frequentemente.

### Entity rows

Le liste di enti sono righe navigabili, non “card gallery”. Mostrare denominazione e Codice IPA come identità primaria; tipologia e sede sono colonne secondarie. Su mobile si riduce la densità senza eliminare il percorso al dettaglio.

### Source provenance

Ogni vista dati deve poter mostrare titolare, dataset, data di osservazione, data di riferimento quando disponibile, identificativo sorgente e collegamento originale. Provenance e metodologia non devono essere nascoste in un footer legale.

### Charts

Libreria standard: **Recharts** per dashboard statiche e interattive. Liveline è riservato a vere serie streaming se una sorgente futura le offrirà.

Regole:

- nessun grafico senza fonte, data e unità;
- nessuna serie economica fittizia o dimostrativa in produzione;
- niente animazione decorativa dei dati al primo render;
- grid line secondarie;
- assi abbreviati, tooltip con valore esatto;
- tooltip compatto con contrasto elevato;
- legenda soltanto quando più serie reali la richiedono;
- distinguere euro, percentuali, pro capite, valori cumulati e valori periodali;
- esplicitare competenza/cassa quando il dataset lo richiede;
- stato vuoto leggibile quando il dato non esiste;
- equivalente semantico/testuale sufficiente per accessibilità.

### Maps

La mappa serve per drill-down territoriale. Confini, colori e marker devono derivare da dati reali o dallo stato di copertura. Vietati punti luminosi puramente decorativi presentati come attività finanziaria.

### Status

Vocabolario:

- **Fonte attiva**;
- **In integrazione**;
- **Dato non disponibile**;
- **Da verificare**.

Non produrre automaticamente etichette come “corrotto”, “illecito” o “spreco”.

### Motion

- animare soltanto per feedback, continuità spaziale o comprensione;
- enter/exit occasionali: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`;
- movimento sullo schermo: `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`;
- press: `scale(.97)`;
- UI normalmente sotto 300ms;
- mai `transition: all`;
- mai `ease-in` per feedback UI;
- azioni frequenti devono essere istantanee o quasi;
- rispettare sempre `prefers-reduced-motion`.

## 06 Do's and Don'ts

### Do

- dare più peso visivo al dato che risponde alla domanda della pagina;
- usare tabelle, righe e piccoli multipli quando sono più leggibili di una card grid;
- mostrare freschezza e provenienza accanto ai dati;
- progettare overview → drill-down → fonte originale;
- conservare sufficiente densità informativa su desktop;
- mantenere tutte le funzioni essenziali su mobile;
- usare stati vuoti onesti;
- usare grafici soltanto quando accelerano un confronto;
- applicare focus visibile, target principali di circa 44px e supporto tastiera;
- mantenere il linguaggio sobrio, italiano e verificabile.

### Don't

- nested cards non necessarie;
- status-chip soup;
- body text o metadata sotto 11px;
- palette cyan/neon su dark mode;
- gradient text, glow o glassmorphism;
- hero di marketing generici nella parte operativa del prodotto;
- gerarchia piatta con KPI tutti dello stesso peso;
- bordi, radius e ombre applicati a ogni elemento;
- micro-animazioni continue;
- animare numeri finanziari per spettacolo;
- mappe decorative presentate come dati;
- copy celebrativo o accusatorio;
- classifiche individuali quando la fonte non espone davvero valori individuali;
- inferire colpevolezza da un outlier.

**La qualità visiva deve rendere il dato più facile da capire e verificare, non più facile da spettacolarizzare.**

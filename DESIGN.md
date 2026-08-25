# DoveVannoINostriSoldi — Design System

## 01 Overview

**Direzione: “Il registro pubblico.”**

DoveVannoINostriSoldi è un prodotto operativo di consultazione e verifica. Deve sembrare un documento pubblico contemporaneo: carta chiara, inchiostro nero, un solo accento rosso che indica dove guardare. Niente pannelli traslucidi, niente bagliori, niente angoli arrotondati.

La direzione è **dati subito, fonte vicina, superfici piatte**.

La schermata deve far capire rapidamente:

1. che cosa si sta guardando;
2. qual è il dato o confronto principale;
3. da quale fonte arriva e quanto è fresco;
4. come approfondirlo fino al record originale.

Una sola metrica può dominare una superficie. Le altre diventano confronti, serie, metadata o dettagli. Grafici e mappe devono ridurre il tempo necessario per capire un pattern, mai decorare uno spazio vuoto.

La domanda sceglie la forma: mappa per geografia, linea per trend, barre o dot plot per confronti, distribuzione/percentili per benchmark, tabella per valori esatti e card per un singolo insight verificabile. Un treemap è ammesso solo per parti additive dello stesso totale, con categorie non sovrapposte, denominatore e copertura dichiarati, etichette leggibili, equivalente tabellare e fallback mobile. Non usare una visualizzazione solo perché più spettacolare.

L'ordine di lettura condiviso è: **dato principale → confronto → contesto → dettaglio → fonte**. Su mobile resta lo stesso ordine semantico: non si anticipa un elenco secondario davanti alla visualizzazione o al confronto che spiega la pagina. La gerarchia deve restare leggibile in scala di grigi attraverso posizione, dimensione, peso, spaziatura e linee; il colore non porta mai da solo la priorità.

Il marchio “Confluenza” porta il tricolore nell'header come firma di identità. Nell'interfaccia usa la variante trasparente; favicon e icone installabili conservano il fondale inchiostro. Il punto azzurro appartiene all'asset ufficiale e non introduce un nuovo colore nell'interfaccia. Il tricolore non è la palette delle visualizzazioni.

I token vivono in `src/app/design-system.css`; la base e la chrome dell'applicazione in `src/app/globals.css`. Nessun colore va scritto a mano in un componente: se manca un token, si aggiunge lì.

## 02 Colors

La palette è grigio-carta caldo con un unico rosso di segnalazione. Evitare nero puro, bianco puro come fondo pagina, neon, glow e seconde tinte in competizione con l'accento.

### Core tokens

- `--color-bg: #f3f2f2` — fondo applicazione;
- `--color-surface: #eae9e9` — fondo secondario;
- `--color-raised: #ffffff` — superficie dei pannelli;
- `--color-text: #201e1d` — testo principale e fondo dei tooltip;
- `--color-accent: #ec3013` — azione, evidenza, serie primaria;
- `--color-accent-2: #e15b47` — accento secondario, usato di rado;
- `--color-divider` — separatore calcolato dal testo.

### Rampe tonali

`--color-neutral-100…900` e `--color-accent-100…900` sono generate in OKLCH su un'unica scala di luminosità: lo stesso passo di due rampe diverse ha lo stesso valore visivo. Le regole d'uso:

- `neutral-200` separatori interni di tabelle ed elenchi;
- `neutral-300` bordo dei pannelli e delle bande;
- `neutral-400` bordo dei controlli (input, bottoni secondari);
- `neutral-600` testo secondario e didascalie;
- `neutral-700` etichette dei pannelli;
- `neutral-800` testo di paragrafo dentro un pannello.

### Status

`--color-positive`, `--color-warning` e `--color-critical` (con i rispettivi `-bg` e `-border`) servono solo agli stati delle fonti e alla freschezza dei dati. Restano dentro il valore tonale del testo: un badge di stato non deve mai gridare più forte di un numero.

`--color-on-strong` e `--color-on-strong-muted` sono i soli ruoli testuali ammessi sulle superfici scure. Non usare un passo della rampa neutra come se fosse bianco: i token di foreground dichiarano il rapporto con la superficie e devono essere provati nel browser.

### Significato, confronto e direzione

- **Fatto documentato** e **confronto calcolato** usano tono neutro e un'etichetta testuale.
- **Segnale da approfondire** usa accento più una frase esplicita; non implica spreco o illecito.
- **Dato mancante** usa un ruolo neutro e spiega il motivo; zero, assente e non disponibile restano distinti.
- Verde e rosso indicano un esito positivo o negativo solo quando l'indicatore dichiara una direzione. Per spesa, costo o pagamento, più alto o più basso non è automaticamente migliore.
- Le scale sequenziali rappresentano quantità; le scale divergenti sono ammesse solo attorno a un riferimento dichiarato. Legenda, unità e valore testuale rendono il colore ridondante.

### Token per le visualizzazioni

`--chart-primary` è l'accento; `--chart-secondary…quinary` scendono lungo la rampa neutra. Una serie accentata su contesto neutro, mai un arcobaleno generico.

Per le sole composizioni additive istituzionali (treemap Ministeri / Palazzo Chigi / Regioni) esistono `--chart-category-blue|teal|purple|amber|green|slate`: famiglie leggibili con testo bianco, senza usare il rosso come colore di categoria. Il rosso resta per CTA, evidenza e warning.

La coropleta regionale usa cinque passi sequenziali — `accent-200, accent-300, accent-400, accent-600, accent-800` — con contorno `--color-neutral-500` da 1px. Due vincoli, entrambi verificati a schermo:

- **il passo più chiaro deve staccarsi dal pannello bianco.** Partire da `accent-100` rende invisibili le regioni con la spesa più bassa: la rampa parte da `accent-200`;
- **il contorno non può essere bianco.** Due regioni chiare adiacenti con bordo bianco si leggono come una macchia sola. Il grigio medio funziona sotto tutti e cinque i passi.

Regione selezionata: contorno `--color-text` da 2px. Regione senza dato: `--color-neutral-200`.

## 03 Typography

Un'unica famiglia: **Archivo**, caricata con `next/font/google` e self-hosted. `--font-heading-weight: 800` per titoli ed etichette, 400–600 per il testo.

### Ramp

- `h1` di pagina: 30px, `letter-spacing: -.02em`;
- numero principale di un pannello: 38px, 800;
- numero di una banda statistica: 24px, 800;
- corpo: 14px (13,5px sotto i 620px), `line-height: 1.55`;
- etichetta di pannello (`.panel-title`): 11px, 800, maiuscolo, `letter-spacing: .09em`;
- didascalia e nota: 12px, `neutral-600`.

La scala spaziale condivisa è 4/8/12/16/20/24/32px (`--space-1/2/3/4/5/6/8`). Le eccezioni ottiche restano locali e motivate; valori ricorrenti non devono essere riscritti pagina per pagina.

Ogni cifra confrontabile usa `font-variant-numeric: tabular-nums`. Le celle numeriche non vanno a capo: è il contenitore a scorrere.

### Regole sui numeri

Tutto in `src/lib/format.ts`. Sono regole di lettura, non di stile:

- **Separatore delle migliaia sempre** (`useGrouping: "always"`). Il CLDR italiano non raggruppa le cifre a quattro posizioni: “7893” e “1203,55 €” non sono come si scrive un conto pubblico.
- **Decimali fissi nella forma compatta**: due per i miliardi, uno per i milioni. “5 mld €” in mezzo a “10,74 mld €” rompe l'incolonnamento.
- **Una sola unità per colonna** (`compactEuroLike`). Una classifica che passa da “mld” a “mln” a metà elenco costringe a ri-scalare ogni riga: la colonna sceglie l'unità dal valore più grande e la tiene per tutti.
- **Compatto più esatto**: il titolo mostra “70,94 mld €”, la riga sotto “70.936.770.818,54 € esatti”. Il lettore deve poter riconciliare quello che stampiamo con il file della fonte.
- **Mai un numero al posto di un buco**: “n.d.”, “non disponibile” o “non ancora collegata”, mai una stima travestita da dato.

## 04 Elevation

Il sistema è piatto. `--radius-sm/md/lg` valgono `0px` e non vanno sovrascritti.

La gerarchia si costruisce con il fondo e una linea da 1px, non con l'ombra:

- pannello: `--color-raised` + `1px solid --color-neutral-300`;
- pannello di avvertenza: `--color-neutral-100` + bordo `--color-accent-300`;
- riquadro dentro un pannello: `--color-neutral-100` + bordo `--color-neutral-200`.

`--shadow-sm/md/lg` esistono per gli elementi che stanno davvero sopra la pagina — tooltip e overlay — e nient'altro.

## 05 Components

### Shell

`.shell` dà a header, nav, main e footer la stessa misura: larghezza piena, `max-width: --max`, `padding-inline: --gutter`. È **fluida**: nessuna superficie ha una larghezza fissa, così la pagina non lascia mai spazio morto su un lato. Il gutter scende da 28px a 20px e poi a 14px sui breakpoint.

### Navigation

Header su una riga: marchio con firma tricolore, ricerca, azione. Sotto, la barra delle sezioni con sottolineatura accentata sulla voce corrente. Sotto i 900px l'header va a capo e la ricerca prende tutta la riga; la barra delle sezioni scorre orizzontalmente senza scrollbar visibile.

### Dashboard

La home è una griglia a tre colonne (`360px | 1fr | 300px`): lettura/composizione, geografia, dettaglio. A 1320px la colonna destra diventa una banda di moduli a piena larghezza; a 900px tutto segue lo stesso ordine DOM in colonna singola. La classifica dei Comuni non precede mai la mappa.

### Composizione della spesa

`SpendingComposition` riceve valori assoluti, totale canonico, periodo, perimetro, denominatore e fonte. Lo stato `ready` deve riconciliare la somma al centesimo; `partial` mostra residuo e categorie mancanti senza simulare copertura completa. L'area è proporzionale al valore. Le celle sotto la soglia di leggibilità usano un indice e restano spiegate nella lista; sotto 620px il treemap collassa in lista con barre. Tooltip da tastiera e tabella equivalente non sostituiscono i dati essenziali già visibili.

Use: fotografia additiva dello stesso totale, categorie mutuamente esclusive, copertura verificata. Avoid: trend, ranking preciso, benchmark, categorie sovrapposte, denominatori o periodi diversi.

### Panels

`.panel` più `.panel-title` sono l'unità di base di ogni pagina. Il titolo è un'etichetta, non un titolo tipografico: piccolo, maiuscolo, `neutral-700`.

### Tables

`.table` dentro `.table-scroll`. Le intestazioni di colonna sono maiuscole e piccole; l'intestazione di riga è il nome della riga, in caso normale, con un'eventuale seconda riga di contesto in `small`. Le colonne numeriche usano `.num`.

### Stat strip

`.stat-strip`: una banda bianca divisa in colonne, ognuna con etichetta maiuscola piccola, valore in Archivo 800 e nota esplicativa. Etichetta, valore e nota sono `display: block` e stanno su righe separate — accostati sulla stessa riga il numero si attacca all'etichetta e diventa illeggibile. Quattro colonne su desktop, due sotto i 900px, una sotto i 620px.

### Bar rows

Il pattern ricorrente `etichetta | traccia | valore`: traccia `neutral-200`, riempimento accento, valore tabulare a destra.

**Il mese ancora in corso usa `neutral-500` invece dell'accento** e porta un asterisco: è un numero destinato a salire e non va confrontato con i mesi chiusi. Un anno già concluso non ha nessun mese in corso — tutte le barre sono accento e la nota dice “Anno chiuso: tutti i mesi sono definitivi”. La regola sta in `src/lib/siope-calendar.ts` e decide in base all'anno in cui abbiamo scaricato il file, non al numero del mese.

### Charts

Recharts legge i token: assi e griglia in `--color-neutral-300/600`, serie dai `--chart-*`. I tooltip sono l'unica superficie scura del sistema: fondo `--color-text`, testo `--color-neutral-100`, valore in bianco.

Dove basta, il grafico è HTML e CSS (barre, donut in `conic-gradient`) invece di una libreria: meno JavaScript e stessa leggibilità.

### Source provenance

Ogni pagina dichiara fonte, data del dato e data del nostro controllo. Se un dato manca si scrive “—” o “non disponibile”: mai una stima al posto di un buco.

### Status

`.status-attiva`, `.status-integrazione`, `.status-mappata`: rettangoli con bordo, nessun raggio, testo in colore di stato.

### Motion

Transizioni brevi (140ms, `--ease-out`) su colore e sfondo. Nessuna animazione d'ingresso. `prefers-reduced-motion` azzera tutto.

## 06 Do's and Don'ts

### Do

- Usare i token: se serve un colore nuovo, si aggiunge a `design-system.css`.
- Comporre le pagine con `.panel`, `.table`, `.stat-strip`, `.notice`, `.btn`; il modulo CSS della pagina copre solo ciò che è davvero specifico.
- Mostrare il valore compatto e quello esatto: “70,94 mld €” con sotto “70.936.770.818,54 € esatti”.
- Far scorrere il contenuto largo dentro il suo contenitore, mai la pagina.
- Spiegare in italiano semplice che cosa misura un numero e che cosa non dimostra.
- Verificare ogni pagina a 320, 375, 768, 1024, 1280 e 1600px: nessun `scrollWidth` maggiore del viewport e nessuno spazio morto asimmetrico.
- Distinguere un dato provvisorio da uno definitivo, nel colore e nelle parole.

### Don't

- Nessuna larghezza fissa sui contenitori di pagina.
- Nessun `border-radius`, gradiente decorativo o ombra su una superficie che non sta sopra la pagina.
- Nessun secondo colore d'accento per “dare varietà”: il rosso indica, il resto è neutro.
- Nessun colore scritto a mano in un componente o in un modulo CSS.
- Nessun numero senza fonte e senza data.
- Nessuna parola che trasformi un segnale in un'accusa.
- Nessuna etichetta di comodo su un aggregato: se una fetta somma due voci diverse, si chiama con un nome che le contiene entrambe, non con quello della più grande.

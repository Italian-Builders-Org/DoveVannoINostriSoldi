# Simulatore Legge di Bilancio

La pagina [/spese/legge-di-bilancio](/spese/legge-di-bilancio) mostra la variazione anno su anno dello
stanziamento **pubblicato** per missione nelle ultime Leggi di Bilancio confrontabili, e lascia
all'utente costruire uno scenario ipotetico a partire da quel dato reale. Lo scenario è sempre
disegnato in modo visivamente distinto dal dato osservato (trama a righe, non colore pieno) e mai
presentato come proiezione ufficiale, in linea con il vincolo permanente di prodotto "nessun valore
economico simulato presentato come reale".

## Fonti

- **Stanziamento**: RGS/OpenBDAP, dataset `LBF_SPE_CRU_AMPMA_001` — "Legge di Bilancio Pubblicata ·
  Serie storica · Spese per Amministrazione, Missione, Programma e Macroaggregato". Licenza
  Creative Commons Attribution (CC-BY), dichiarata dal catalogo CKAN OpenBDAP. A differenza dei
  prodotti "Rendiconto" (`src/lib/bdap-payments.ts`), che pubblicano un pacchetto CKAN per anno,
  questo prodotto pubblica un **unico pacchetto** con l'intera serie storica in una sola risorsa
  CSV; l'adapter (`src/lib/bdap-legge-bilancio.ts`) lo scopre via `package_search` e ne verifica
  titolo e codice prodotto prima di leggerlo.
- Il valore mostrato è il campo ufficiale **"Legge di Bilancio CP A1"**: lo stanziamento di
  competenza (accrual) del primo anno, così come lo pubblica la Legge di Bilancio di quell'anno
  stesso. Non è un valore di cassa (CS) né uno dei due anni successivi che la stessa legge
  prevede in via previsionale (A2, A3).

## Metodo

Per ogni anno e missione, l'adapter somma il campo "Legge di Bilancio CP A1" su tutte le
amministrazioni e i macroaggregati che riportano sotto quella missione. Il delta anno su anno è
puramente aritmetico:

```text
differenza = stanziamento(anno) - stanziamento(anno precedente)
variazione% = differenza / stanziamento(anno precedente) * 100
```

La finestra servita di default è le **ultime 6** Leggi di Bilancio comparabili (parametro
`years`/`anni`, tra 2 e 20). "Comparabili" ha un vincolo verificato dal vivo sul CSV: la
tassonomia delle missioni RGS è stata riscritta nel 2017 (es. "Diritti sociali politiche sociali e
famiglia" → "Diritti sociali, politiche sociali e famiglia"); confrontare un'etichetta pre-2017 con
la sua versione rinominata tratterebbe silenziosamente due stringhe distinte come una serie
continua. L'adapter quindi non serve mai anni precedenti al 2017 (`MIN_STABLE_MISSION_YEAR`), e
mostra solo le missioni presenti con lo stesso nome in **tutti** gli anni della finestra richiesta,
per evitare di disegnare uno zero falso dove OpenBDAP semplicemente non ha pubblicato quella riga.

## Cosa questo simulatore non dimostra

- **Non individua le misure della manovra**: un fondo, un bonus o un'aliquota nominati nel testo
  di legge richiedono una lettura riga per riga da fonti come UPB o Corte dei Conti, un lavoro
  editoriale distinto e fuori scope qui. Questo simulatore mostra solo la variazione dello
  stanziamento a livello di missione.
- **Non è un pagamento osservato**: "Legge di Bilancio CP A1" è lo stanziamento enacted
  (autorizzazione di competenza), non la spesa effettivamente pagata durante l'anno. Per la spesa
  pagata vedi [/stato](/stato) (consuntivo/mensile) e [/stato/legislature](/stato/legislature)
  (consuntivo annuale per legislatura).
- **La missione "Debito pubblico" è dominata dal rimborso lordo del debito**: il macroaggregato
  "RIMBORSO DEL DEBITO PUBBLICO" ricompare in più missioni ma pesa in particolare su questa,
  rendendo le sue variazioni anno su anno guidate soprattutto dal calendario di rifinanziamento,
  non da scelte di policy dell'anno.
- **Copre solo missioni con nome stabile dal 2017**: gli anni 2003-2016 esistono nel dataset RGS
  ma restano fuori dalla serie servita per il motivo di rinomina spiegato sopra.
- **Lo scenario ipotetico non è una previsione**: è un'operazione aritmetica (percentuale scelta
  dall'utente applicata all'ultimo stanziamento reale), mai un annuncio, una previsione di governo
  o un dato OpenBDAP.

## Superfici

- `GET /api/spese/stato/legge-bilancio`, parametro opzionale `anni` (intero, 2-20; default 6).
- MCP: `query_dataset` con `dataset=openbdap_legge_bilancio_storico`, filtro opzionale `years`.
- UI: [/spese/legge-di-bilancio](/spese/legge-di-bilancio), collegata da [/stato](/stato) e dal menu «Soldi». La missione si
  sceglie da un treemap (`MissionPicker`) dimensionato sullo stanziamento dell'ultimo anno: le
  missioni sopra lo 0,7% del totale sono riquadri cliccabili (con nome breve, importo compatto e
  variazione reale), le più piccole una striscia di chip di pari dimensione sotto il grafico. Ogni
  riquadro è un `<g role="button">` focalizzabile da tastiera; i chip sono `<button>` nativi.
- **Piano di riallocazione**: lo slider modifica la voce selezionata, ma la modifica resta in un
  piano per missione (`scenarioByMission` in `SimulatoreClient`) anche quando cambi missione, così
  l'utente vede l'intero scenario che ha costruito: un pannello elenca ogni voce toccata (da → a,
  contributo al totale, rimozione singola) più l'effetto netto sul totale delle 34 missioni.
- Il pannello chiude con **«Come cambia la Legge di Bilancio»**: aumenti e tagli del piano sommati
  separatamente (con barre e conteggio voci) e il saldo netto con il verdetto in parole («in più, da
  trovare come copertura» / «aumenti e tagli quasi si compensano» / «risorse liberate»), poi la riga
  osservato → scenario. Serve a distinguere una riallocazione a saldo zero da un allargamento della
  manovra.
- Con almeno una voce toccata **il treemap si ridisegna sulla ripartizione ipotetica**: ogni
  riquadro è dimensionato sull'importo assegnato dall'utente, non più sullo stanziamento pubblicato.
  Per non far mai passare l'ipotesi come dato reale: il contenitore ha bordo tratteggiato e una
  didascalia esplicita, le voci toccate sono a righe con bordo tratteggiato e barra di confronto
  «oggi vs ipotesi». Due bottoni distinti tornano al dato RGS: «Azzera questa voce» azzera solo la
  missione selezionata, «Ricomincia» rimette l'intero piano sullo stanziamento pubblicato. La
  ripartizione fra treemap ed elenco «missioni minori» resta ancorata al dato osservato, così un
  riquadro non salta di categoria mentre lo ridimensioni.

## Riferimenti

- [OpenBDAP RGS](https://bdap-opendata.rgs.mef.gov.it)
- [Catalogo del dataset](https://bdap-opendata.rgs.mef.gov.it/content/legge-di-bilancio-pubblicata-serie-storica-spese-amministrazione-missione-programma-1)

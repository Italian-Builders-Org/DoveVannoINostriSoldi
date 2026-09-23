# ISTAT · povertà relativa per regione (34_727_DF_DCCV_POVERTA_8 e _10)

Fonte tipizzata `istat-poverta-regioni`, API
`/api/territori/poverta-regioni`, dataset MCP `istat_poverta_regioni`.
Nessuna UI.

## Acquisizione (2026-09-23)

| Asset | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV famiglie](https://esploradati.istat.it/SDMXWS/rest/data/IT1,34_727_DF_DCCV_POVERTA_8,1.0/) | 39.159 | `db02713258cb4192a0d9593ff0e3ce988183c03c4233dab1c594406c56591167` |
| [SDMX-CSV individui](https://esploradati.istat.it/SDMXWS/rest/data/IT1,34_727_DF_DCCV_POVERTA_10,1.0/) | 40.214 | `a79a82808e44d833f27158d078f0570857a8f4e026782dfac13cb245ae8dbf6a` |
| [Structure famiglie](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/34_727_DF_DCCV_POVERTA_8/1.0?references=all) | 9.897.943 | `640120f34c45d3ad2187998033547627e7bd79cf4761f0f52632e5eb4a8263a8` |
| [Structure individui](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/34_727_DF_DCCV_POVERTA_10/1.0?references=all) | 9.897.949 | `30d0a31128ec1fc1323709081fd1b673e8c6a945463fdda4cfa81a5cc0a13bec` |

Le due risposte CSV sono state scaricate due volte a distanza e sono risultate
identiche byte per byte: la chiave enumera i 30 territori, quindi l'ordine non
dipende dal servizio.

`dataflowLastUpdate` dalle structure: `2025-10-14T08:02:20.381Z` per entrambe.
Licenza payload `not-declared`. Scale factor **100** (centesimi di punto
percentuale: 10,9% vale 1090). `UNIT_MEAS` vuoto nei CSV. Le etichette dei
trenta territori vengono dalla codelist `CL_ITTER107` dentro le structure, non
sono scritte a mano.

## Perimetro

Serie **corrente post-revisione** 2014–2024. I dataflow `34_728_*_BRKN1_*` sono
la serie pre-revisione e restano fuori (#580).

Trenta territori: Italia, Nord e Mezzogiorno, le cinque ripartizioni, le venti
regioni e le due province autonome. Sono **annidati**: sommare le regioni non
ricostruisce l'Italia, e comunque si tratta di percentuali.

Due misure, una per dataflow, con la stessa chiave per tutto il resto:
`INCID_POVREL_FAM` (famiglie) e `INCID_POVREL_INDIV` (individui).

## Perché qui c'è la relativa e non l'assoluta

La #580 cercava il dettaglio regionale dell'incidenza **assoluta**
(`INCID_POVASS_FAM`) e trovava solo ripartizioni. Non è una lacuna dei
dataflow: ISTAT non stima l'incidenza assoluta a livello regionale. Il dettaglio
regionale esiste sulla povertà **relativa**, che è un dato diverso e non si
confronta riga per riga con le fette di incidenza già in piattaforma.

## Le due forme dell'assenza

| | Celle attese | Valori diffusi | Celle non diffuse | Righe assenti |
| --- | ---: | ---: | ---: | ---: |
| Famiglie | 330 | 310 | 19 | 1 |
| Individui | 330 | 326 | 3 | 1 |

Sono due assenze diverse e restano distinte nel payload:

* `undiffused` — la riga c'è, `OBS_VALUE` è vuoto e `OBS_STATUS` vale `0`;
* `missingRows` — la riga non è proprio nella risposta (Bolzano 2016, in
  entrambi i dataflow).

Ricostruendo la griglia 30 × 11 per join, la seconda diventerebbe un buco
indistinguibile dalla prima. Nessuna delle due è uno zero.

## La trappola del flag `0`

`CL_FLAG` definisce `0` come «il dato non raggiunge la metà della cifra minima
considerata». Con valori a un decimale significherebbe incidenza sotto lo 0,05%,
e autorizzerebbe a imputare zero. **Quella lettura non regge**, e va detto
perché chiunque integri questi dataflow ci inciampa.

L'incidenza individuale è per definizione quella familiare moltiplicata per il
rapporto fra la dimensione media delle famiglie povere e quella di tutte le
famiglie. Sulle 310 coppie valide quel rapporto sta fra **0,903 e 1,919**. Ma
l'Umbria 2015 ha incidenza individuale **13,4%** e incidenza familiare flaggata:
leggerla come «sotto 0,05%» richiederebbe un rapporto di **268**, cioè famiglie
povere da oltre seicento componenti. Sulle 16 celle familiari flaggate che hanno
l'individuale accanto il rapporto richiesto va da 44 a 268.

Tre verifiche indipendenti, tutte concordi:

1. su 8.265 osservazioni degli 11 dataflow della famiglia `34_727`, le 552 celle
   con flag `0` sono **tutte** senza valore; lo stesso vale per il flag `t`, che
   è puramente tipografico. In questa diffusione la colonna dei flag sostituisce
   la cella vuota, non qualifica un numero pubblicato;
2. le stesse osservazioni richieste in SDMX-ML generic arrivano **prive**
   dell'elemento del valore: non è un artefatto del CSV;
3. ricostruendo Bolzano dall'identità `Trentino-Alto Adige = Bolzano + Trento`,
   con il peso calibrato a 0,4958 sulla serie individuale contro 0,496 del
   rapporto di popolazione residente, l'incidenza familiare di Bolzano risulta
   **1,3–3,7%**, mai sotto 0,8%.

ISTAT diffonde il valore familiare dell'aggregato Trentino-Alto Adige in 9 anni
su 11 e quello di Bolzano in nessuno: se fosse davvero sotto lo 0,05% non ci
sarebbe motivo di non pubblicarlo.

Dicitura usata nel prodotto: **dato non diffuso**. Non «inferiore alla soglia
minima», che sarebbe ripetere l'errore, e nessuna accusa di soppressione: la
causa non è documentata nelle structure e le colonne `NOTE_*` di quelle righe
sono vuote. Su Bolzano 2015 nessuno dei due argomenti si applica, perché mancano
sia l'individuale sia l'aggregato: lì la conclusione poggia solo sul
comportamento sistematico del flag.

## Invariante vincolata

`invariants.individualToHouseholdRatio` fissa `{pairs: 310, min: 9030, max:
19189}` (decimillesimi). L'ETL ricalcola il rapporto sulle coppie pubblicate e
si blocca se differisce dal lock, se supera 4 — segno che una cella non diffusa
è stata imputata — o se scende sotto 0,5, segno che le due misure sono state
scambiate. Il contratto TypeScript lo ricalcola a sua volta, ma lì la difesa che
scatta per prima è il digest dell'artefatto: l'invariante morde in fase di
costruzione, ed è lì che il test la verifica.

Vincolata anche l'assenza totale di valori familiari per Bolzano: se il rilascio
ne pubblicasse uno, il bundle si blocca e l'esclusione va rivista.

## Limiti

- È un'incidenza percentuale, non un importo: `soldi.present` è false.
- Povertà relativa ≠ assoluta: nessun confronto riga per riga con le altre
  fette 34_727.
- I territori sono annidati: sommarli non ha senso.
- La misura individuale ha copertura più ampia della familiare (326 celle contro
  310): una graduatoria regionale costruita sulle famiglie perde territori in
  anni diversi, e va costruita con i «non diffuso» espliciti.

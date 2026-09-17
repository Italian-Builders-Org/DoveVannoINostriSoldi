# Confronto di serie ufficiali (#382)

`/esplora` contiene la ricerca di relazioni tra incarichi ed enti. Non era un
selettore di serie storiche: quel percorso resta disponibile e introduce
`/esplora/serie`, dedicato al confronto. La navigazione e la ricerca globale
espongono direttamente anche il nuovo strumento.

## Prima versione

Un form GET con quattro selettori permette di scegliere da due a quattro
serie. Le due facoltative possono restare vuote; l’URL risultante conserva la
selezione, anche al refresh e senza JavaScript. L’esempio iniziale confronta
Difesa e Ordine pubblico e sicurezza italiani in milioni di euro correnti.

Il catalogo comprende 26 proiezioni di snapshot già verificati:

- undici funzioni COFOG Italia, totale incluso, nelle due unità native Eurostat
  `MIO_EUR` e `PC_GDP`, annuali 2014–2024;
- IPCA totale di IT, FR, DE ed ES, `RCH_A`, mensile 1997-01–2026-08.

I perimetri sono fissati dalla famiglia. Non sono presenti upload, forecasting,
conversioni valutarie, ribasamenti, contributi COICOP o nuove fonti. L’IPCA a/a
resta distinto dalla variazione mensile e dal livello dell’indice.

## Confini e comportamento

`official-series.ts` legge esclusivamente gli adapter COFOG e pagella governi
che convalidano gli snapshot. I centesimi COFOG tornano nell’unità originale
milioni di euro; la quota del PIL torna in punti percentuali. L’IPCA conserva
valori e flag originali, inclusi quelli stimati dalla fonte.

Il confronto rifiuta meno di due o più di quattro serie, ID non catalogati,
duplicati, incompatibilità di unità/frequenza/famiglia, serie vuote, periodi
malformati, duplicati o non ordinati e assenza di un periodo comune. In questi
casi mostra un avviso e le fonti delle selezioni riconosciute, senza grafico
né tabella numerica sostitutiva.

L’asse temporale usa l’unione dei periodi nel calendario nativo; la presenza di
una riga non inventa un’osservazione. I valori assenti restano null e interrompono
la linea, come il flag Eurostat `b` prima dell’osservazione interessata. Nessun
dato viene interpolato o aggregato; zero resta zero. Le linee sono descrittive,
non una prova di causalità. Totale e divisioni COFOG non vengono sommati.

## Lettura e verifica

Grafico e tabella riportano identiche osservazioni. Asse verticale comune con
zero, legenda numerata e tratti diversi rendono il colore ridondante. La
tabella scorre nel proprio contenitore, raggiungibile da tastiera, e riporta lo
stato di ogni osservazione. Le etichette HTML del grafico restano leggibili su
mobile. Una scheda visibile per serie conserva unità, frequenza, copertura,
fonte e date distinte; query, condizioni di riuso e SHA-256 sono espandibili.

`tests/official-series.test.mjs` verifica concordanza con gli snapshot,
selezioni valide/negative, lacune e interruzioni. Lo scenario produzione
`scripts/browser/official-series.mjs`, integrato nel core, esercita l’ingresso,
il form reale, confronto a quattro serie, tabella e fonti, navigazione da
tastiera e rifiuto delle selezioni incompatibili a sette larghezze da 320 a
1600 px. Esiti effettivi dei gate vanno riportati nella PR; l’esistenza dei
test non equivale a un loro esito positivo.

# Dai fondi ai posti

Materiali riproducibili per lo studio sull'avanzamento amministrativo dei progetti
PNRR per asili nido e servizi per la prima infanzia.

## Domanda di ricerca e contributo

A poche settimane dalla scadenza europea M4C1-18, quali caratteristiche
distinguono i progetti classificati esplicitamente come `ASILI NIDO` e
amministrativamente conclusi da quelli ancora in collaudo, in esecuzione o in
fasi precedenti? L'intera misura 0--6 anni è mantenuta come controllo di
robustezza, perché il benchmark territoriale ISTAT riguarda i bambini 0--2.

Lo studio separa cinque passaggi: allocazione finanziaria, consegna
amministrativa, output fisico certificato, capacità di servizio attiva ed esiti
sociali. I dati osservano bene i primi due. Il dataset non contiene il numero di
posti effettivamente creati né i certificati usati per verificare il target
europeo: un progetto segnato come concluso non equivale quindi a un numero noto
di posti certificati.

## Risultato principale

Nel campione coerente con il benchmark 0--2, 294 progetti su 2.980 risultano
conclusi (9,9%) e 1.443 hanno raggiunto almeno il collaudo (48,4%). Il
finanziamento per bambino è maggiore nelle regioni con copertura 2023/24 più
bassa, mentre la maturità amministrativa è maggiore nelle regioni già più
coperte. Nei gruppi sotto il 33% di copertura, il 37--43% del finanziamento è
associato a progetti almeno in collaudo; nei gruppi sopra il 33%, il 58--59%.
Il paper interpreta questa divergenza come attenuazione descrittiva della
perequazione lungo la pipeline, non come effetto causale del territorio.

L'estensione 1.1 aggiunge:

- analisi dell'equità corretta per maturità amministrativa;
- Kaplan--Meier descrittivo del tempo alla conclusione con censura a destra;
- confronto regionale osservato/atteso dato il portafoglio di progetti;
- struttura degli appalti per numero e valore, distinti per modalità e oggetto;
- audit delle date di pubblicazione e aggiudicazione;
- tabelle di coorte, dizionario ampliato e lista riproducibile di monitoraggio.

La versione 1.2 (6 settembre 2026) aggiunge:

- esclusione di una regione alla volta, confronto fondi totali/PNRR e sensibilità
  alla soglia delle durate;
- correzione della mediana delle procedure aperte (47 giorni), del riferimento
  ISTAT (benchmark 2023/24, non baseline pre-PNRR) e della citazione PIMA;
- limiti espliciti su censura, selezione dei progetti, inferenza con 20 cluster e
  assenza di preregistrazione/peer review;
- sezione web distinta dagli articoli mensili, con asset versionati e hash.

La versione 1.3 (6 settembre 2026) rivede soltanto la presentazione del PDF:

- note e limiti diventano paragrafi tipografici, senza riquadri colorati;
- ripristina virgolette, apostrofi e simboli euro mancanti nel rendering;
- corregge i riferimenti interni alle pagine e una riga troppo lunga.

Testo, numeri, figure, tabelle e interpretazione restano quelli della versione
1.2. Il PDF conserva 32 pagine. Gli asset pubblici della 1.2 restano disponibili
nel percorso versionato precedente; la 1.3 ha un URL e uno SHA-256 distinti.

La data dei dati resta **13 giugno 2026**, non settembre. La verifica MCP del
6 settembre conferma 3.841 progetti, 18.851 procedure e 506.114.534.373 centesimi
di finanziamento totale per la misura completa.

## Fonti

- `src/data/generated/pnrr-childcare.data.json`: snapshot verificato del dataset
  DVNS `pnrr_asili`, riferimento 2026-06-13.
- `data/mcp_pnrr_manifest.json`: risultato compatto della query MCP usata per
  verificare copertura, totali e hash delle fonti.
- `data/istat_childcare_2023.csv`: copertura regionale dei servizi educativi per
  la prima infanzia, anno educativo 2023/24, tavola ISTAT 1.9.

## Riproduzione

Da questa directory:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/analyze.py
.venv/bin/python scripts/robustness.py
.venv/bin/python scripts/test_analysis.py
```

Il comando genera grafici in PDF/PNG, tabelle LaTeX, un dataset analitico privo
di nomi e codici fiscali e un riepilogo numerico JSON. Il paper viene compilato
separatamente con il runtime LaTeX del plugin Codex (Tectonic).
Per ambienti senza display impostare `MPLBACKEND=Agg`.

Lo snapshot corrente viene verificato tramite SHA-256. Se cambia, lo script
recupera la versione storica dal commit
`6dbbfc00db21a3f821fc58115c6a06d0b6fafec9` con `git show` e ne ricontrolla l'hash:
occorre quindi la storia Git completa (in un clone shallow scaricare quel
commit prima di riprodurre). Il comando non interroga la rete e non sovrascrive
i dati correnti. Non è necessario duplicare i 18 MB di snapshot nel paper.

Dopo la compilazione eseguire `scripts/export_web.py` con Python per allineare
PDF, CSV, JSON pubblici e capsula aggregata in `src/content/studies/`.
I test `tests/studies.test.mjs` verificano denominatori, hash e identità del PDF.
Il browser gate `scripts/browser/studies.mjs` verifica navigazione e download
a 390 e 1.440 px sul server di produzione.

Output principali:

- `paper/main.pdf`: working paper compilato (32 pagine);
- `paper/main.tex`: sorgente LaTeX;
- `generated/analysis_summary.json`: risultati numerici principali;
- `figures/`: undici figure in formato vettoriale PDF e PNG;
- `tables/`: tabelle LaTeX generate dall'analisi.

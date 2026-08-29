# Dai fondi ai posti

Materiali riproducibili per lo studio sull'avanzamento amministrativo dei progetti
PNRR per asili nido e servizi per la prima infanzia.

## Domanda di ricerca

A poche settimane dalla scadenza europea M4C1-18, quali caratteristiche
distinguono i progetti classificati esplicitamente come `ASILI NIDO` e
amministrativamente conclusi da quelli ancora in collaudo, in esecuzione o in
fasi precedenti? L'intera misura 0--6 anni è mantenuta come controllo di
robustezza, perché il benchmark territoriale ISTAT riguarda i bambini 0--2.

Lo studio descrive associazioni osservazionali. Il dataset non contiene il
numero di posti effettivamente creati né i certificati usati per verificare il
target europeo: un progetto segnato come concluso non equivale quindi a un
numero noto di posti certificati.

## Risultato principale

Nel campione coerente con il benchmark 0--2, 294 progetti su 2.980 risultano
conclusi (9,9%) e 1.443 hanno raggiunto almeno il collaudo (48,4%). Il
finanziamento per bambino è maggiore nelle regioni con copertura iniziale più
bassa, mentre la maturità amministrativa è maggiore nelle regioni già più
coperte. Il paper interpreta questa divergenza come rischio di consegna della
perequazione, non come effetto causale del territorio.

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
```

Il comando genera grafici in PDF/PNG, tabelle LaTeX, un dataset analitico privo
di nomi e codici fiscali e un riepilogo numerico JSON. Il paper viene compilato
separatamente con il runtime LaTeX del plugin Codex.

Output principali:

- `paper/main.pdf`: working paper compilato (19 pagine);
- `paper/main.tex`: sorgente LaTeX;
- `generated/analysis_summary.json`: risultati numerici principali;
- `figures/`: sei figure in formato vettoriale PDF e PNG;
- `tables/`: tabelle LaTeX generate dall'analisi.

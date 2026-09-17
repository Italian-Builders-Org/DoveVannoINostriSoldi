# Screening derivato sui Comuni

La pagina [Cosa controllare](/controlli) espone uno screening derivato dal rilascio
OpenCivitas 2022 per i Comuni delle Regioni a statuto ordinario. Non è una graduatoria di
efficienza e non dimostra sprechi, meriti, corruzione o illeciti.

## Formula

Per ogni Comune usiamo la differenza pubblicata dalla fonte:

```text
differenza per abitante = spesa storica per abitante - spesa standard per abitante
```

All'interno di ogni Regione calcoliamo i quartili con interpolazione lineare R-7 e l'intervallo
interquartile `IQR = Q3 - Q1`. Le soglie sono:

```text
soglia inferiore = Q1 - 1,5 × IQR
soglia superiore = Q3 + 1,5 × IQR
```

Sono valutate soltanto le Regioni con almeno quattro record monetari validi. I record con warning
sui campi monetari vengono esclusi e conteggiati; i warning relativi ai soli servizi non invalidano
questa differenza monetaria. I gruppi più piccoli restano visibili come non valutati.

Quando `IQR = 0`, la soglia collassa sul valore comune: valori strettamente diversi vengono
segnalati, ma non viene inventato un multiplo di IQR; l'API restituisce `excessMultiple: null` e la
distanza assoluta dalla soglia.

## Dimensione dei Comuni

Il rilascio snapshot non contiene un denominatore demografico ISTAT separato. Per rendere visibile
la scala senza chiamarla popolazione ufficiale, la UI mostra soltanto agli outlier una stima implicita
calcolata come media arrotondata delle stime `spesa totale / spesa per abitante` ottenute dalle due
coppie di valori del record.
La stima è marcata come tale e non viene usata per attribuire responsabilità. La UI e l'API offrono
anche una sensibilità per fasce di questa stima; ogni coorte Regione-fascia con meno di quattro
Comuni resta non valutata.

## Provenienza e superfici

- Fonte: [OpenCivitas open data](https://www.opencivitas.it/it/open-data), rilascio 2022 pubblicato
  il 7 agosto 2025, licenza CC BY 4.0 come dichiarato nello snapshot versionato.
- REST: `GET /api/controlli/spesa-comuni?anno=2022&limit=50&offset=0`, con filtro opzionale
  `regione`. La risposta include periodo, provenance, warning, totale non paginato e pagina corrente.
- MCP: `query_dataset` con `dataset=controlli_segnali`, `area=spesa-comuni`, `year=2022` e filtri
  `region`, `limit`, `offset`. I risultati MCP e REST riusano la stessa funzione di query tipizzata
  e sono coperti da un test anti-divergenza.

L'ordinamento per distanza dalla soglia serve soltanto a rendere leggibile una risposta paginata;
non è una graduatoria di Comuni e non identifica i migliori o i peggiori.

Il dettaglio di spesa storica, spesa standard e servizi resta nel [confronto OpenCivitas](/territori/confronto).
Il dataset ufficiale e il metodo di lettura devono rimanere la base per qualsiasi verifica ulteriore.

# Metodo ed evidence boundary

## Cosa rappresenta il pacchetto

L'archivio ricevuto il 21 agosto 2026 serve a trovare piste e documenti. Non è il proprietario ufficiale dei dati e non basta, da solo, per pubblicare un fatto, un benchmark o una violazione.

Ogni elemento destinato alla UI deve arrivare a una fonte primaria ufficiale verificata. Il pacchetto conserva il ruolo di input di ingestione e la sua provenienza resta visibile nel manifest.

## Classi pubbliche

1. **Irregolarità documentata.** Solo quando un atto ufficiale qualifica espressamente il fatto. La card indica autorità, atto, data e stato procedurale.
2. **Scostamento da benchmark.** Calcolo riproducibile su una coorte omogenea. È un segnale da approfondire, non prova di spreco o illecito.
3. **Trasparenza mancante.** Campo o documento dovuto e non reperito, dopo verifica della norma applicabile e delle superfici ufficiali alla data dichiarata.
4. **Dato incompleto o non confrontabile.** La UI mostra il limite e non calcola un delta.

## Like-for-like

Un confronto richiede la stessa categoria, periodo, valuta, unità, fase economica, trattamento IVA e perimetro procedurale. La coorte espone candidati, inclusi, esclusi per motivo, mediana, quartili, percentile 90, convenzione R7 e versione della formula.

```text
deltaCents = observedCents - medianCents
relativeDeltaBasisPoints =
  medianCents > 0 ? round(10_000 * deltaCents / medianCents) : null
```

La media da sola non è un benchmark. Un importo annualizzato, per unità o comprensivo di IVA non viene confrontato con un totale di contratto su base diversa.
Quando l'interpolazione R7 produce frazioni di centesimo, il risultato viene arrotondato al centesimo più vicino prima di calcolare il delta pubblicato.

## Stato dell'audit iniziale

- `affidamenti-diretti.tsv`: 6.506 righe; 2.445 con importo, 2.293 con contraente, 6.484 con CIG. I 6.484 CIG presenti sono unici e non ci sono righe duplicate esatte. Il file di stato dichiara stantia la copia sotto `dashboard/data/`; il candidato vivo è vincolato a path e digest nel manifest.
- `eventi-convegni.tsv`: 109 righe; 71 con importo, 6 con trattamento IVA dichiarato.
- `campagne-pubblicita.tsv`: 94 righe; 19 con importo, 4 con trattamento IVA dichiarato.
- `consulenze-legali.tsv`: 352 righe; 323 con importo, ma URL e basi economiche richiedono verifica record-level.
- `consulenze-pnrr.tsv`: 213 righe; 195 con importo, ma molte righe puntano a hub e non espongono CIG.

Questi conteggi descrivono il pacchetto, non sono metriche pubbliche. Nessun file intero supera ancora il gate di benchmark.

Nel master affidamenti 1.437 date sono al 1° gennaio e tre hanno precisione mensile. La precisione viene modellata esplicitamente; le date probabilmente annuali non entrano in benchmark mensili o stagionali. La classificazione del metodo è una derivazione testuale versionata da `oggetto`: la regola v1 trova 4.731 occorrenze di “affidamento diretto”, 3.000 varianti `art. 50`/`art.50`/`art 50` e 750 “trattativa diretta”. Le 176 righe con termini di eventi, convegni, campagne o pubblicità sono solo candidati da verificare.

`n.d.` non vale zero. Un URL ripetuto non vale come atto row-level. La popolazione laterale `238/~11m` è marcata dal JSON come estranea al catalogo. I 112 `catalogo_nuovi_t3rn` non si aggiungono al master senza le regole di deduplica del pacchetto. La licenza resta non verificata.

## FOIA

Il prodotto può preparare una bozza e conservarne lo stato sul dispositivo. Non invia richieste. Una mancanza nel pacchetto non genera automaticamente una FOIA: servono obbligo applicabile, controllo datato dei luoghi ufficiali e valutazione dei limiti di accesso e privacy.

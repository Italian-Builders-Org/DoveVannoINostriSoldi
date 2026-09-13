# ISTAT: economia non osservata, componenti e branche

Questa integrazione copre una sola fonte ufficiale: le tavole XLSX allegate da
ISTAT al comunicato *Economia non osservata nei conti nazionali — Anni
2020-2023*, pubblicato il 17 ottobre 2025. Il workbook completo è acquisito nel
repository come fixture ufficiale per rendere ripetibile il controllo offline.

## Source lock e riuso

- titolare: Istituto nazionale di statistica (ISTAT);
- [pagina ufficiale](https://www.istat.it/comunicato-stampa/economia-non-osservata-nei-conti-nazionali-anni-2020-2023/);
- [workbook ufficiale](https://www.istat.it/wp-content/uploads/2025/10/Tavole-Economia-non-osservata_2025.xlsx);
- formato: XLSX, 99.140 byte;
- SHA-256: `e59fcdd7e7fe553f55398846229baf5c2d94ec17dfb8d3240c06e879a270e55a`;
- acquisizione e controllo: 12 settembre 2026;
- periodo di riferimento: 2011-2023;
- geografia: Italia; le branche sono aggregati nazionali, non territori;
- aggiornamento: annuale;
- licenza: CC BY 4.0. Le [note legali ISTAT](https://www.istat.it/note-legali/)
  applicano la licenza ai contenuti del sito salvo diversa indicazione. DVNS
  attribuisce la fonte e dichiara la trasformazione in righe lunghe.

La specifica versionata conserva URL, hash, dimensione, date, fogli, titoli,
anni, componenti, branche e tolleranze di riconciliazione. Il parser legge i
valori lessicali delle celle XLSX: non converte i numeri in float e non
arrotonda i decimali pubblicati.

## Righe pubblicate

`istat-economia-non-osservata-componenti` proietta la Tavola 1 in 104 righe:
otto componenti o aggregati per tredici anni. Mantiene separati il valore in
milioni di euro correnti e l'incidenza percentuale sul PIL. Per le righe
`Valore aggiunto` e `PIL` l'incidenza assente resta una stringa vuota, non zero.

`istat-economia-sommersa-branche` proietta la Tavola 3 in 624 righe: dodici
branche, incluso il totale nazionale, per quattro componenti e tredici anni.
Ogni valore è una percentuale del valore aggiunto totale della stessa branca;
la riga `Totale` usa il valore aggiunto totale nazionale. Le percentuali di
branche diverse non sono additive.

Le riconciliazioni bloccano la pubblicazione se, oltre le tolleranze dichiarate
dalla precisione delle celle, le tre componenti non chiudono l'economia
sommersa o se economia sommersa e attività illegali non chiudono l'economia
non osservata. Schema, anni, duplicati, celle mancanti e numeri non finiti sono
anch'essi fail-closed.

## Significato e limiti

Sono stime ufficiali di contabilità nazionale. L'economia non osservata
comprende economia sommersa e attività illegali; non misura evasione fiscale
accertata, esiti di controlli o somme recuperate. La Tavola 3 riguarda la sola
economia sommersa e non include le attività illegali.

La fonte non pubblica per questa fetta dati regionali, provinciali o comunali,
né un incrocio territorio per settore. DVNS non distribuisce i totali
nazionali. Le Tavole 2 e 4-8 e ogni altra fonte citata nell'issue #387 restano
fuori da questa integrazione.

Catalogo, `GET /api/dati/[dataset]` e MCP `spesa_pa_dettaglio` usano lo stesso
selettore integrato. Il dataset è obbligatorio; ricerca e paginazione restano i
soli filtri generici supportati.

## Riproduzione offline

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 scripts/etl/istat_economia_non_osservata.py --check

DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 -m unittest tests.etl.test_istat_economia_non_osservata
```

`--publish` rigenera i due dataset dal workbook bloccato e chiude nella stessa
transazione chunk, ricevute, catalogo, dataset proof e release proof globale.
Non richiede archivi privati, mappe sorgente, database o credenziali.

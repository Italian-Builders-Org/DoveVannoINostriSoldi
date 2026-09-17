# ISTAT: economia non osservata, componenti, branche e territori

Questa integrazione copre due fonti ufficiali ISTAT distinte.

1. Le tavole XLSX allegate al comunicato *Economia non osservata nei conti
   nazionali — Anni 2020-2023*, pubblicato il 17 ottobre 2025 (Tavole 1 e 3,
   geografia nazionale).
2. La Tav. 6 delle tavole allegate ai *Conti economici territoriali — Anni
   2022-2024*, con data di pubblicazione sul landing ufficiale **22 dicembre
   2025** (incidenza regionale e di ripartizione sul valore aggiunto, anno
   2023).

I workbook sono acquisiti come fixture ufficiali per i controlli offline.

## Source lock nazionale (Tavole 1 e 3)

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

## Source lock territoriale (Tav. 6)

- titolare: Istituto nazionale di statistica (ISTAT);
- [pagina ufficiale](https://www.istat.it/comunicato-stampa/conti-economici-territoriali-2022-2024/);
- [workbook ufficiale](https://www.istat.it/wp-content/uploads/2025/12/Tavole-allegate-2025-1.xlsx);
- formato: XLSX, 92.647 byte;
- SHA-256: `c5faf1bd6797b3a1bb7513a75d4433414dc1ffa96bd5ac7560c04d9d0eb3e528`;
- pubblicazione dichiarata dal landing: 22 dicembre 2025;
- acquisizione e controllo: 13 settembre 2026;
- periodo di riferimento: anno 2023;
- geografia: 19 regioni, 2 province autonome, Italia e cinque ripartizioni
  pubblicate (Nord-ovest, Nord-est, Centro, Centro-nord, Mezzogiorno);
- aggiornamento: annuale;
- licenza: CC BY 4.0 via le [note legali ISTAT](https://www.istat.it/note-legali/).

Il workbook è collegato dal comunicato del 22 dicembre 2025 (edizione
2022–2024); la Tav. 6 riguarda soltanto il 2023. Il comunicato del 28 gennaio
2025 rinvia a un altro workbook e non identifica questa edizione. Le due
province autonome sostituiscono il Trentino-Alto Adige nella tavola: 21 unità
regionali, più Italia e cinque ripartizioni, per 27 territori complessivi.

Il parser legge i valori lessicali delle celle XLSX: non converte i numeri in
float e non arrotonda i decimali pubblicati. L'asse `soldi` dichiara
`present: false` perché Tav. 6 pubblica solo percentuali di incidenza, non
importi monetari.

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

`istat-economia-non-osservata-territori` proietta la Tav. 6 in 108 righe: 27
territori × quattro componenti (`Rivalutazione`, `Lavoro irregolare`, `Altro`,
`Totale`) per il solo anno 2023. La fonte etichetta la terza componente
`Altro*`; DVNS pubblica `Altro` e conserva la nota ufficiale nei caveat.
Italia e le ripartizioni restano aggregati pubblicati: non si ricostruiscono
sommando le regioni e non esistono province o Comuni in questa tavola.

Le riconciliazioni bloccano la pubblicazione se, oltre le tolleranze dichiarate
dalla precisione delle celle, le componenti non chiudono i totali pubblicati.
Schema, anni, duplicati, celle mancanti e numeri non finiti sono anch'essi
fail-closed.

## Significato e limiti

Sono stime ufficiali di contabilità nazionale o territoriale. L'economia non
osservata comprende economia sommersa e attività illegali; non misura evasione
fiscale accertata, esiti di controlli o somme recuperate. La Tavola 3 riguarda
la sola economia sommersa e non include le attività illegali. La Tav. 6
territoriale è distinta dal workbook nazionale e dai prodotti MEF, INL e VAT
gap UE.

Catalogo, `GET /api/dati/[dataset]` e MCP `spesa_pa_dettaglio` usano lo stesso
selettore integrato. I dataset sono obbligatori; ricerca e paginazione restano i
soli filtri generici supportati. Nessuna pagina UI dedicata per la fetta
territoriale.

## Riproduzione offline

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 scripts/etl/istat_economia_non_osservata.py --check

DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 scripts/etl/istat_economia_non_osservata_territoriale.py --check

DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 -m unittest tests.etl.test_istat_economia_non_osservata \
    tests.etl.test_istat_economia_non_osservata_territoriale
```

`--publish` rigenera i dataset dal workbook bloccato e chiude nella stessa
transazione chunk, ricevute, catalogo, dataset proof e release proof globale.
Non richiede archivi privati, mappe sorgente, database o credenziali.

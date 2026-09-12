# Disuguaglianza dei redditi: Eurostat EU-SILC

La pagina `/disuguaglianza` consegna il primo perimetro di
[#380](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/380):
due indicatori nazionali della distribuzione dei redditi. Rimangono separati
la povertà ([#329](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/329),
`/poverta`) e il benessere territoriale
([#281](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/281)).
Non sono inclusi patrimonio, salari, microdati, confronti UE o classifiche.

## Fonte e perimetro

Titolare: Eurostat, Commissione europea. Il source lock
`scripts/etl/specs/eurostat-inequality.source.json` conserva due risposte
JSON-stat 2.0 dell'API statistica ufficiale, acquisite e verificate il
12 settembre 2026. Le fixture originali sono in
`tests/fixtures/eurostat-inequality/`.

| Indicatore | Dataset | Filtri oltre a Italia e frequenza annuale | Byte | SHA-256 |
| --- | --- | --- | ---: | --- |
| Gini | `ilc_di12` | `age=TOTAL`, `statinfo=GINI_HND` | 3.513 | `3583d651f4693abf73b79968736bf955295a15e0aed92292a3da39c7ecf933cf` |
| S80/S20 | `ilc_di11` | `age=TOTAL`, `sex=T`, `unit=RAT` | 3.563 | `60dafcc481e14e2aefdb95c99beeac108765a9cedce4677fd1bc1e625d765bc3` |

Gli URL completi, con `sinceTimePeriod=2014` e `untilTimePeriod=2025`,
sono nel lock. Entrambe le risposte dichiarano aggiornamento
`2026-06-08T23:00:00+0200`; questo timestamp non viene trasformato in data di
prima pubblicazione. Il campo `publicationDate` del corpus resta nullo.
L'aggiornamento della statistica è annuale; revisioni della fonte richiedono
una nuova acquisizione verificata, non vengono concatenate automaticamente.

I [metadati EU-SILC](https://ec.europa.eu/eurostat/cache/metadata/en/ilc_sieusilc.htm)
identificano come popolazione le persone nelle famiglie private residenti;
le convivenze istituzionali e collettive sono generalmente escluse.
Per l'Italia, l'anno dei redditi precede di un anno quello della
rilevazione: le rilevazioni 2014–2025 descrivono i redditi 2013–2024.

Il reddito disponibile equivalente tiene conto di imposte, trasferimenti e
composizione familiare. Il Gini è sulla scala 0–100. S80/S20 è il rapporto
fra il reddito complessivo del 20% superiore e quello del 20% inferiore
nella distribuzione: non è una percentuale e non misura la ricchezza
patrimoniale. I due indicatori non si sommano.

## Riutilizzo e trasformazione

Il [copyright notice Eurostat](https://ec.europa.eu/eurostat/web/main/help/copyright-notice)
autorizza il riutilizzo dei dati statistici con attribuzione secondo la
decisione della Commissione del 12 dicembre 2011. Il corpus usa
`verified-open-eu-reuse`; la clausola CC BY 4.0 relativa ai contenuti
editoriali non viene attribuita automaticamente ai payload statistici.
Selezione, traduzione e presentazione sono elaborazioni DVNS, di cui Eurostat
non è responsabile.

Il percorso scelto è il corpus integrato, `publication: rows`: un dataset
`eurostat-disuguaglianza-redditi`, 24 righe, con indicatore, anno di
rilevazione, anno dei redditi, valore, unità, stato e URL fonte. I valori
sono letti come decimali ed emessi come stringhe senza arrotondamento; i
numeri della pagina vengono derivati dal selettore pubblico condiviso.
Non esiste uno snapshot JSON separato della pagina.

Il parser blocca hash, schema, codici o indici dimensionali divergenti,
versioni della struttura inattese, flag non riconosciuti e celle mancanti.
Le fixture acquisite hanno 24 valori osservati e nessun flag. La vista
mantiene separati zero e valore mancante; un'eventuale interruzione di serie
`b` interrompe la linea. I grafici partono da zero e sono accompagnati dalle
tabelle esatte, accessibili da tastiera. Nessun confronto territoriale è
ricavato dai dati nazionali.

## Verifica e aggiornamento

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 scripts/etl/eurostat_inequality_corpus.py check
node --experimental-strip-types --test tests/inequality-page.test.mjs
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 -m unittest discover -s tests/etl -p 'test_eurostat_inequality_corpus.py'
```

Il publisher usa l'append comune e rigenera insieme catalogo, chunk,
ricevute, prova del dataset, prova della release e prova della vista SIOPE
collegata alla release. Un errore ripristina gli artefatti precedenti.
Quando si integra questa PR con un'altra aggiunta al corpus, i conteggi e
le prove vanno rigenerati sul corpus combinato: non si sceglie arbitrariamente
uno dei due file generati in conflitto.

# Appalti ente: filtro CPV

Questa fetta della [issue #185](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/185)
aggiunge il filtro per categoria CPV a `/enti/[codice]/appalti`. Sintesi,
aggiudicatari, procedure, aggiudicazioni e indicatori usano lo stesso insieme di
CIG. Il filtro resta nei link di dettaglio, nel cambio vista e nella paginazione;
applicare una nuova categoria riparte dalla sintesi.

La stessa categoria non definisce un mercato omogeneo o un gruppo di enti
comparabili. Benchmark, percentili, soglie normative e bunching restano fuori
da questa fetta; la issue #185 resta aperta.

## Fonte, periodo e binario

Fonte: [ANAC, CIG anno 2025](https://dati.anticorruzione.it/opendata/dataset/cig-2025),
licenza CC BY-SA 4.0 verificata nel portale il 7 settembre 2026. I dodici archivi
mensili riacquisiti coincidono con hash e byte del source lock già pubblicato
in `anac-entity-procurement.source.json`. Non è una nuova annualità o un
aggiornamento degli importi: il periodo è quello delle **pubblicazioni CIG 2025**,
mentre aggiudicazioni, aggiudicatari e anagrafiche mantengono le date distinte
del profilo esistente.

Il binario è un **indice derivato dello snapshot tipizzato esistente**. Contiene
soltanto codice IPA e classificazioni delle procedure (`cig`, `rawCode`,
`description`). Non duplica importi, identità degli operatori o un dataset del
corpus integrato. Non introduce un altro dataset MCP per la stessa tabella.
Il source spec dell’indice lega SHA del source lock e SHA del metadata dei
profili; ogni shard del profilo è verificato prima del join.

Copertura verificata:

- 1.475.581 righe dei dodici archivi, di cui 1.453.918 prevalenti e 21.663 non
  prevalenti; un solo record prevalente per CIG in tutto il rilascio;
- 23.737 profili ente già pubblicati, anche quando privi di procedure;
- 911.558 procedure del perimetro pubblico, tutte riconciliate su CIG e data di
  pubblicazione e tutte con un formato CPV interpretabile;
- nessuna pretesa di copertura nazionale corrente.

## Codici e importi

Sono conservati codice e descrizione originali ANAC. Il filtro confronta le
otto cifre del codice: `45112000` e `45112000-5` appartengono alla stessa
selezione. Spazi esterni sono ignorati nel confronto; il valore originale resta
visibile. Non si inferiscono codici dalle descrizioni e non si ricostruiscono
zeri iniziali. Celle vuote, codici di formato diverso e `00000000` confluiscono
nella selezione esplicita dei CPV mancanti o non interpretabili. Il controllo
del formato non certifica l’appartenenza alla nomenclatura o la cifra di
controllo. Descrizioni diverse per lo stesso codice sono conservate.

Il filtro seleziona **procedure intere**, poi ricalcola le metriche dalle loro
aggiudicazioni distinte. Un importo positivo contribuisce una sola volta per
`(CIG, ID_AGGIUDICAZIONE)`. Il valore individuale resta attribuibile soltanto a
un aggiudicatario singolo risolto; importi multipartiti o ambigui rimangono non
attribuiti. Zero, negativo, mancante, non valido e in conflitto non vengono
trasformati in valori positivi. Le somme conservano tutti i decimali della
fonte, anche sotto il centesimo; sono importi di aggiudicazione dichiarati,
**non pagamenti**.

I riferimenti degli operatori restano stabili cambiando categoria. Le
denominazioni e il numero delle loro varianti restano quelli del profilo
completo. Rank e quote sono ricalcolati per la categoria; i requisiti di
pubblicazione degli indicatori, inclusa la soglia di 30 osservazioni, restano
quelli del contratto esistente. Nei pari merito Top 1 e Top 10 selezionano
rispettivamente uno e al massimo dieci operatori nell’ordine deterministico
per rango, denominazione e riferimento, identico alla formula dell’indicatore.
Il dettaglio non include ulteriori ex aequo che cambierebbero il numeratore.

## Errori e riproduzione

Un codice sintatticamente valido assente dal profilo produce una selezione
vuota. Un indice mancante, alterato o di un’altra versione non produce né zero
né il profilo completo sotto il filtro richiesto: la UI dichiara il filtro non
disponibile. Query CPV duplicate o non valide sono rifiutate.

Gli archivi restano fuori Git, mentre indice e prova sono versionati:

```bash
python3 scripts/etl/anac_procurement_cpv.py --input-dir /path/to/locked-cig-archives
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/anac_procurement_cpv.py --check
node --experimental-strip-types --test tests/anac-procurement-cpv.test.mjs tests/anac-concentration-drilldown.test.mjs
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p test_anac_procurement_cpv.py
```

La generazione verifica archivi, membro ZIP, CRC, header, byte e SHA completi,
poi pubblica l’indice solo dopo le riconciliazioni. Il check offline verifica
tutti gli shard e l’insieme ordinato dei CIG di ogni profilo. Una variazione del
profilo richiede la rigenerazione dell’indice: non esiste un fallback su join
testuali o su dati live.

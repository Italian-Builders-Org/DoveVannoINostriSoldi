# Catalogo nazionale dei progetti PNRR

La issue #248 porta il rilascio completo **Progetti del PNRR**, versione 13.0,
in `/pnrr`, `/api/pnrr/progetti` e MCP `pnrr_progetti`. Il dataset canonico è
`pnrr-progetti`, interrogabile anche in `/dati/pnrr-progetti` e nell'API
integrata. La pagina e MCP leggono le stesse righe validate attraverso
`integrated-public-view.ts`.

## Fonte e date

Titolare: MEF · Ragioneria Generale dello Stato, Italia Domani / ReGiS.
Le schede ufficiali di [Progetti del PNRR](https://www.italiadomani.gov.it/content/sogei-ng/it/it/catalogo-open-data/Progetti_del_PNRR.html)
e [Localizzazione dei progetti](https://www.italiadomani.gov.it/content/sogei-ng/it/it/catalogo-open-data/localizzazione-dei-progetti-del-pnrr.html)
dichiarano versione **13.0**, osservazione **13 giugno 2026**, licenza
**CC BY 4.0**. Schede e dizionari XLSX verificati il 7 settembre 2026.

- Riferimento: `2026-06-13`, verificato in ogni riga dei due CSV.
- Acquisizione: `2026-09-07`; timestamp UTC distinti per asset nel source lock.
- Pubblicazione: non dichiarata separatamente; `publicationDate: null`.
- Frequenza: periodica alla fonte; questo rilascio ha aggiornamento manuale.

I quattro asset completi sono vincolati da URL, byte e SHA-256 in
`scripts/etl/specs/pnrr-projects.source.json`: `PNRR_Progetti.csv`,
`PNRR_Localizzazione.csv` e i rispettivi `*_Metadati.zip`.
Il CSV Progetti acquisito qui ha hash diverso da quello fissato dal verticale
asili, pur dichiarando la stessa data di estrazione: i rilasci restano distinti,
non aggiorniamo implicitamente lo snapshot asili.

## Unità e copertura

| Misura | Conteggio |
| --- | ---: |
| Registrazioni CUP/CLP/submisura | 291.398 |
| CUP formalmente validi distinti | 285.992 |
| Registrazioni con CUP segnaposto | 2 |
| Righe di localizzazione collegate | 347.602 |
| Registrazioni prive di localizzazione | 40 |
| Missioni / componenti | 7 / 17 |
| CF attuatore oscurati / mancanti | 94 / 2 |
| Registrazioni senza codice univoco misura | 8 |

Le due identità segnaposto sono esattamente `N/A` / `N/A` /
`M1C2I1.01.00` e `N/A2` / `N/A2` / `M2C3I2.01.00`. Restano righe della fonte,
ma non entrano nell'indice CUP o nel numero di CUP validi. Altri CUP non
conformi bloccano la proiezione. Le registrazioni hanno chiave univoca
`(CUP, Codice Locale Progetto, Codice Univoco Submisura)`; non vengono
collassate sul solo CUP. Per esempio `E59J21011940003` ha 1.163 registrazioni.

L'unione delle localizzazioni usa la stessa tripla esatta. Nessun orfano è
ammesso. La cella `Localizzazioni` conserva tutte le righe collegate come
array JSON di tuple, in ordine sorgente:

```text
[Regione, Descrizione Regione, Provincia, Descrizione Provincia,
 Comune, Descrizione Comune, Percentuale di Localizzazione]
```

Indirizzo e CAP sono esclusi dalla proiezione. Le celle territoriali vuote
sono `null`; l'array vuoto identifica le 40 registrazioni senza localizzazione.
Regione `000` significa ambito nazionale; Provincia o Comune `000` indicano
ambiti sovracomunali. I codici storici non vengono raccordati a confini attuali.
Il codice comunale di ricerca è `Provincia+Comune`, sei cifre: `058091` per Roma.

I filtri territoriali combinati devono coincidere **nella stessa tupla**:
una registrazione multilocalizzata non può soddisfare una regione con una
localizzazione e una provincia con un'altra. Il conteggio filtrato riguarda
registrazioni, senza moltiplicarle per il numero di luoghi.

## Significato degli importi

`Finanziamento PNRR` è il finanziamento europeo RRF; `Finanziamento Totale`
è il finanziamento complessivo del progetto. I dizionari spiegano che sono
inclusi anche progetti con finanziamento PNRR zero che contribuiscono ai target.
Sono stringhe decimali in euro, con virgola e al massimo due cifre decimali.
Il formatter aggiunge separatori e centesimi senza conversione in floating point.
Vuoto resta mancante, `0` resta uno zero osservato. Token sconosciuti e
precisioni maggiori bloccano l'acquisizione: nessun arrotondamento implicito.

Non sono pagamenti, somme erogate o costi effettivamente sostenuti. Non
sommiamo finanziamento totale e PNRR, non ripartiamo gli importi per
localizzazione e non ricaviamo classifiche di ritardo, spreco o efficacia.
Le percentuali territoriali sono esposte come dichiarate, senza correzioni o
normalizzazione a 100. Soggetto attuatore e luogo dell'intervento sono distinti.
I progetti sono pubblicati indipendentemente dalla validazione; l'esito resta
visibile. Stato, validazione e disponibilità del servizio non sono sinonimi.

## Indici e contratto pubblico

Gli indici contengono solo numeri di riga del corpus, suddivisi per CUP,
missione, componente, misura, submisura, CF attuatore e territorio. Due indici
composti preservano le associazioni regione/provincia e regione/comune.
Il manifest lega gli hash compressi, i byte decompressi, il source lock e la
ricevuta del dataset. `--check` ricostruisce integralmente gli indici dalle righe
pubbliche e confronta il loro digest con la ricevuta.

Runtime: massimo 16 MiB per file indice; cache limitata agli 11 indici di questo
rilascio; letture a lunghezza verificata, hash e decompressione limitata.
Il pacchetto MCP esclude soltanto i ledger elementari di intake, usati dai
controlli offline e non letti dal runtime; mantiene ricevute, proof, catalogo
e tutti i chunk pubblici.
Ogni risposta legge al massimo otto chunk del corpus e 16 MiB decompressi,
con `limit` da 1 a 100 (default 25). Per filtri con righe sparse la pagina può
contenere meno di `limit`; `nextCursor` consente di proseguire senza salti.
Il cursor è legato a filtri normalizzati e digest della release; cambiare
filtri o release invalida il cursor. `matchedRows` è esatto e conta registrazioni.

API e MCP accettano `cup`, `mission`, `component`, `measure`, `submeasure`,
`code` (CF attuatore), `region`, `province`, `territory`, `limit`, `cursor`.
I filtri sono codici esatti combinati in AND. Parametri sconosciuti, ripetuti,
malformati o fuori limite sono errori; nessuna ricerca testuale o offset su
questa vista. La tabella generica conserva il proprio contratto `q`/cursor.
Esempio API:

```text
/api/pnrr/progetti?mission=M1&region=012&limit=25
```

Esempio MCP `query_dataset`:

```json
{"dataset":"pnrr_progetti","cup":"F81C23001370006","limit":25}
```

I 94 CF oscurati restano asterischi e non sono indicizzati; i due CF vuoti non
sono ricostruiti. La fonte espone anche tre codici esteri `FR` seguiti da 11
cifre. Nuovi formati, inclusi CF personali non oscurati, richiedono revisione
esplicita prima della pubblicazione.

## Riproduzione, promozione e conservazione

Seguendo [ADR-001](architecture/ADR-001-generated-artifacts-storage.md), Git
contiene la proiezione compressa, il source lock, le ricevute e gli indici del
prodotto. I CSV originali (circa 383 MB complessivi) e i metadati sono acquisiti
fuori da Git, mai durante una richiesta Next.js. Nessun provider object
storage è configurato da questa modifica: il lock non viene presentato come
prova di archiviazione remota. Per conservazione esterna si applica il
contratto di chiavi `sha256/<digest>`, versioning e backup definito nell'ADR.

In un worktree isolato, con i quattro file originali in `INPUT_DIR`:

```bash
python3 scripts/etl/pnrr_projects.py --input-dir "$INPUT_DIR" --output-dir "$PROJECTION_DIR"
```

Il comando verifica hash, header, periodo, chiavi, importi, privacy, unione
territoriale e copertura. Produce `pnrr-progetti.psv`. La specifica del corpus
vincola anche byte e digest di questa proiezione; non viene aggiornata
implicitamente. Per aggiungere il dataset alla release preservando gli altri
artefatti e generare indici/proof, usare il comando completo:

```bash
python3 scripts/etl/pnrr_projects.py --input-dir "$INPUT_DIR" --output-dir "$PROJECTION_DIR" --promote
python3 scripts/etl/pnrr_projects.py --input-dir "$INPUT_DIR" --check
```

La promozione riusa la funzione condivisa di append del corpus e aggiorna
la proof della vista SIOPE legata alla release complessiva, senza modificarne
i dati o i totali. Per il
controllo ordinario, senza gli originali:

```bash
python3 scripts/etl/pnrr_projects.py --check
```

I comandi intermedi operano solo sul checkout isolato: nessun prodotto
parziale viene pubblicato. Commit e PR comprendono proiezione, indici,
contratti e proof insieme. I byte originali servono per riprodurre la
trasformazione; il controllo ordinario offline verifica corpus e indici
committati, non dichiara di aver riscaricato il rilascio. Un nuovo upstream
richiede acquisizione completa, revisione del lock, copertura, totali del ledger,
rigenerazione e tutti i gate CI. Rollback: revert del commit completo.

## Verifiche

Test ETL: identità duplicate, CUP condivisi fra CLP, localizzazioni orfane,
importi, mascheramento, hash, header, periodo e chiusura dei conteggi.
Test Node: indici, paginazione completa, congiunzioni territoriali, concordanza
API/MCP/corpus, cursor errati, input non supportati e file indice alterati.
Il controllo Browser esercita filtri, paginazione, espansione dei dettagli,
assenza di risultati e focus tastiera su desktop e mobile.

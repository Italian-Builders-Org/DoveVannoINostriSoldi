# Anno di aggiudicazione nel profilo ente

La pagina `/enti/[codice]/appalti` accetta `awardYear=YYYY` oppure
`awardYear=undated`. Il default, parametro assente o vuoto, conserva il profilo
corrente completo, comprese procedure senza aggiudicazioni e date non disponibili.

L'anno deriva esclusivamente da `awardedAt`: il campo ANAC
`data_aggiudicazione_definitiva`, validato dal contratto già pubblicato.
`publishedAt` è la data di pubblicazione del CIG e non determina il filtro.
Date mancanti, non interpretabili o in conflitto sono già `null` negli snapshot:
la vista le raggruppa come «Data non disponibile», senza inferire un anno o la
causa precisa dell'assenza. Date malformate sono rifiutate dal contratto.

Il perimetro resta quello dei profili ANAC verificati: coorte CIG 2025,
snapshot cross-temporali. Gli anni non rappresentano l'intero mercato né un
confronto storico a copertura costante. Fonte, licenza, date di acquisizione e
importi dichiarati (non pagamenti) restano quelli del profilo. Nessun nuovo
archivio o identificativo operatore globale viene introdotto.

Il CPV seleziona prima i CIG; l'anno seleziona poi le singole aggiudicazioni.
Aggiudicazioni di anni diversi dello stesso CIG non si trascinano tra loro.
Solo i CIG delle aggiudicazioni selezionate restano nella vista Procedure.
Le opzioni anno contano le aggiudicazioni nel CPV selezionato; i conteggi delle
opzioni CPV descrivono invece il profilo prima del filtro anno, come indicato
nel pannello.

Un'unica derivazione ricalcola sintesi, ranking, importi decimali esatti e
concentrazione. Le soglie di pubblicazione, le relazioni per numero e le
esclusioni per valore (RTI, identità ambigue, importi non positivi/mancanti/in
conflitto) restano invariate. Navigazione, paginazione e contratti degli
indicatori conservano entrambi i filtri. I riferimenti operatore restano locali
al profilo. I peer esistenti sono accessibili soltanto dalla vista senza filtri,
perché non esiste un benchmark annuale verificato.

Verifica mirata: `node --experimental-strip-types --test tests/anac-award-year.test.mjs`.
La suite browser `scripts/browser/procurement-award-year.mjs`, eseguita dal gate
di produzione CI, conserva screenshot a 320/390/768/1280 px in
`artifacts/browser/procurement-award-year/`.

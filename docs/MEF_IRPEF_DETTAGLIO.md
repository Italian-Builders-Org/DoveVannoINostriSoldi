# Dettaglio IRPEF: periodo e interrogazione

La PR #300 integra il perimetro approvato nella #258: nove famiglie, 79 CSV,
25.534 righe, fonte + API + MCP. Il maintainer ha approvato lo snapshot tipizzato
per gli schemi per file e per le misure fiscali distinte nel
[thread della fonte](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/258#issuecomment-5551861102).
Non è un nuovo JSON di pagina: conserva il contratto concordato fra ETL, API e MCP.

Il [catalogo ufficiale](https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?opendata=yes)
distingue anni di dichiarazione e anni di imposta. I file 2017-2025 descrivono
le dichiarazioni 2017-2025, relative agli anni di imposta 2016-2024. Per esempio,
la dichiarazione 2021 riguarda il 2020 e contiene sia Bonus IRPEF sia Trattamento
integrativo. Non si devono attribuire quelle misure all'anno economico 2021.

`period` e `year` indicano gli anni di dichiarazione, con
`periodBasis: declaration-year`. `taxPeriod` e `table.taxYear` indicano il
periodo economico. `table.publicationDate` viene dalla scheda del catalogo:
non è né l'acquisizione né l'anno di dichiarazione. Il source lock conserva
anche la ricevuta SHA-256 del catalogo usato per queste corrispondenze.

## Filtri e paginazione

API: `/api/territori/irpef-dettaglio?anno=2025&famiglia=tipo_reddito&taglio=regione&limit=50&offset=0`.
MCP: `mef_irpef_dettaglio`, con `year`, `family`, `breakdown`, `limit`, `offset`.
`anno`/`year` filtra l'anno di dichiarazione; la risposta espone sempre l'anno
fiscale. Serve almeno uno dei tre filtri di contenuto. Parametri sconosciuti,
ripetuti, frazionari o fuori intervallo vengono rifiutati.

La pagina contiene al massimo 100 righe (default 50), nell'ordine stabile del
lock. `pagination.nextOffset` permette di proseguire; `totalRows` è il numero
di righe filtrate, non un totale monetario. Una tabella può avere zero righe
nella pagina corrente senza essere un rilascio vuoto: `table.rows` conserva
il conteggio completo e `coverage.emptyReleases` dichiara i rilasci vuoti.
Ogni tabella espone URL, byte e SHA-256 del CSV, unità/natura delle misure e
limiti di utilizzo. Frequenze, importi, conteggi, assenze e zeri restano distinti.

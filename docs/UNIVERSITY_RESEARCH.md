# Università e Ricerca

MVP della [issue #101](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/101):
`/istruzione/universita-ricerca` mostra gli stanziamenti di competenza CP A1
pubblicati dalle Leggi di Bilancio 2017-2026. Riusa il contratto e lo snapshot
`openbdap-budget-law-missions.json`, senza acquisizioni o aggregati duplicati.

## Selezione riproducibile

| Codice RGS | Nome esatto nello snapshot |
|---|---|
| 023 | Istruzione universitaria e formazione post-universitaria |
| 017 | Ricerca e innovazione |

La corrispondenza è pubblicata nelle [tavole RGS delle missioni e dei programmi](https://www.rgs.mef.gov.it/_Documenti/VERSIONE-I/e-GOVERNME1/Contabilit/Pubblicazioni/MissionieProgrammi/Missioni-programmi-e-azioni-edizione-febbraio2021.pdf).
Il prodotto AMPMA già integrato conserva il **nome**, non il codice: il filtro
usa uguaglianza esatta sul nome, senza ricerca testuale o filtro per ministero.
Le voci di ciascuna missione includono tutte le amministrazioni che vi riportano
stanziamenti. Le due missioni non sono sommate fra loro.

Il validatore esistente verifica identità, licenza, hash dello snapshot,
copertura annuale, matrice completa senza duplicati, importi e variazioni.
Un nome non disponibile viene rifiutato; non diventa uno zero o un totale generale.
La build della pagina fallisce se lo snapshot non supera il contratto.

## MCP

Il dataset esistente `openbdap_legge_bilancio_storico` accetta `mission`, nome
esatto di una delle missioni disponibili. La risposta conserva fonte, date,
modalità snapshot e finestra temporale; filtra missioni, stanziamenti e variazioni.
Senza filtro resta invariata la risposta con tutte le missioni e sei anni di default.

```json
{
  "dataset": "openbdap_legge_bilancio_storico",
  "years": 10,
  "mission": "Ricerca e innovazione"
}
```

## Limiti

- Euro correnti, non corretti per inflazione; stanziamenti, non pagamenti.
- Ricerca comprende anche enti non universitari. Università comprende l'alta formazione.
- Non sono bilanci completi di atenei né un totale nazionale della ricerca.
- FFO/MUR, bilanci atenei, PRIN e PNRR richiedono fonti e issue proprie.
- Date di riferimento, acquisizione e aggiornamento dei metadati sono distinte.
- Grafici con origine zero e scala comune; valori esatti nella tabella accessibile.

## Verifiche

`tests/university-research.test.mjs` verifica serie, selezione MCP, errori e
scoperta nella navigazione. `scripts/browser/university-research.mjs`, incluso
nel core browser, controlla le larghezze 390/768/1280 px, i valori in tabella,
la tastiera e i limiti. Lo smoke MCP HTTP esercita entrambe le missioni e un
nome parziale non valido. Restano attivi i gate generali della repository.

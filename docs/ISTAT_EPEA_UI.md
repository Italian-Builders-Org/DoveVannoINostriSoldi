# Spesa per la protezione dell’ambiente

La pagina `/spese/ambiente` completa la superficie di lettura dello snapshot
EPEA già versionato per la #86. Non acquisisce nuove fonti e non introduce un
artifact di pagina. Il loader `istat-epea-snapshot.ts` è condiviso con API e MCP.

## Perimetro

La vista seleziona esclusivamente `EPS_NEXP`, Italia (`IT`), prezzi correnti
(`V`), edizione `2025M2`, anni 2016–2022. Mantiene separati totale economia
(`S1`), amministrazioni pubbliche **e** istituzioni sociali private (`S13_15`),
famiglie (`S14`) e società (`S1K`). Non presenta S13_15 come sola PA.

Le sette classi CEPA non includono `TOT_CEPA`: il totale pubblicato compare
separatamente e non è ricalcolato sommando valori arrotondati. La serie storica
usa lo stesso settore e la stessa edizione. Le cifre sono espresse in milioni
di euro correnti, con un decimale; nessuna quota del PIL viene ricostruita.
La classificazione e il significato sono confrontabili con il
[rapporto ISTAT di febbraio 2025](https://www.istat.it/wp-content/uploads/2025/02/REPORTECONOMIAAMBIENTE_20250221.pdf).

Anno di riferimento, edizione e acquisizione restano distinti. La fonte SDMX,
l’hash bloccato e il limite della licenza non dichiarata sono accessibili dalla
pagina. RGS, PNRR, SAD/SAF e attribuzioni territoriali restano fuori perimetro.

## Interazione e verifiche

Il form GET rende condivisibili `anno` e `settore` e funziona senza JavaScript.
Valori non supportati, parametri ripetuti o vuoti restituiscono una pagina 404;
non vengono sostituiti con un anno o settore diverso. I parametri estranei
alla selezione non cambiano il dato. La ricerca del sito, il menu Soldi e la
sitemap espongono la pagina canonica.

`istat-epea-view.ts` seleziona un’unica osservazione per cella, rifiuta duplicati,
importi incoerenti e perimetri inattesi. Assenza e null vengono mostrati come
dato non disponibile, senza sostituirli con zero. Le barre sono decorative;
tabelle con caption e intestazioni espongono gli stessi importi.

- `tests/istat-epea-view.test.mjs`: golden su snapshot, tutte le 28 selezioni,
  isolamento dagli altri aggregati, query ambigue, null/zero e contratti negativi.
- `scripts/browser/epea.mjs`, incluso nei gate core: 320/390/768/1280 px,
  cambio settore/anno da tastiera, corrispondenza con API, apertura provenance
  e assenza di overflow.

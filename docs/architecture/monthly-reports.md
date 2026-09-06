# Report mensili: capsule editoriali sigillate

## Problema

Un report storico non deve cambiare quando si aggiornano i dataset correnti.
Ogni edizione conserva quindi valori, periodi, perimetri, denominatori, limiti
e prove usati al momento della pubblicazione.

## Uso

Le pagine pubbliche dipendono solo da `monthlyReports.listPublished()` e
`monthlyReports.getPublished(issueMonth)`. Il comando redazionale genera una
bozza da artefatti committati; una PR revisionata è l'unico passaggio di
pubblicazione.

## Forma scelta

Le edizioni sono oggetti TypeScript tipizzati. Le bozze sono fisicamente
separate dai pubblicati. Il catalogo nasconde validazione, ordinamento, lookup,
tempo di lettura e URL. Le righe di ogni figura alimentano sia il grafico sia la
tabella accessibile.

La sintesi usa come base le capsule fortemente tipizzate e incorpora due
protezioni aggiuntive: directory separate per le bozze e un registro esplicito
delle correzioni. MDX, selettori live e tabelle duplicate sono stati esclusi.

## Trade-off

Accettiamo file editoriali più strutturati in cambio di prove verificabili,
route statiche e articoli storici realmente immutabili. La scadenza del giorno
10 resta un obiettivo editoriale, non un errore di validazione.

# Principi legali ed etici

DoveVannoINostriSoldi nasce per aumentare l'accessibilità di dati già pubblici, non per trasformare un database in un tribunale automatico.

## Dati pubblici non significa “qualsiasi riuso senza contesto”

Prima di acquisire una sorgente verifichiamo:

- base legale della pubblicazione;
- licenza o condizioni di riuso;
- presenza di dati personali;
- necessità e proporzionalità della ripubblicazione;
- accuratezza e data di aggiornamento;
- eventuali limiti all'indicizzazione.

Quando la normativa impone pubblicazione per un periodo limitato, l'architettura deve poter applicare retention coerente anche se tecnicamente il dato storico è stato acquisito.

## Persone fisiche

Non raccoglieremo dati personali “perché interessanti”.

La pubblicazione nominativa deve essere giustificata dalla fonte e dal contesto normativo. Quando il valore civico è ottenibile con aggregazione o anonimizzazione, si preferisce la soluzione meno invasiva.

## Nessuna presunzione di colpevolezza

La dashboard può evidenziare:

- concentrazione degli affidamenti;
- ripetizione dello stesso fornitore;
- procedure vicine a una soglia;
- proroghe;
- differenze di prezzo rispetto a benchmark omogenei;
- ritardi;
- incompletezza dei dati.

Questi sono **segnali**, non prove di corruzione, frode o danno erariale.

L'interfaccia non userà etichette come “corrotto”, “disonesto” o “spreco accertato” senza una fonte istituzionale che sostenga precisamente quella qualificazione e il relativo stato procedurale.

## Diritto di replica e correzione

Prevediamo un canale per:

1. segnalare errori nel nostro parsing;
2. indicare una fonte ufficiale più aggiornata;
3. contestare un join errato;
4. chiedere revisione di un indicatore.

Le correzioni del nostro sistema saranno versionate e spiegate.

## Separare fatti e indicatori

Esempio corretto:

> “Questo ente ha affidato il 61% del valore osservato a un singolo fornitore nel periodo X, secondo i record ANAC indicati. La mediana del gruppo comparabile è Y.”

Esempio scorretto:

> “Questo ente favorisce il fornitore.”

Il primo è una misura verificabile; il secondo attribuisce un comportamento che il dato da solo non dimostra.

## Redditi e IRPEF territoriali

Le variabili comunali MEF sono aggregati dichiarativi protetti da segreto
statistico. Una cella oscurata resta sconosciuta e non viene convertita in zero,
stimata o ricostruita. La riga `Mancante/errata` resta nel totale nazionale ma
non viene attribuita a un territorio.

L'**imposta netta dichiarata** non viene chiamata gettito totale e non viene
combinata con spese o saldo CPT. Differenze territoriali non dimostrano
evasione, frode, merito amministrativo o responsabilità individuali. Non sono
pubblicate classifiche pro capite senza un denominatore ISTAT dello stesso anno
e una spiegazione esplicita della differenza fra residenti e contribuenti.

## Enforcement

Revoche, sanzioni, responsabilità disciplinari, erariali o penali competono alle autorità e ai procedimenti previsti dalla legge. DoveVannoINostriSoldi può rendere più semplice trovare e verificare i fatti pubblici, non sostituire il due process.

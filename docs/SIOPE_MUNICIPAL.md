# SIOPE · pagamenti di cassa dei Comuni

DoveVannoINostriSoldi usa la fonte primaria `siope.it` per il primo dataset territoriale operativo. OpenBDAP resta una fonte RGS importante per altri domini, ma non è il trasporto usato da questa pipeline.

## Perimetro del primo adapter

La dashboard `/territori` mostra esclusivamente i **pagamenti di cassa SIOPE dei Comuni**.

Un totale regionale significa:

> somma dei pagamenti dei Comuni la cui amministrazione è associata a quella regione.

Non significa:

> tutta la spesa pubblica effettuata fisicamente all'interno del territorio regionale.

Questa distinzione è parte del contratto del dato e deve restare visibile nella UI e nelle API.

## Fonti

La pipeline usa tre file ufficiali:

1. `SIOPE_USCITE.<anno>.zip`: movimenti nazionali di uscita;
2. `SIOPE_ANAGRAFICHE.zip`: anagrafiche degli enti e delle Province SIOPE;
3. `amministrazioni.txt` di Indice PA: join del codice fiscale dell'ente alla regione della sede amministrativa.

Il file annuale SIOPE contiene movimenti mensili puri. Non è una successione di snapshot cumulativi: per questo il grafico mensile non calcola differenze tra rilasci. Il cumulato visualizzato da DoveVannoINostriSoldi è semplicemente la somma progressiva dei flussi mensili.

Gli importi SIOPE sono elaborati come interi in centesimi e convertiti in euro soltanto nello snapshot finale. In questo modo l'ETL evita errori di somma dovuti a floating point durante le aggregazioni.

## Join territoriale

Il join regionale usa:

`codice ente SIOPE → codice fiscale SIOPE → codice fiscale IPA → Regione IPA`

Non vengono usati matching fuzzy sul nome dell'ente. Se un codice fiscale non produce una regione univoca, l'ente resta fuori dall'aggregazione geografica e viene contabilizzato nella metrica `unmatchedToIpaRegion`.

Un Comune senza Regione IPA non viene scartato dal periodo nazionale: i suoi movimenti entrano
nel totale nazionale, nelle quote nazionali e nelle fasce dimensionali quando la popolazione è
valida. Non viene invece assegnato artificialmente a una Regione: resta fuori dagli aggregati
regionali, dai riepiloghi geografici della distribuzione e dalle classifiche comunali che mostrano
Provincia e Regione. `withRegion` e `withoutRegion` descrivono quindi soltanto i Comuni con
movimenti del periodo; `paymentsWithoutRegion` e le metriche analoghe della distribuzione
rendono riconciliabile l'importo che non è regionalizzabile.

La validità dell'anagrafica è valutata rispetto all'anno richiesto: `activeSiopeMunicipalities`
significa valido per almeno un giorno di quell'anno, non necessariamente ancora attivo oggi. Un
Comune storico cessato può quindi restare nel totale nazionale mentre la Regione IPA corrente non
è più disponibile; il dato non viene retrodistribuito sulla base del nome o di una Regione attuale.

Il contesto provinciale delle graduatorie usa invece una relazione interna allo stesso registro ufficiale:

`ANAG_ENTI_SIOPE.codice provincia → ANAG_REG_PROV → Provincia`

L'ETL rifiuta un codice provinciale sconosciuto: non deduce la Provincia dal nome del Comune e non distribuisce dati su territori non pubblicati dalla fonte.

La superficie e le caratteristiche territoriali vengono aggiunte in un secondo passaggio dallo snapshot annuale ISTAT SITUAS. Il collegamento usa il codice fiscale comunale esatto; non usa nomi o coordinate approssimate. Ogni annualità espone il totale originale SIOPE, il valore per abitante quando disponibile e il valore per km² quando è disponibile una superficie positiva. Il totale resta l'importo di riconciliazione e le normalizzazioni non modificano i movimenti sottostanti.

Il benchmark della scheda comunale esclude il Comune osservato. Parte da pari nella stessa fascia di popolazione e superficie e applica zona altimetrica, urbanizzazione, litoraneità e insularità; se non rimangono almeno dieci confronti, rilassa questi ultimi criteri in ordine dichiarato. Il risultato mostra mediana e intervallo interquartile, senza etichette di merito.

## Aggiornamento

Scaricare il file nazionale a ogni richiesta web sarebbe costoso e fragile. La pipeline è quindi separata dal rendering:

1. GitHub Actions controlla i validator HTTP delle fonti;
2. se `Last-Modified` non è cambiato e lo snapshot esiste, termina senza scaricare i file grandi;
3. quando cambia una fonte, scarica e valida i dataset;
4. genera `src/data/generated/siope-municipal.json`;
5. riconcilia automaticamente totali mensili, regionali e headline;
6. committa soltanto lo snapshot validato.

Il workflow è programmato ogni ora. **La frequenza del controllo non viene presentata come frequenza di pubblicazione del dato**: la piattaforma cambia soltanto quando cambia la fonte ufficiale. Le tre annualità pubblicate sono slot mobili calcolati dall'anno UTC corrente; al cambio di gennaio la pipeline passa automaticamente al nuovo anno e conserva i due precedenti senza richiedere modifiche al runtime.

## Contratto generato

Lo snapshot contiene:

- periodo e timestamp di generazione;
- totale pagato da gennaio;
- flussi mensili e cumulato;
- aggregazioni per regione;
- importi per abitante coperto;
- titoli di spesa;
- principali Comuni per volume e per abitante, con Provincia SIOPE e Regione della sede IPA;
- `distribution`, quando il refresh ha elaborato tutti i movimenti raw verificati: quote nazionali,
  quantili per abitante, fasce dimensionali e riepiloghi regionali; non contiene righe comunali;
- copertura del join;
- distinzione tra Comuni con e senza Regione IPA, con pagamenti non regionalizzabili riconciliati;
- URL, `Last-Modified`, `ETag` e hash SHA-256 dei file upstream quando il refresh è stato completato;
- warning metodologico mostrato anche nella dashboard.

L'API pubblica è `/api/spese/comuni`.
La superficie bounded `/api/spese/comuni/distribuzione?anno=YYYY` espone soltanto il riepilogo
compatto. Il contratto runtime rifiuta un artifact privo di `distribution`, con hash non validi o
con riconciliazioni divergenti; non prova mai a ricostruire la distribuzione dai primi 100 Comuni.

### Analisi della distribuzione

La quota mostrata in `/spese` è:

`somma dei pagamenti del Titolo 1 / somma di tutti i pagamenti SIOPE dei Comuni`

Il numeratore e il denominatore sono importi di cassa dello stesso periodo. `nationalShareAll`
usa tutti i Comuni con movimenti; `nationalShareCovered` usa soltanto i Comuni con popolazione
valida. Non sono due stime intercambiabili e nessuna delle due è un giudizio di efficienza.

La distribuzione pro capite usa `pagamenti del Titolo 1 / popolazione del Comune`. Il contratto
pubblica due famiglie di quantili, entrambe con nearest-rank senza interpolazione:

- `municipalityWeighted`: ogni Comune pesa uno;
- `residentWeighted`: ogni Comune pesa quanto la propria popolazione.

Il valore del quantile è la prima osservazione ordinata la cui cumulata raggiunge `p × peso totale`.
Le fasce dimensionali sono intervalli analitici fissi del portale, non una classificazione ufficiale
SIOPE e non una graduatoria di best/worst practice: includono tutti i Comuni con popolazione valida,
anche quando la Regione IPA manca. I riepiloghi regionali sommano soltanto i Comuni abbinati alla
Regione pubblicata da IPA; il loro scarto rispetto alle fasce è esposto come importo non
regionalizzabile, non colmato con una stima.

Il 2026, finché l'anno non è chiuso, è etichettato `partial`. Un confronto 2026 con gli anni chiusi
è descrittivo e non è presentato come trend: servono gli stessi mesi, lo stesso denominatore e una
popolazione di riferimento coerente. Le popolazioni dell'anagrafica SIOPE non hanno una data di
riferimento dichiarata dalla fonte, quindi i confronti storici pro capite non vengono promossi a
confronti temporali omogenei.

Il raw completo resta un input dell'ETL e non viene caricato nel client. Uno snapshot senza
`distribution` e hash/provenienza del refresh viene rifiutato dal contratto runtime e non può
essere pubblicato. Le liste `topMunicipalitiesByValue` e `topMunicipalitiesByPerCapita` restano
limitate ai primi 100 e non possono essere usate per calcolare quartili, medie nazionali o
distribuzioni regionali.

Il refresh evita il download soltanto quando i `Last-Modified` coincidono e, quando la fonte lo
pubblica, coincide anche l'`ETag`. Una sostituzione in-place con `ETag` diverso forza quindi un
nuovo download e un nuovo hash del contenuto.

## Quality gates

La CI ordinaria non dipende dalla disponibilità della rete SIOPE. Testa invece lo snapshot versionato e verifica, tra le altre cose, che:

- siano presenti tutte le 20 regioni;
- i Comuni con movimenti siano più di 7.000;
- `withRegion + withoutRegion` coincida con i Comuni con movimenti;
- i pagamenti regionali più quelli senza Regione ricompongano il totale nazionale;
- la somma dei flussi mensili ricomponga il totale;
- il cumulato finale coincida con il totale headline;
- i ranking restino ordinati;
- Provincia e Regione siano presenti in ogni riga dei ranking;
- non risultino righe malformate nello snapshot pubblicato.

Il download live e la validazione dell'ETL hanno un workflow separato, così un outage dell'upstream non trasforma un cambiamento di UI innocuo in una build rossa.

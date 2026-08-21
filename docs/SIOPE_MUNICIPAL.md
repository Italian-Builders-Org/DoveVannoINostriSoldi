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

Il contesto provinciale delle graduatorie usa invece una relazione interna allo stesso registro ufficiale:

`ANAG_ENTI_SIOPE.codice provincia → ANAG_REG_PROV → Provincia`

L'ETL rifiuta un codice provinciale sconosciuto: non deduce la Provincia dal nome del Comune e non distribuisce dati su territori non pubblicati dalla fonte.

## Aggiornamento

Scaricare il file nazionale a ogni richiesta web sarebbe costoso e fragile. La pipeline è quindi separata dal rendering:

1. GitHub Actions controlla i validator HTTP delle fonti;
2. se `Last-Modified` non è cambiato e lo snapshot esiste, termina senza scaricare i file grandi;
3. quando cambia una fonte, scarica e valida i dataset;
4. genera `src/data/generated/siope-municipal.json`;
5. riconcilia automaticamente totali mensili, regionali e headline;
6. committa soltanto lo snapshot validato.

Il workflow è programmato ogni ora. **La frequenza del controllo non viene presentata come frequenza di pubblicazione del dato**: la piattaforma cambia soltanto quando cambia la fonte ufficiale.

## Contratto generato

Lo snapshot contiene:

- periodo e timestamp di generazione;
- totale pagato da gennaio;
- flussi mensili e cumulato;
- aggregazioni per regione;
- importi per abitante coperto;
- titoli di spesa;
- principali Comuni per volume e per abitante, con Provincia SIOPE e Regione della sede IPA;
- copertura del join;
- URL e `Last-Modified` upstream;
- warning metodologico mostrato anche nella dashboard.

L'API pubblica è `/api/spese/comuni`.

## Quality gates

La CI ordinaria non dipende dalla disponibilità della rete SIOPE. Testa invece lo snapshot versionato e verifica, tra le altre cose, che:

- siano presenti tutte le 20 regioni;
- i Comuni con movimenti siano più di 7.000;
- la somma dei flussi mensili ricomponga il totale;
- la somma delle regioni ricomponga il totale entro la tolleranza di arrotondamento;
- il cumulato finale coincida con il totale headline;
- i ranking restino ordinati;
- Provincia e Regione siano presenti in ogni riga dei ranking;
- non risultino righe malformate nello snapshot pubblicato.

Il download live e la validazione dell'ETL hanno un workflow separato, così un outage dell'upstream non trasforma un cambiamento di UI innocuo in una build rossa.

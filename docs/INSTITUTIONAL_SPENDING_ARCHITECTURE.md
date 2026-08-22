# Spese istituzionali: confini dati e route

## Problema

Camera, Senato, Presidenza del Consiglio, Ministeri e Regioni pubblicano grandezze con perimetri e basi contabili diverse. Il prodotto deve offrire percorsi separati senza perdere provenienza, periodo o significato e senza costruire un totale istituzionale artificiale.

## Uso dal punto di vista del chiamante

```ts
const dossier = assertInstitutionalDossier(snapshot);
const result = compareInstitutionalFacts(dossier.facts[0], dossier.facts[1]);

if (!result.ok) {
  // La UI spiega perché i due valori non sono confrontabili.
}
```

Le pagine importano un solo modulo di dominio:

```text
/parlamento     -> dossier Parlamento
/palazzo-chigi  -> dossier Presidenza del Consiglio
/ministeri      -> rendiconto RGS dei Ministeri; dettaglio pagamenti separato già esistente
/regioni        -> conti propri regionali omogenei, quando verificati
```

Un eventuale `/istituzioni` orienta tra le route e mostra la copertura. Non somma valori.

## Forma scelta

`src/lib/data/institutional-contract.ts` contiene soltanto il confine comune:

- periodo di riferimento;
- perimetro, base contabile, fase e natura del documento;
- unità;
- fonte ufficiale, identificativo, date, hash e trasformazione;
- copertura completa, parziale, solo metadati o non integrata;
- regola fail-closed per la confrontabilità.

I dettagli restano nei moduli di dominio. Un dossier `metadata-only` o `not-integrated` non può contenere fatti numerici. Il contratto nasconde la validazione di provenienza e comparabilità, ma non pretende di unificare categorie contabili incompatibili.

## Decisione di sintesi

La base è il candidato “quattro dossier, un confine contabile comune”. È stata preferita all'alternativa a pacchetti per fonte perché quest'ultima costringeva ogni pagina a ricostruire le regole di confronto. È stata ristretta ulteriormente: il contratto comune non contiene tassonomie di categoria, aggregazioni o un totale trasversale.

## Alternative considerate

- **Magazzino unico di fatti istituzionali:** espone una tassonomia generica e rende facile sommare valori solo apparentemente simili. Respinto per information leakage.
- **Quattro contratti senza elementi comuni:** protegge i perimetri, ma duplica provenance, copertura e confrontabilità. Respinto perché offre un'interfaccia complessiva più ampia senza nascondere più complessità.

## Trade-off accettati

- Accettiamo loader distinti per mantenere ownership e significato contabile.
- Accettiamo superfici inizialmente sparse quando la fonte è solo metadata, invece di stimare importi.
- Manteniamo distinto il rendiconto elaborabile dei Ministeri dalla serie OpenBDAP che espone solo pagamenti.

## Rischi e domande aperte

- Quale release nazionale omogenea contiene i conti propri di tutte le Regioni e Province autonome con denominatori compatibili?
- Quali sezioni PCM possono essere pubblicate come dati strutturati oltre al rendiconto, senza mescolare incarichi, contratti e bilancio?
- I dati ANAC e Consulenti Pubblici offrono chiavi stabili per ogni istituzione o soltanto filtri di scoperta?

## Prossimo passo

Collegare il manifesto parlamentare al contratto, mantenendo il Senato `metadata-only`, e costruire la prima vertical slice Parlamento/Palazzo Chigi.

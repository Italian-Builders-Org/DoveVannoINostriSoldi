# Prima proposta UI iPhone — Atlante Imprese

Questo è un primo perimetro di contributo UI, non un'analisi dell'app iPhone
di DoveVannoINostriSoldi. Nel workspace non è presente un progetto iOS collegato
all'Atlante o a DVNS; il repository pubblico osservato è un'app web Next.js e
non espone un target Xcode nella sua struttura corrente. Prima di scrivere codice
native serve quindi che Dom condivida il target, le schermate e il contratto
tecnico dell'app.

## La proposta da offrire

Una vista native-first **Imprese** per iPhone, costruita attorno a una sola
azione: capire rapidamente dove si concentra un indicatore business e aprire
il dettaglio territoriale senza perdere il perimetro del dato.

### MVP UI

1. **Header compatto**: metrica corrente, periodo e badge “aggregato”.
2. **Mappa regionale touch-first**: tap su una regione, feedback aptico leggero e
   bottom sheet con nome, valore e definizione.
3. **Filtri come chip scorrevoli**: Imprese attive, Addetti, Localizzazioni,
   Fasce di valore della produzione; settore e periodo dentro una sheet secondaria.
4. **Classifica sincronizzata**: la stessa selezione aggiorna mappa e lista, con
   un'azione di condivisione che conserva fonte e periodo.
5. **Caveat sempre vicino al numero**: “valore della produzione” resta una fascia
   aggregata, mai fatturato esatto o scheda di una società.

## Direzione visiva

- blu business italiano già usato dal POC (#084b9d) su fondo chiaro;
- tipografia ampia per il numero principale, utility text compatto per periodo,
  fonte e licenza;
- bottom sheet e chip nativi, con transizioni brevi e rispetto di
  prefers-reduced-motion;
- niente dashboard miniaturizzata da desktop: una gerarchia verticale, un gesto
  principale e una sola informazione dominante per schermata.

## Contratto dati e confini

La prima versione dovrebbe decodificare lo stesso snapshot verificato di
src/data/generated/company-atlas-snapshot.json, oppure un endpoint JSON
versionato che ne conservi schema, periodo, provenienza e caveat. Non conviene
far parlare direttamente la UI con il protocollo MCP: MCP può restare il
canale per agenti, mentre l'app usa un client tipizzato sul contratto dati.

Il perimetro resta quello del POC:

- aggregati regionali e settore ATECO 2025;
- nessun nome di azienda, partita IVA, codice fiscale, indirizzo o scheda
  nominativa;
- fasce di valore della produzione, non ricavi puntuali;
- stato del dato e fonte visibili anche offline.

## Primo contributo realistico di Giuseppe

Senza accesso al codice dell'app di Dom, il contributo ad alta leva è preparare
un prototipo di una sola schermata — mappa, chip metrica e bottom sheet — e
consegnare insieme la gerarchia UI, gli stati vuoto/errore/aggiornamento e i
copy dei caveat. Dopo aver visto il target reale, quel prototipo può diventare
SwiftUI oppure una specifica da integrare nell'architettura già esistente.

## Gate prima di implementare

- Dom indica repository/target iOS e versione minima supportata;
- si verifica se l'app usa SwiftUI, UIKit o un'altra architettura;
- si concorda se la prima vista deve essere /imprese integrata in DVNS o un
  companion separato;
- si approva il contratto dati e la policy offline prima di aggiungere
  dipendenze native.

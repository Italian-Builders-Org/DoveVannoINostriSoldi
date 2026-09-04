# Atlante Imprese Italia — nota di integrazione

Questa PR propone una sezione business additiva per
**DoveVannoINostriSoldi**: la stessa base di dati pubblici, fonti esplicite e
server MCP, con una lettura del tessuto produttivo italiano accanto alla
superficie civica esistente.

## Cosa aggiunge

1. Una rotta `/imprese` con mappa regionale, classifica e filtri per metrica,
   periodo, regione, settore ATECO e fascia di valore della produzione.
2. Un contratto Zod e uno snapshot generato da tre fonti CC BY 4.0.
3. Tre dataset nel catalogo MCP esistente:
   `company_active_enterprises`, `company_workforce` e
   `company_production_value_bands`.
4. Un adapter read-only con paginazione limitata, query normalizzata,
   provenienza e caveat.
5. Test dedicati per schema, aggregazione, filtri, paginazione e invarianti
   aggregate-only, con riconciliazione della release workforce a `19.490.025`
   addetti e `6.394.474` localizzazioni attive.

La navigazione civica, il catalogo esistente, le risorse MCP e le rotte già
presenti restano intatti: il modulo è un nuovo ramo, non una sostituzione della
missione originaria del sito.

## Confini dei dati

- Solo aggregati regionali: nessuna ragione sociale, nominativo, partita IVA,
  codice fiscale o indirizzo.
- Le fasce di valore della produzione non sono fatturato, ricavi esatti o una
  classifica di società.
- Il CSV degli addetti contiene bucket ATECO osservati distinti: la pipeline
  somma tutte le righe, incluse quelle a maggiore specificità, a regione ×
  sezione senza selezionare una riga canonica. Le celle senza bucket restano
  `null`.
- Gli addetti sono posizioni previdenziali attive del trimestre precedente a
  quello indicato: non rappresentano il livello occupazionale territoriale e
  non sono direttamente comparabili con ISTAT/ASIA.
- Ogni risposta conserva editore, URL ufficiale, licenza, periodo e caveat.

## Perché in questa forma

Un modulo integrato rende subito testabile la domanda: la dimensione economica
può convivere con quella della spesa pubblica e, più avanti, con altri dati
territoriali? La separazione dei contratti consente di aggiungere in seguito
nuove fonti senza fingere che un dataset aggregato sia già un'anagrafe completa
delle aziende italiane.

## Evoluzione iPhone

La prima proposta UI native-first è separata dal codice web e non presume
accesso al target iOS. È allegata in [IOS_UI_PROPOSAL.md](IOS_UI_PROPOSAL.md):
una schermata touch-first con chip, mappa regionale e bottom sheet, alimentata
dallo stesso contratto dati e senza collegare direttamente la UI al protocollo
MCP.

## Verifica prevista

La PR include test del contratto, dell'adapter, della cardinalità e della
riconciliazione workforce; prima del merge vanno eseguiti
anche i gate standard del repository, la verifica browser responsive della
nuova rotta e lo smoke test HTTP del server MCP reale.

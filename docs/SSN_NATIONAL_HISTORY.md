# Serie storica nazionale del Conto Economico SSN

La pagina [/spese/sanita/storico](/spese/sanita/storico) estende `/spese/sanita` con una
serie storica **nazionale** del Conto Economico degli enti del SSN, dal 2012 al 2024. Non
sostituisce lo snapshot 2024 esistente (nazionale, regionale, per ente), che resta l'unica
fonte per il dettaglio regionale e per ente.

## Fonte

- **Titolare**: Ragioneria Generale dello Stato.
- **Dataset**: "Modello di rilevazione del Conto Economico degli enti del SSN a livello
  Nazionale", pubblicato annualmente su OpenBDAP RGS con un pacchetto CKAN per anno
  (`spd_ssn_cce_naz_voccn_01_<anno>`), verificato in diretta senza interruzioni dal 2012 al
  2024 (13 rilasci).
- **Formato**: CSV, stesso schema di colonne dello snapshot 2024 già in uso
  (`Anno di Riferimento`, `Codice Voce Contabile`, `Descrizione Voce Contabile`,
  `Data Aggiornamento`, `Importo Totale`).
- **Licenza**: Creative Commons Attribution.
- **Aggiornamento**: preferenza live su OpenBDAP a ogni richiesta; se la fonte è
  temporaneamente non disponibile, fallback allo snapshot nazionale committed
  (`freshness: "live"` con `dataMode: "live" | "snapshot"`).

## Budget e annullamento

La lettura dei 13 CSV annuali usa al massimo tre richieste concorrenti e un’unica deadline
globale di 50 secondi. Il route handler API dichiara un `maxDuration` di 60 secondi: il
margine residuo serve a serializzare la risposta e a chiudere la richiesta senza lasciare
il lavoro live oltre il limite della piattaforma. La deadline è stata estesa rispetto al
budget iniziale perché OpenBDAP può superare 25 secondi su una lettura completa; il segnale
della richiesta API o MCP annulla anche i fetch già in corso.

## Perché live con snapshot di fallback

Lo snapshot 2024 esistente copre nazionale, regionale e 232 enti (76.124 righe sorgente),
e per questo è congelato con hash verificato: rigenerarlo per 13 anni avrebbe richiesto
scaricare e validare lo stesso volume per ciascun anno. Il solo aggregato nazionale è invece
piccolo (poche decine di righe per anno) e interrogabile in diretta.

Quando OpenBDAP non rende disponibili i CSV annuali (errore noto di conversione allegato,
timeout o rete), la pagina e l’API usano lo snapshot nazionale committed
`src/data/generated/ssn-cce-national-history.json`, con lo stesso pattern della serie Legge di
Bilancio. Il 2024 dello snapshot storico deve coincidere cifra per cifra con
`ssn-cce-2024.json`. I valori 2012-2023 riproducono le etichette `compactEuro` di un render
live verificato (osservazione 2026-08-28) finché non è di nuovo possibile pinare i centesimi
esatti da CSV.

## Metriche

Le stesse 5 metriche già definite in `SSN_CCE_METRICS`
(`src/lib/data/ssn-cce-contract.ts`), verificate presenti con la stessa voce e descrizione
su tre anni campione (2012, 2018, 2024):

| Metrica | Codice | Voce |
| --- | --- | --- |
| `productionCosts` | `BZ9999` | Totale costi della produzione (B) |
| `personnelCost` | `BA2080` | Totale Costo del personale |
| `healthcareWorkServices` | `BA1350` | Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro sanitarie e sociosanitarie |
| `nonHealthcareWorkServices` | `BA1750` | Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro non sanitarie |
| `purchasedServices` | `BA0390` | Acquisti di servizi |

I valori sono espressi in centesimi (interi), come lo snapshot 2024: il 2024 della serie
storica è verificato combaciare esattamente, cifra per cifra, con `ssn-cce-2024.json`.

## Cosa questa serie non dimostra

- **Non sono pagamenti di cassa**: sono voci di competenza economica del Conto Economico.
- **Non identificano gettonisti, cooperative o organico**: sono categorie contabili
  aggregate, non contratti o categorie di personale.
- **Non misurano qualità o efficienza sanitaria**: un aumento non è di per sé uno spreco né
  un miglioramento; una diminuzione non è di per sé un taglio di servizi.
- **Non isolano fattori straordinari**: la serie include inflazione, nuove missioni di spesa
  ed eventi straordinari (es. spesa COVID-19 2020-2021) senza scorporarli.
- **Solo livello nazionale**: nessun dettaglio regionale o per ente storico in questa prima
  versione; resta disponibile solo per il 2024.

## Superfici

- `GET /api/spese/sanita/storico`, nessun filtro.
- MCP: `query_dataset` con `dataset=openbdap_ssn_storico_nazionale`, nessun filtro ammesso.
- UI: [/spese/sanita/storico](/spese/sanita/storico), collegata da `/spese/sanita`.

## Riferimenti

- [OpenBDAP RGS](https://bdap-opendata.rgs.mef.gov.it)

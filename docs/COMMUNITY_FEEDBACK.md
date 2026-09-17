# Registro dei feedback della community

Questo registro separa richieste, fonti verificabili e decisioni di prodotto.
Una segnalazione diventa una funzione soltanto quando fonte, perimetro,
licenza, contratto e significato sono sufficienti.

Il lavoro è tracciato nella [issue #19](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/19); la chat/voice resta nella issue #17.

## Correzioni e spiegazioni pronte

| Feedback | Decisione | Evidenza e limite |
|---|---|---|
| I punti interrogativi escono dal display | Correzione responsive e test Browser | Il tooltip deve restare interamente nel viewport a 320, 390, 768, 1024 e 1280 px; l'overflow non viene nascosto. |
| “Spese previdenziali” della Camera significa vitalizi | Correzione semantica | Il [conto consuntivo Camera 2025](https://documenti.camera.it/_dati/leg19/lavori/documentiparlamentari/IndiceETesti/008/007/INTERO.pdf) attribuisce 96,484 mln € ai deputati cessati e 321,742 mln € al personale in quiescenza. Il totale di 418,226 mln € include più voci e non equivale ai soli vitalizi. |
| La vista Stato 2025 deve usare il dato definitivo | Aggiornamento prioritario | Il [Rendiconto 2025 OpenBDAP](https://openbdap.rgs.mef.gov.it/it/News/Index/633), pubblicato il 20 luglio 2026, va distinto dai rilasci mensili cumulativi. |
| Contestualizzare la quota di spesa corrente | Explainer, senza giudizio alto/basso | Un periodo parziale non è confrontabile con un anno chiuso. La UI deve mostrare periodo, denominatore e serie annuali omogenee. |
| Regioni a statuto speciale | Spiegazione di perimetro | SIOPE aggrega pagamenti dei Comuni per regione; OpenCivitas copre i Comuni delle Regioni a statuto ordinario. Non applichiamo coefficienti inventati. |

## Fonti implementabili in PR dedicate

| Tema | Fonte ufficiale | Cosa si può pubblicare | Cosa non si può dire |
|---|---|---|---|
| Personale sanitario e prestazioni di lavoro | [OpenBDAP, conto economico SSN 2024](https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_show?id=94083af2-a542-482d-8ad6-5877d04cd1ca) | Costo del personale e voci contabili ufficiali di consulenze, collaborazioni, interinale e altre prestazioni di lavoro, per ente e regione, con riconciliazione nazionale. | Le voci non identificano in modo omogeneo gettonisti o cooperative e non misurano qualità o spreco. |
| Progetti PNRR | [Italia Domani, open data](https://www.italiadomani.gov.it/content/dam/sogei-ng/opendata/PNRR_Progetti.csv) | Primo verticale implementato per asili e prima infanzia: CUP, localizzazioni, soggetto attuatore, finanziamenti, gare e aggiudicatari, con snapshot e hash. | Finanziamento non significa pagamento; soggetto attuatore non prova la localizzazione fisica. |
| Spesa regionalizzata dello Stato | [OpenBDAP, destinatario finale 2023](https://bdap-opendata.rgs.mef.gov.it/content/2023-territorio-destinatario-finale-della-spesa-consolidata-spesa-statale-regionalizzata) | Quota regionalizzata nel perimetro pubblicato, al netto degli interessi. | Non rappresenta tutta la spesa statale e non va sommata a perimetri diversi. |
| Bilanci propri delle Regioni | [Istat, consuntivi 2024](https://www.istat.it/tavole-di-dati/i-bilanci-consuntivi-delle-regioni-e-province-autonome-anno-2024/) | Accertamenti, riscossioni, impegni e pagamenti come fasi distinte; Regioni e Province autonome esplicite. | Nessuna classifica di efficienza deriva dagli importi. |
| Quota di imposte contabilizzata centralmente | [Eurostat `gov_10a_taxag`](https://ec.europa.eu/eurostat/databrowser/view/gov_10a_taxag/default/table) | Quote con anno, sottosettore ESA e denominatore esplicito. | “Allo Stato centrale” non significa denaro trattenuto a Roma: esistono trasferimenti fra amministrazioni. |

## Richieste che richiedono una specifica o una fonte migliore

| Feedback | Stato | Motivo |
|---|---|---|
| Soddisfazione dei cittadini di ogni Comune | Non pubblicabile come ranking comunale | L'[indagine Istat AVQ 2024](https://www.istat.it/comunicato-stampa/soddisfazione-dei-cittadini-anno-2024/) produce stime nazionali, per ripartizione, regione e tipologia comunale, non per singolo Comune. BesT arriva a province e città metropolitane. |
| Residui fiscali e regioni “in attivo/passivo” | Scheda storica/metodologica, non classifica corrente | Il risultato cambia con perimetro e criterio di localizzazione o beneficio. Il saldo CPT già pubblicato ha segno e significato diversi. |
| “85–90 miliardi prodotti da tre Regioni” | Non usare come valore univoco | Le stime storiche variano sensibilmente con il metodo; non sono un saldo corrente direttamente osservato. |
| Costo della vita e salari PA regionali | Non implementare con l'indice parziale disponibile | Gli indici spaziali Istat 2022 non coprono un paniere completo e non dimostrano il claim del 40%. |
| Dettaglio di “Servizi di ogni giorno” | In attesa della classificazione ufficiale SIOPE | Lo snapshot corrente aggrega il primo livello. Le etichette di sottocategoria non vanno inferite dai codici. |
| Comune, cooperative e altri enti | Collegamenti CIG-CUP e soggetti, senza giudizi | Contratti e progetti possono essere collegati tramite identificativi ufficiali; il collegamento non dimostra illecito, corruzione o qualità. |
| “Dove ha speso la Calabria?” | Dettaglio progetto per CUP | Va risposto con progetti, pagamenti, soggetti e territorio pubblicati dalla fonte, senza ipotesi su data center o sprechi. |
| Chat e voce | Specifica prima dell'implementazione | La [issue #17](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/17) deve definire intenti, citazioni, fallback, costi, accessibilità, prompt injection, minimizzazione e retention. Audio e query grezze non vengono conservati per default. |
| CDP e perdite delle partecipate | Ricerca separata | Il [bilancio CDP 2025](https://www.cdp.it/sitointernet/it/bilanci_e_presentazioni_2025.page) distingue aumenti di capitale, risultato consolidato e valore della partecipazione. Un aumento di capitale non prova da solo che denaro pubblico abbia “coperto perdite”. |

## Regole di rilascio

- Ogni nuova fonte arriva in una PR autonoma con snapshot, hash, contratto,
  riconciliazioni, source health, API/MCP limitati e documentazione.
- Le PR dei contributor restano separate per conservare attribuzione e review.
- Il post di release può riassumere più PR già mergiate, ma non anticipa funzioni
  non pubblicate né check esterni non eseguiti.

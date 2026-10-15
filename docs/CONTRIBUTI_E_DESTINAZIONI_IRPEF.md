# Contributi obbligatori e destinazioni IRPEF

Verifica delle proposte #571, #572, #573 e #569, al 15 ottobre 2026.
Le sei coperture non erano presenti come dataset dedicati. L'issue #675 è una
segnalazione della proposta #569, non una prova dell'integrazione.

## Pubblicato con questo import

ARERA, rendiconti della gestione 2024 e 2025:

- `arera-entrate-2024-2025`: 54 record, capitoli al V livello con codice ARERA.
- `arera-spese-2024-2025`: 6 record, titoli al I livello.

Il dataset `ade-cinque-per-mille-territori-2024` aggiunge 22 aggregati riconciliati sui 90.627 enti del 5 per mille AF 2024: 21 territori come pubblicati (Trento e Bolzano distinti), più 323 enti senza regione pubblicata. I sette CSV originali completi, aggiornati al 17 giugno 2026, sono scaricabili da un archivio ZIP statico versionato.

Le righe passano dal corpus integrato e sono disponibili su `/dati`, nelle API
del corpus e attraverso le query integrate del server MCP. `/fonti` collega le
viste. Il tool MCP esistente usa `dataset: "spesa_pa_dettaglio"` e il relativo ID in
`code`: `arera-entrate-2024-2025`, `arera-spese-2024-2025` oppure
`ade-cinque-per-mille-territori-2024`.
Nessuna acquisizione alla visita e nessun nuovo servizio a pagamento.

Fonti: allegati A alle delibere [164/2025/A](https://www.arera.it/atti-e-provvedimenti/dettaglio/25/164-25)
e [137/2026/A](https://www.arera.it/atti-e-provvedimenti/dettaglio/26/137-26).
Pubblicazioni: 16 aprile 2025 e 5 maggio 2026; acquisizione: 15 ottobre 2026.
Byte originali, SHA-256, fogli e date sono vincolati in
`scripts/etl/specs/arera-bilanci.source.json`.

I [termini ARERA](https://www.arera.it/termini-e-condizioni-uso-del-sito) dichiarano
**CC BY-SA 4.0**. L'attribuzione e la condivisione degli adattamenti con la stessa
licenza si applicano ai dati derivati; la licenza del codice non le sostituisce.
La copia dei termini è conservata con hash nella fixture.

Previsioni, accertamenti/impegni, riscossioni/pagamenti di competenza, residui e
cassa hanno colonne distinte. I titoli gerarchici non sono sommati ai capitoli;
l'avanzo è escluso dalle entrate. Le partite di giro sono incluse e riconoscibili.
Gli importi sono espressi al centesimo, come nel formato visualizzato dei fogli;
le approssimazioni binarie XLSX inferiori a un milionesimo di euro non alterano
il centesimo. Le celle vuote restano mancanti, gli zeri osservati restano zero.

Il controllo offline ricostruisce tutte le righe dagli XLSX, verifica periodo,
identità uniche e riconciliazioni con i totali di competenza, residui e cassa.
Le uscite sono limitate ai titoli: alcuni riepiloghi del dettaglio al V livello
non coincidono con la somma dei capitoli. Non sono stati corretti arbitrariamente
né trasformati in accuse di spreco. Per esempio, nel 2024 la somma dei pagamenti
complessivi dei capitoli con codice ARERA è 157.830.783,24 euro, contro
157.830.785,24 euro nel totale; nel 2025 sono 99.134.029,06 contro 99.134.031,06.
I titoli al I livello riconciliano esattamente con i totali pubblicati.

Aggiornamento manuale: acquisire la nuova annualità, rivedere hash, intestazioni,
periodo, licenza e riconciliazioni prima di modificare il contratto. Poi:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/arera_bilanci.py --publish
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/arera_bilanci.py --check
```

## 5 per mille: contratto e base di riuso

Le sette parti originali sono conservate nello ZIP statico sotto `public/downloads`, con SHA-256 del contenitore e di ogni CSV. Le evidenze di riuso sono in `tests/fixtures/ade-cinque-per-mille`. Il controllo `scripts/etl/ade_cinque_per_mille.py --check` verifica tutti i 90.627 progressivi e codici fiscali di enti unici, le categorie, le celle mancanti e le somme osservate, poi ricostruisce i 22 aggregati territoriali. I 323 enti con regione vuota restano nel gruppo senza territorio, senza assegnazioni inferite. Rimuove soltanto gli apici di protezione dei codici e normalizza il formato numerico italiano. Non somma l'intero importo per ciascuna categoria di ammissione: possono sovrapporsi.

Sono **importi erogabili**, non pagamenti verificati. Le 17.820 celle vuote del totale erogabile restano mancanti. La somma dei soli importi pubblicati è 522.950.166,12 euro; non sostituisce uno stanziamento o una verifica dei pagamenti. La nota AdE esclude le quote della singola categoria inferiori a 100 euro, non erogabili e ripartite secondo l'art. 11 DPCM 23 luglio 2020. Le componenti dell'importo non si sommano al totale.

La pagina del dataset e il collegamento privacy acquisiti non indicano una licenza specifica. La base di riuso è l'[art. 52, comma 2, CAD](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2005-03-07;82~art52!vig=), con il **requisito 20** delle [Linee guida AgID 2023](https://www.agid.gov.it/sites/agid/files/2024-05/lg-open-data_v.1.0_1.pdf), pagine 86-87: CC BY 4.0 in applicazione dell'apertura predefinita. Gli originali contengono dati pubblici non personali di enti beneficiari, con identificativi a 11 cifre; nessun nominativo o scelta individuale dei contribuenti. Lo stato `verified-open-cad-art52-cc-by-4.0` distingue questa base normativa da una dichiarazione esplicita dell'editore. Le evidenze acquisite sono archiviate con hash; una nuova fonte o copertura richiede di ripetere la verifica, non di ereditare automaticamente questo stato.

I [termini MEF](https://www.finanze.gov.it/it/copyright/) riservano invece la ripubblicazione dei contenuti, incluse le tabelle, salvo autorizzazioni o eccezioni. Non è stata individuata una condizione specifica risolutiva per le tabelle 8/2 per mille: non sono importate. Anche [CONAI](https://www.conai.org/termini-e-condizioni/) limita il riuso e la ripubblicazione; nessuna licenza aperta viene presunta. Questo non è un giudizio generale su ogni possibile uso dei dati: documenta la scelta di non ridistribuire quei file in questo import.

Le API e MCP espongono solo i 22 aggregati, senza un totale Italia sovrapposto. I conteggi documentano gli enti con dati mancanti; ogni somma comprende solo le celle osservate, e resta mancante se nessuna è pubblicata nel gruppo.

Il dettaglio completo è servito come ZIP statico da CDN: il nome contiene il digest del contenitore e la cache è immutabile. Non entra nelle tracce Functions, verificate dal gate runtime. L’aggiunta al corpus runtime è un solo chunk di aggregati, evitando circa 11 MiB di dettaglio JSONL nelle funzioni già vicine al limite di packaging. Nessun download dal sito AdE alle visite, nessun nuovo servizio e nessuna riduzione dei dataset preesistenti. Le tracce NFT misurano gli input del pacchetto, non il consumo CPU o il costo effettivo del deploy.

## Coperture ancora aperte

| Proposta | Riscontro | Passo necessario |
| --- | --- | --- |
| #571, consorzi di bonifica | Tevere e Agro Romano è confluito nel Litorale Nord. Il [portale trasparenza del successore](https://www.consorziobonificalitoralenord.it/amministrazione-trasparente/) pubblica i consuntivi. I rendiconti 2024 e 2025 di [Ragusa](https://www.consorziobonifica8rg.it/amministrazione-trasparente/bilanci/bilancio-preventivo-e-consuntivo.html) sono scansioni: nessuna tabella testuale estraibile. | Ottenere esportazioni strutturate o definire un'estrazione PDF con verifica indipendente delle righe e dei totali; verificare il riuso per ogni consorzio. Nessun totale nazionale da un pilota. |
| #572, autorità indipendenti | Primo pilota ARERA disponibile. Non comprende ANAC, AGCOM, AGCM, ART, CONSOB o IVASS. | Ampliare un'autorità alla volta con rendiconti e licenze verificati. Gli appalti ANAC già presenti non sono entrate contributive. |
| #573, EPR | [CONAI](https://www.conai.org/termini-e-condizioni/) pone limiti al riuso, anche commerciale. Non è una licenza aperta. | Chiarire le condizioni del file da pubblicare o scegliere un'altra fonte ufficiale con riuso verificato. Distinguere contributi raccolti e corrispettivi distribuiti; nessuna assimilazione automatica a tributi della PA. |
| #569, 8 per mille | [MEF](https://www1.finanze.gov.it/finanze/pagina_dichiarazioni/public/ottoxmille.php): serie ufficiale individuata; la discussione segnala clausole generali di copyright. | Verificare le condizioni specifiche del dataset rispetto al copyright generale. Separare anno fiscale, dichiarazione, riparto e pagamento; non colmare importi non pubblicati. |
| #569, 5 per mille | [Agenzia delle Entrate](https://www.agenziaentrate.gov.it/portale/elenco-complessivo-dei-beneficiari): 22 aggregati ricostruiti sull’elenco completo AF 2024; i sette CSV originali di tutti gli enti ammessi sono scaricabili. | Restano altre annualità e gli elenchi distinti degli esclusi; non sono pagamenti. Base normativa di riuso documentata sopra. La #569 resta aperta anche per 8/2 per mille. |
| #569, 2 per mille | [MEF, dichiarazioni 2025](https://www1.finanze.gov.it/finanze/2xmille/public/index.php?tree=2025AADUEXM0101): tabella ufficiale individuata. | Verificare il riuso specifico e le somme originali; distinguere scelte e somme attribuite dai pagamenti. |

La mancata verifica di una licenza non dimostra un divieto generale di riuso.
Queste righe documentano le coperture residue; non dichiarano concluse le proposte. I semplici collegamenti esterni su `/fonti` non sono contati
come nuovi dataset integrati.

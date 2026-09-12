# Bilanci armonizzati BDAP delle Regioni

Ricognizione per [issue #453](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/453), verificata il 12 settembre 2026. Questa scheda cataloga la fonte ma non pubblica importi.

## Esito

OpenBDAP offre download bulk ufficiali in formato ZIP per previsione, rendiconto e consolidato. L'ingestione resta bloccata: la pagina dei bilanci non dichiara una licenza open specifica e il copyright generale del portale dice che utilizzo, copia e distribuzione a fini di lucro richiedono il permesso scritto della RGS. Poiché il progetto non limita il riuso a fini non commerciali, il solo accesso pubblico al file non basta a documentare condizioni di ridistribuzione compatibili.

Non viene aggiunto alcun dataset al corpus integrato, all'API o al catalogo MCP. Il registro istituzionale espone soltanto metadati e link ufficiali con stato `metadata-only`.

## Fonte e copertura osservata

- Titolare: Ministero dell'economia e delle finanze, Ragioneria Generale dello Stato.
- Pagina canonica: <https://openbdap.rgs.mef.gov.it/it/FET/Analizza#BilanciArmonizzati>.
- Metodo e contesto: <https://openbdap.rgs.mef.gov.it/it/Home/IlBilancioDegliEntiTerritoriali>.
- Rappresentatività: <https://openbdap.rgs.mef.gov.it/it/Home/FAQ/162?category=Area%20tematica%20Finanza%20degli%20Enti%20Territoriali>.
- Condizioni generali: <https://openbdap.rgs.mef.gov.it/it/Home/Copyright>.
- Data mostrata nella sezione download: 7 settembre 2026. Il registro la conserva come `updatedAt`; la data di osservazione DVNS di questa ricognizione è il 12 settembre 2026 e resta distinta.
- Previsione delle Regioni e Province autonome: 2026, [pubblicata per la prima volta il 21 aprile 2026](https://openbdap.rgs.mef.gov.it/it/News/Index/610).
- Rendiconto delle Regioni e Province autonome: 2024, [pubblicato per la prima volta il 7 maggio 2026](https://openbdap.rgs.mef.gov.it/it/News/Index/615). La FAQ attribuisce il rendiconto 2025 ai soli comparti Comuni, Province e Città metropolitane.
- Consolidato: la pagina offre il filtro 2016-2025 e download generali, ma le pagine ufficiali consultate non identificano l'ultimo esercizio rappresentativo per il solo comparto Regioni. Rimane non verificato.

La FAQ dichiara copertura superiore al 95% per i rendiconti 2017-2024. Una riga o un ente assente non equivale a zero.

## Accesso elaborabile

La pagina genera link statici dello stesso dominio. Per esempio:

- rendiconto 2024, schemi di bilancio: <https://openbdap.rgs.mef.gov.it/Datasets_FET/Rendiconto/2024/2024_Rendiconto%20-%20Schemi%20di%20bilancio.zip>;
- previsione 2026, schemi di bilancio: <https://openbdap.rgs.mef.gov.it/Datasets_FET/Previsione/2026/2026_Previsione%20-%20Schemi%20di%20bilancio.zip>;
- previsione 2026, piano degli indicatori: <https://openbdap.rgs.mef.gov.it/Datasets_FET/Previsione/2026/2026_Previsione%20-%20Piano%20degli%20indicatori.zip>.

Una richiesta parziale al primo link ha restituito byte ZIP. Il primo elemento osservato era un PDF per i Comuni: il bundle generale contiene più comparti e non è, da solo, una proiezione delle sole amministrazioni regionali. La pagina offre un filtro territoriale per tutte le venti regioni, ma il territorio non sostituisce il comparto o il tipo di ente.

Non è stata trovata documentazione ufficiale di un'API pubblica per i bilanci armonizzati. Il catalogo Open Data è collegato per altre famiglie della stessa pagina, mentre i bilanci armonizzati puntano ai download statici `Datasets_FET`. Il contratto di acquisizione dovrà quindi partire dal bulk ZIP, salvo una futura API ufficiale documentata.

## Confini contabili

BDAP aggiungerebbe alla vista regionale ulteriori voci e documenti che il consuntivo Istat 2024 oggi integrato non espone nella UI: entrate, residui, risultato di amministrazione, previsione e consolidato. Prima dell'ingestione occorre scegliere e contrattare una sola tabella comparabile, mantenendo separati almeno:

- previsione e rendiconto;
- accertamenti, riscossioni, impegni e pagamenti;
- competenza, cassa e residui;
- bilancio dell'amministrazione regionale, consolidato e territorio regionale;
- assenza di trasmissione e zero osservato.

Questi importi non vanno sommati ai pagamenti `siope_regioni`, che misurano movimenti di cassa, né al saldo CPT, che usa un perimetro territoriale consolidato diverso. Scostamenti, avanzi e disavanzi non misurano efficienza, qualità dei servizi o responsabilità politica.

## Prerequisiti per l'ingestione

1. Ottenere o individuare condizioni di riuso specifiche che consentano la ridistribuzione del dataset anche in contesti commerciali, conservando l'attribuzione richiesta.
2. Acquisire integralmente un ZIP ufficiale e registrare URL, data di osservazione, dimensione e SHA-256.
3. Inventariare i membri del bundle e isolare Regioni e Province autonome con una chiave ufficiale, senza dedurle dal solo nome o dal territorio.
4. Scegliere un documento e una fase minima, definire intestazioni stabili e distinguere celle vuote, zero e valori non disponibili.
5. Verificare schema, duplicati, importi, periodi, copertura e riconciliazioni prima di promuovere righe nel corpus integrato.
6. Solo dopo la prova offline, riusare il selettore integrato per `/dati`, API e MCP; la pagina `/regioni` dovrà consumare la stessa vista pubblica.

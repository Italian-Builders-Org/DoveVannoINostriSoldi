# Contratti degli indicatori ANAC

Slice della [#185](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/185).
Top 1, Top 10 e HHI aprono le aggiudicazioni che contribuiscono al rispettivo
indicatore, mantenendo dimensione e selezione anche nella paginazione.

Route: `/enti/{codice}/appalti?view=concentration&metric=count|value&selection=top1|top10|all`.
La selezione `all` espone l'intero perimetro HHI. Parametri ambigui, selezioni
non riconosciute e l'aggiunta di un operatore arbitrario non ampliano il perimetro.
Un indicatore non pubblicato mantiene questo stato, senza valore zero sostitutivo.

## Denominatori e riconciliazione

- **Numero:** i pesi sono relazioni operatore-aggiudicazione, come nel calcolo
  esistente. La tabella mostra una sola riga per `(CIG, ID_AGGIUDICAZIONE)` e
  dichiara quante relazioni selezionate produce. Due membri di un raggruppamento
  possono contribuire due relazioni sulla stessa riga; gli importi di questa
  vista non ricostruiscono l'indicatore per numero.
- **Valore:** solo aggiudicazioni con un unico operatore risolto e importo
  positivo. Casi multipartiti/ambigui, importi mancanti, zero, negativi o in
  conflitto restano esclusi. Nessuna ripartizione arbitraria fra operatori.
- Le selezioni seguono i ranghi già validati: massimo 1, massimo 10 o tutti gli
  operatori del relativo indicatore. Non viene ricalcolato un ranking sulla pagina.
- Peso selezionato e denominatore completo sono visibili. Gli importi esatti,
  comprese le frazioni di centesimo, affiancano la presentazione ai centesimi.
  La paginazione non cambia questi totali.

Snapshot, hash, formule e soglia minima di pubblicazione restano quelli del
contratto ANAC esistente. Nessun nuovo dato o identificativo fiscale pubblicato.
I test riconciliano tutte le sei selezioni sul profilo Roma e usano fixture per
raggruppamenti, importi sub-centesimali, stati esclusi, ranghi e dati insufficienti.
Il browser verifica i collegamenti, le tabelle da tastiera e la paginazione a
390/768/1280 px.

Queste misure sono descrittive: non provano illecito o responsabilità. CPV,
benchmark fra enti, soglie normative e bunching restano slice successive della #185.

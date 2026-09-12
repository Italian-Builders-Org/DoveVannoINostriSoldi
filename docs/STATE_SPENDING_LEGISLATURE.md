# Spesa dello Stato per legislatura

La pagina [/stato/legislature](/stato/legislature) confronta, legislatura per legislatura,
la spesa statale dell'anno pre-elettorale con la media degli altri anni completi della
stessa legislatura. È un confronto descrittivo, non un test di significatività statistica,
e non prova né implica spesa elettorale o responsabilità individuale.

## Fonti

- **Spesa**: consuntivo annuale OpenBDAP RGS, "Pagamenti Bilancio dello Stato per Missione",
  disponibile senza interruzioni dal 2014 al 2025. Licenza Creative Commons Attribution
  (CC-BY), dichiarata dal catalogo CKAN OpenBDAP per ogni rilascio annuale verificato. Riusa
  un batch dedicato che accetta esclusivamente release annuali consuntive e conserva package,
  URL del CSV e data di aggiornamento del catalogo per ogni anno.
- **Date delle legislature**: Camera dei Deputati (camera.it) e Ministero dell'Interno
  (interno.gov.it), verificate contro le pagine ufficiali di ciascuna legislatura.

## Metodo

Per ogni legislatura, gli anni considerati sono quelli **completi**: si esclude l'anno di
insediamento (parziale, la legislatura si insedia a metà anno) e, quando esiste un'elezione
successiva, l'anno di quell'elezione (anch'esso parziale dal punto di vista del bilancio).
L'anno pre-elettorale è l'ultimo anno completo della legislatura chiusa; viene confrontato
con la media aritmetica degli altri anni completi.

```text
differenza = spesa(anno pre-elettorale) - media(spesa negli altri anni completi)
```

Nella finestra di dati disponibile (2014-2025) questo produce due legislature complete: la
XVII (anni 2014-2017, pre-elettorale 2017) e la XVIII (anni 2019-2021, pre-elettorale 2021).
La XIX è in corso: pubblica gli anni solari completi già presenti nel consuntivo OpenBDAP
(almeno 2023-2024; 2025 se il catalogo lo espone), senza etichetta pre-elettorale e senza
media/differenza finché non c'è un'elezione successiva.
## Cosa questo confronto non dimostra

- **Non è un test di significatività statistica**: sono due sole legislature complete
  osservate; non è una base sufficiente per stabilire un pattern generale.
- **Non implica causalità o intento elettorale**: la spesa statale può crescere per ragioni
  indipendenti dal calendario elettorale (inflazione, nuove missioni di spesa, eventi
  straordinari), che il confronto non isola.
- **Il 2020 e il 2021 coincidono con il periodo delle misure emergenziali COVID-19**.
  La pagina rende visibile questo contesto, ma non afferma che una quota specifica del totale
  derivi da quelle misure: il contributo non è isolato né quantificato.
- **Copre solo la spesa statale nazionale**: Comuni, Regioni ed elezioni europee restano
  fuori perché il progetto non ha serie storiche di spesa comparabili per quei livelli di
  governo (SIOPE comunale copre solo 2024-2026; le elezioni comunali cadono in date diverse
  per ogni Comune).

## Superfici

- `GET /api/spese/stato/legislature`, nessun filtro.
- MCP: `query_dataset` con `dataset=openbdap_spesa_legislature`, nessun filtro ammesso.
- UI: [/stato/legislature](/stato/legislature), collegata da `/stato`.

## Riferimenti

- [OpenBDAP RGS](https://bdap-opendata.rgs.mef.gov.it)
- [Camera dei Deputati, XVII legislatura](https://www.camera.it/leg17/1)
- [Camera dei Deputati, XVIII legislatura](https://www.camera.it/leg18/1398)
- [Camera dei Deputati, XIX legislatura](https://www.camera.it/leg19/1)
- [Ministero dell'Interno, elezioni 2018](https://www.interno.gov.it/it/notizie/elezioni-2018-italia-voto-4-marzo)
- [Governo italiano, decreto-legge 34/2020](https://www.governo.it/sites/new.governo.it/files/DL_20200520.pdf)

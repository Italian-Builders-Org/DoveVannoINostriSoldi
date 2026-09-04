# Distribuzione MCP

L'endpoint canonico resta:

```text
https://www.dovevannoinostrisoldi.com/api/mcp
```

Non creare una seconda copia del server per un client o una directory. Una copia separata
renderebbe più difficile mantenere allineati dataset, provenienza, annotazioni e correzioni.

## Manufact

In Manufact Cloud scegliere `Servers → New Server → Connect an existing server` e incollare
l'endpoint canonico. Questa modalità usa il server già pubblicato per chat, test e publish checks;
non richiede una migrazione a `mcp-use` né un secondo deployment.

Questa è la configurazione attuale. Una migrazione a `mcp-use` avrebbe senso soltanto se in futuro
si decidesse di spostare anche il runtime su Manufact o di sviluppare interfacce MCP Apps native;
in quel caso va pianificata come modifica architetturale, con test di parità prima del passaggio.

Prima di abilitare analytics o cattura dei payload, verificare impostazioni, retention e informativa
privacy. Non includere prompt o dati personali nei test: i tool DVNS interrogano fonti pubbliche.

Riferimenti ufficiali:

- [Manufact: creare o collegare un server](https://docs.manufact.com/dashboard/servers)
- [Manufact Cloud](https://docs.manufact.com/dashboard)

## ChatGPT

La verifica del dominio usa `/.well-known/openai-apps-challenge`. Configurare
`OPENAI_APPS_CHALLENGE_TOKEN` soltanto con il token fornito durante la submission. La route risponde
in testo semplice, senza cache; senza un token valido risponde `404`.

Materiale da verificare prima dell'invio:

- nome: `DoveVannoINostriSoldi`;
- categoria: dati pubblici e civic tech;
- endpoint MCP, sito, supporto, privacy e termini tutti raggiungibili in produzione;
- logo ufficiale del progetto, senza marchi di enti fonte o piattaforme AI;
- tool dichiarati read-only, senza autenticazione e senza effetti collaterali;
- almeno cinque casi positivi e tre negativi eseguiti sul deployment di produzione;
- release notes coerenti con ciò che è già online;
- piano Vercel attivo e relativa retention dei log registrati nella scheda di review;

Riferimenti ufficiali:

- [OpenAI: costruire un server MCP](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: submission pubblica](https://developers.openai.com/plugins/deploy/submission)
- [OpenAI: linee guida per le app](https://developers.openai.com/plugins/app-guidelines)

## Claude

Il server si collega come custom remote connector usando lo stesso endpoint. La directory Anthropic
ha una candidatura separata: un test riuscito nel client non equivale all'accettazione pubblica.

- [Claude: custom remote MCP connector](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude: submission di un remote MCP server](https://support.claude.com/it/articles/12922490-guida-all-invio-di-remote-mcp-server)

## Starter prompt

Sono esposti anche come capability MCP `prompts/list` (nomi: `confronta_pagamenti_comuni`,
`catalogo_territoriale`, `irpef_netta_regionale`, `consuntivo_statale_missione`,
`dati_calabria_limiti`). Questa lista è la fonte unica dei testi; client e reviewer li leggono
tramite `prompts/get` senza copiarli dal documento.

- `Confronta i pagamenti pro capite dei Comuni disponibili e mostrami fonte, anno e limiti.`
- `Quali dataset territoriali posso interrogare? Non eseguire ancora una query.`
- `Mostrami l'imposta netta dichiarata 2024 per le Regioni, distinguendola dal gettito totale.`
- `Riassumi i pagamenti statali per missione usando l'ultimo consuntivo disponibile.`
- `Cerca i dati disponibili per la Calabria e dimmi che cosa non è confrontabile.`

## Casi di review minimi

Positivi:

1. discovery del server e `tools/list`;
2. `list_datasets` con catalogo non vuoto;
3. query regionale MEF IRPEF con provenance;
4. query SIOPE con anno e Regione supportati, senza inventare una paginazione non dichiarata;
5. query OpenBDAP annuale che preferisce il consuntivo;
6. risposta con valori soppressi mantenuti espliciti;
7. accesso alla risorsa `dvns://datasets`.

Negativi:

1. dataset inesistente rifiutato senza fallback;
2. filtro non supportato rifiutato invece di essere ignorato;
3. paginazione fuori limite rifiutata su un dataset che dichiara `limit` e `offset`;
4. richiesta malformata restituita come errore applicativo;
5. nessun tool mutativo o distruttivo esposto.

## Evidenza, non promessa

Registrare separatamente data, client, endpoint, prompt, tool chiamato ed esito di ogni prova. Un
publish check Manufact non dimostra l'inclusione nelle directory ChatGPT o Claude; una candidatura
inviata non dimostra approvazione; un endpoint raggiungibile non dimostra qualità delle risposte.

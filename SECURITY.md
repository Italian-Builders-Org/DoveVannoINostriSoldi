# Sicurezza

## Segnalare una vulnerabilità

Non aprire una issue pubblica per vulnerabilità non ancora corrette.

Usa il canale privato GitHub:

https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/security/advisories/new

Il form è visibile nella sezione Security del repository come
**Report a vulnerability** (chi non è admin) oppure
**New draft security advisory** (chi ha permessi di amministrazione).

Indica superficie interessata, prerequisiti, impatto, passaggi minimi per la
riproduzione e una proposta di mitigazione, se disponibile. Non includere dati
personali, credenziali o informazioni ottenute accedendo a sistemi altrui.

## Perimetro

Sono particolarmente rilevanti bypass dei limiti MCP/API, scritture inattese,
accesso a variabili d'ambiente, SSRF, injection, esposizione di dati non pubblici,
dipendenze compromesse e workflow GitHub con privilegi eccessivi.

I problemi di qualità o interpretazione dei dati senza impatto di sicurezza
vanno segnalati con una issue ordinaria, allegando la fonte ufficiale, oppure
con il pulsante «Segnala un problema» del sito, che crea la stessa issue
pubblica. Quel modulo non è un canale riservato: non usarlo per vulnerabilità.

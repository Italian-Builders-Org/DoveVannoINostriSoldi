# Sicurezza

## Segnalare una vulnerabilità

Non aprire una issue pubblica per vulnerabilità non ancora corrette. Usa la
sezione **Security** del repository e crea una private vulnerability report. Se
la funzione non è disponibile, contatta privatamente un maintainer del progetto
prima di pubblicare dettagli sfruttabili.

Indica superficie interessata, prerequisiti, impatto, passaggi minimi per la
riproduzione e una proposta di mitigazione, se disponibile. Non includere dati
personali, credenziali o informazioni ottenute accedendo a sistemi altrui.

## Perimetro

Sono particolarmente rilevanti bypass dei limiti MCP/API, scritture inattese,
accesso a variabili d'ambiente, SSRF, injection, esposizione di dati non pubblici,
dipendenze compromesse e workflow GitHub con privilegi eccessivi.

I problemi di qualità o interpretazione dei dati senza impatto di sicurezza
vanno invece segnalati con una issue ordinaria, allegando la fonte ufficiale.

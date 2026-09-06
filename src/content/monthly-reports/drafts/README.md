# Bozze dei report mensili

I file in questa directory non sono importati dal runtime pubblico. Il comando
`npm run report:new -- --month YYYY-MM --cutoff YYYY-MM-DD` crea una nuova
capsula senza sovrascrivere bozze o numeri già pubblicati.

La pubblicazione richiede revisione umana: il file definitivo viene aggiunto a
`published/` e registrato esplicitamente nel relativo `index.ts`.

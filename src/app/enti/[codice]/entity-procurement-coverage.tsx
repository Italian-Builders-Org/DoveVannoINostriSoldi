export function EntityProcurementCoverage({ comparison = false }: { comparison?: boolean }) {
  return (
    <div className="notice warning-notice">
      <strong>Copertura dell’ente non accertata</strong>
      <p>Conteggi e importi riguardano solo i CIG riconciliati con l’ente, non il totale annuo dei suoi appalti.
        {comparison ? " La copertura può differire tra Comuni: mediane e percentili descrivono soltanto i profili pubblicati." : " Anche gli indicatori di concentrazione descrivono soltanto questa parte osservata."}
      </p>
      <details>
        <summary>Perché possono mancare dei CIG</summary>
        <p>I file acquisiti comprendono i dodici mesi del 2025. Questo non garantisce la completezza del singolo ente:
          il collegamento tra ANAC e IPA esclude identità ambigue e CIG fuori dagli intervalli del registro AUSA acquisito.
          L’assenza dal profilo non significa assenza di contratti.</p>
      </details>
    </div>
  );
}

import styles from "./spending-reading-guide.module.css";

export function SpendingReadingGuide() {
  return <details className={styles.guide}>
    <summary>Come leggere questi importi</summary>
    <dl>
      <div><dt>Cassa</dt><dd>Soldi effettivamente pagati nel periodo indicato. È la misura usata per i pagamenti SIOPE dei Comuni.</dd></div>
      <div><dt>Competenza economica</dt><dd>Costi attribuiti al periodo in cui l’attività avviene, anche se il pagamento ha una data diversa. È la misura Eurostat della spesa PA.</dd></div>
      <div><dt>Partite di giro</dt><dd>Somme incassate o pagate per conto di terzi, come le ritenute. Sono evidenziate separatamente dalle spese per i servizi.</dd></div>
    </dl>
  </details>;
}

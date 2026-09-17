import { longDate } from "@/lib/format";
import type { SiopeMunicipalReceiptsSnapshot } from "@/lib/siope-receipts";
import styles from "./entrate.module.css";

export function ReceiptsSources({ data }: { data: SiopeMunicipalReceiptsSnapshot }) {
  const { source, methodology } = data;
  return (
    <div className={styles.sources}>
      <p>
        <strong>Fonti degli incassi {data.year}:</strong> {source.siopeOwner}.{" "}
        <a href={source.siopeMovementsUrl} target="_blank" rel="noreferrer">Movimenti SIOPE ↗</a>,{" "}
        <a href={source.siopeRegistryUrl} target="_blank" rel="noreferrer">anagrafica SIOPE ↗</a>,{" "}
        <a href={source.ipaUrl} target="_blank" rel="noreferrer">Indice PA ↗</a>.
      </p>
      <p>
        File movimenti aggiornato il {longDate(source.siopeMovementsLastModified)} (metadato HTTP).
        Acquisito il {longDate(source.acquisitionDate)}; verificato il {longDate(source.checkedAt)}.
        Data di pubblicazione e licenza di riuso non dichiarate dalla fonte.
      </p>
      <details>
        <summary>Metodo, copertura e impronte dei file</summary>
        <p>{methodology.measure} {methodology.periodicity}</p>
        <p>{methodology.territorialJoin}</p>
        <p>{methodology.populationSource} {methodology.populationReference} {methodology.perCapitaCoverage}</p>
        <p>{methodology.warning}</p>
        <dl className={styles.provenance}>
          <div><dt>Osservazione</dt><dd>{source.observedAt}</dd></div>
          <div><dt>Snapshot generato</dt><dd>{data.generatedAt}</dd></div>
          <div><dt>Anagrafica SIOPE aggiornata</dt><dd>{longDate(source.siopeRegistryLastModified)}</dd></div>
          <div><dt>Indice PA aggiornato</dt><dd>{longDate(source.ipaLastModified)}</dd></div>
          <div><dt>SHA-256 movimenti</dt><dd><code>{source.siopeMovementsSha256}</code></dd></div>
          <div><dt>SHA-256 anagrafica SIOPE</dt><dd><code>{source.siopeRegistrySha256}</code></dd></div>
          <div><dt>SHA-256 Indice PA</dt><dd><code>{source.ipaSha256}</code></dd></div>
        </dl>
      </details>
    </div>
  );
}

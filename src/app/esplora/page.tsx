import type { Metadata } from "next";
import { EsploraSearch } from "./EsploraSearch";
import Link from "next/link";
import { loadInvestigativeMeta } from "@/lib/investigative-explorer";
import styles from "./esplora.module.css";

export const metadata: Metadata = {
  title: "Esplora relazioni",
  description:
    "Ricerca trasversale di persone ed enti negli incarichi pubblici (fetta incarichi-nominativi-shard). I riferimenti CIG/CUP e di atto sono in nota e ricercabili.",
};

export default function EsploraPage() {
  const m = loadInvestigativeMeta();
  const count = m.relationCount ?? 0;
  const suspects = m.suspectDuplicates ?? 0;
  const searchable = Math.max(0, count - suspects);
  const caveat = m.caveat ?? "";

  return (
    <main className="shell page">
      <section className={styles.intro}>
        <h1>Esplora relazioni</h1>
        <p>
          Cerca persone, enti e riferimenti agli atti in <strong>{searchable.toLocaleString("it-IT")}</strong> relazioni tra incarichi ed enti pubblici.
          Un collegamento indica dove approfondire; non dimostra un’irregolarità.
        </p>

      </section>

      <section className="panel" aria-labelledby="official-series-entry">
        <h2 className="panel-title" id="official-series-entry">Cerchi un confronto nel tempo?</h2>
        <p>Confronta da due a quattro serie Eurostat su spesa pubblica o prezzi, con unità compatibili, tabella e fonti per ogni serie.</p>
        <Link href="/esplora/serie">Confronta serie ufficiali</Link>
      </section>

      <EsploraSearch initialCount={searchable} />

      <details className="data-details">
        <summary>Fonti, identità e record esclusi</summary>
        <p>La ricerca usa il dataset <code>incarichi-nominativi-shard</code>. Non unisce persone con lo stesso nome senza un identificativo stabile. I riferimenti CIG, CUP e agli atti sono ricercabili.</p>
        {suspects > 0 ? (
          <p className={styles.caveat}>
            {suspects.toLocaleString("it-IT")} record con importi sospetti (stesso atto, rapporto
            ×100 o ×1000) restano nel file di origine ma sono esclusi da aggregati e ricerca.
          </p>
        ) : null}
        <p className={styles.caveat}>{caveat}</p>
      </details>

      <section className={styles.provenance}>
        <Link href="/incarichi">Registro ufficiale incarichi</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/fonti">Fonti e metodo</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/controlli">Segnali</Link>
      </section>
    </main>
  );
}

import { loadInvestigativeExplorer } from "@/lib/investigative-explorer";
import { EsploraSearch } from "./EsploraSearch";
import Link from "next/link";
import styles from "./esplora.module.css";

export const metadata = {
  title: "Esplora relazioni · Dove vanno i nostri soldi?",
  description:
    "Ricerca trasversale di persone, enti, CIG/CUP e atti nei dati pubblici dei controlli.",
};

export default function EsploraPage() {
  const artifact = loadInvestigativeExplorer();
  const caveat = String(artifact.methodology.caveat ?? "");

  return (
    <main className="shell">
      <section className={styles.intro}>
        <h1>Esplora relazioni</h1>
        <p>
          Ricerca trasversale su{" "}
          <strong>{artifact.relationCount.toLocaleString("it-IT")}</strong> relazioni
          estratte da <code>{String(artifact.source.dataset)}</code>. Attraversa persone,
          enti, CIG/CUP e atti invece di restare fissi su un solo registro.
        </p>
        <p className={styles.caveat}>{caveat}</p>
      </section>

      <EsploraSearch initialCount={artifact.relationCount} />

      <section className={styles.provenance}>
        <Link href="/fonti">Fonti e metodo</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/controlli">Segnali</Link>
      </section>
    </main>
  );
}

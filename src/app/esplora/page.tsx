import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EsploraSearch } from "./EsploraSearch";
import Link from "next/link";
import styles from "./esplora.module.css";

export const metadata = {
  title: "Esplora relazioni · Dove vanno i nostri soldi?",
  description:
    "Ricerca trasversale di persone ed enti negli incarichi pubblici (fetta incarichi-nominativi-shard). I riferimenti CIG/CUP e di atto sono in nota e ricercabili.",
};

type MetaLike = {
  relationCount?: number;
  caveat?: string;
  acquisitionDate?: string;
};

function loadMeta(): MetaLike {
  const p = join(
    process.cwd(),
    "src/data/generated/investigative-explorer-incarichi.meta.json",
  );
  if (!existsSync(p)) return { relationCount: 0, caveat: "" };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as MetaLike;
  } catch {
    return { relationCount: 0, caveat: "" };
  }
}

export default function EsploraPage() {
  const m = loadMeta();
  const count = m.relationCount ?? 0;
  const caveat = m.caveat ?? "";

  return (
    <main className="shell">
      <section className={styles.intro}>
        <h1>Esplora relazioni</h1>
        <p>
          Fetta verticale su <code>incarichi-nominativi-shard</code>: ogni arco collega una
          persona a un ente (incarico). Su{" "}
          <strong>{count.toLocaleString("it-IT")}</strong> relazioni estratte dai dati
          integrati DVNS, i riferimenti CIG/CUP e di atto compaiono in nota ed sono
          ricercabili. Non fondiamo persone con lo stesso nome senza un id stabile.
        </p>
        <p className={styles.caveat}>{caveat}</p>
      </section>

      <EsploraSearch initialCount={count} />

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

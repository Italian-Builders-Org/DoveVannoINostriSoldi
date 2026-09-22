import type { Metadata } from "next";
import Link from "next/link";
import { integer, longDate } from "@/lib/format";
import {
  istatPermessiCostruireData,
  istatPermessiCostruireMetadata,
} from "@/lib/istat-permessi-costruire-snapshot";
import styles from "./edilizia.module.css";

export const metadata: Metadata = {
  title: "Edilizia · permessi di costruire",
  description:
    "Serie nazionali ISTAT 2015-2025 sui permessi di costruire (tavole a.1-a.4): fabbricati, abitazioni, volumi e superfici. Mercato edilizio, non opere pubbliche né spesa SIOPE.",
  alternates: { canonical: "/edilizia" },
};

const TABLE_LABELS = {
  a1: "Nuova edilizia residenziale (a.1)",
  a2: "Ampliamenti residenziali (a.2)",
  a3: "Nuova edilizia non residenziale (a.3)",
  a4: "Ampliamenti non residenziali (a.4)",
} as const;

function metric(value: number | null, status: "observed" | "missing"): string {
  if (status !== "observed" || value === null) return "Non osservato";
  return integer(value);
}

export default function EdiliziaPage() {
  const a1 = istatPermessiCostruireData.tables.a1;
  const latest = a1.years[a1.years.length - 1];
  const source = istatPermessiCostruireMetadata.source;

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className="eyebrow">Mercato edilizio · ISTAT</p>
        <h1>Permessi di costruire</h1>
        <p>
          Serie nazionali ufficiali 2015-2025 sulle autorizzazioni a costruire
          (tavole introduttive a.1-a.4). Sono conteggi, volumi e superfici: non
          pagamenti pubblici e non cantieri MOP.
        </p>
        <p className={styles.links}>
          <a href="#serie-residenziale">Residenziale ↓</a>
          <a href="#altre-tavole">Altre tavole ↓</a>
          <a href="#fonti">Fonti ↓</a>
          <Link href="/economia">Economia →</Link>
          <Link href="/opere">Opere pubbliche (altro dominio) →</Link>
        </p>
      </header>

      <section className={`panel ${styles.hero}`} aria-labelledby="edilizia-ultimo">
        <div>
          <h2 id="edilizia-ultimo" className="panel-title">
            Italia · {latest.year}
          </h2>
          <strong className={styles.heroRate} data-testid="edilizia-abitazioni-2025">
            {metric(latest.abitazioni.numero.value, latest.abitazioni.numero.status)}
          </strong>
          <p className={styles.heroLabel}>
            abitazioni in nuovi fabbricati residenziali (tavola a.1)
          </p>
        </div>
        <dl className={styles.heroMetrics}>
          <div>
            <dt>Fabbricati residenziali</dt>
            <dd>{metric(latest.fabbricati.numero.value, latest.fabbricati.numero.status)}</dd>
            <small>numero · a.1</small>
          </div>
          <div>
            <dt>Volume fabbricati</dt>
            <dd>{metric(latest.fabbricati.volume.value, latest.fabbricati.volume.status)} m³</dd>
            <small>nuova residenziale</small>
          </div>
          <div>
            <dt>Superficie utile abitabile</dt>
            <dd>
              {metric(latest.abitazioni.superficieUtile.value, latest.abitazioni.superficieUtile.status)} m²
            </dd>
            <small>abitazioni · a.1</small>
          </div>
        </dl>
      </section>

      <div className="notice">
        <strong>Distinto da opere pubbliche e spesa</strong>
        <p>
          Questa pagina misura i permessi di costruire del mercato (rilevazione
          ISTAT). Le opere pubbliche restano su <Link href="/opere">/opere</Link>{" "}
          (MOP/OpenBDAP). Nessuna somma con SIOPE, OpenBDAP o COFOG.
        </p>
      </div>

      <section id="serie-residenziale" className="panel" aria-labelledby="serie-a1-title">
        <h2 id="serie-a1-title" className="panel-title">
          {TABLE_LABELS.a1}
        </h2>
        <p className={styles.lead}>
          Nuovi fabbricati residenziali e relative abitazioni, Italia, anni
          2015-2025.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col">Fabbricati</th>
                <th scope="col">Volume (m³)</th>
                <th scope="col">Abitazioni</th>
                <th scope="col">Superficie utile (m²)</th>
              </tr>
            </thead>
            <tbody>
              {[...a1.years].reverse().map((row) => (
                <tr key={row.year}>
                  <th scope="row">{row.year}</th>
                  <td>{metric(row.fabbricati.numero.value, row.fabbricati.numero.status)}</td>
                  <td>{metric(row.fabbricati.volume.value, row.fabbricati.volume.status)}</td>
                  <td>{metric(row.abitazioni.numero.value, row.abitazioni.numero.status)}</td>
                  <td>
                    {metric(row.abitazioni.superficieUtile.value, row.abitazioni.superficieUtile.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="altre-tavole" className="panel" aria-labelledby="altre-tavole-title">
        <h2 id="altre-tavole-title" className="panel-title">
          Altre tavole nazionali nello snapshot
        </h2>
        <p className={styles.lead}>
          a.2-a.4 restano serie distinte (ampliamenti e non residenziale). API e
          MCP espongono i dettagli; qui il riepilogo dell’ultimo anno.
        </p>
        <ul className={styles.tableList}>
          {(() => {
            const a2 = istatPermessiCostruireData.tables.a2.years.at(-1)!;
            const a3 = istatPermessiCostruireData.tables.a3.years.at(-1)!;
            const a4 = istatPermessiCostruireData.tables.a4.years.at(-1)!;
            return [
              {
                key: "a2" as const,
                year: a2.year,
                summary: `Totale ampliamenti: volume ${metric(a2.totaleAmpliamenti.volume.value, a2.totaleAmpliamenti.volume.status)} m³`,
              },
              {
                key: "a3" as const,
                year: a3.year,
                summary: `Totale nuovi fabbricati non residenziali: ${metric(a3.sectors.totale.fabbricati.value, a3.sectors.totale.fabbricati.status)}`,
              },
              {
                key: "a4" as const,
                year: a4.year,
                summary: `Totale ampliamenti non residenziali: volume ${metric(a4.sectors.totale.volume.value, a4.sectors.totale.volume.status)} m³`,
              },
            ].map((row) => (
              <li key={row.key}>
                <strong>{TABLE_LABELS[row.key]}</strong>
                <span>
                  {row.year} · {row.summary}
                </span>
                <a href={`/api/edilizia/permessi-costruire?tavola=${row.key}&anno=${row.year}`}>
                  JSON API →
                </a>
              </li>
            ));
          })()}
        </ul>
      </section>

      <section id="fonti" className="panel" aria-labelledby="fonti-title">
        <h2 id="fonti-title" className="panel-title">
          Fonti e limiti
        </h2>
        <ul className={styles.caveats}>
          {istatPermessiCostruireData.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
        <dl className={styles.meta}>
          <div>
            <dt>Pubblicazione ISTAT</dt>
            <dd>{longDate(source.publicationDate)}</dd>
          </div>
          <div>
            <dt>Acquisizione snapshot</dt>
            <dd>{longDate(source.acquiredAt)}</dd>
          </div>
          <div>
            <dt>SHA-256 zip</dt>
            <dd>
              <code>{source.sha256}</code>
            </dd>
          </div>
          <div>
            <dt>Licenza payload</dt>
            <dd>{source.licenseId}</dd>
          </div>
        </dl>
        <p className={styles.links}>
          <a href={source.landingUrl}>Landing ISTAT 2025</a>
          <a href={source.url}>Download zip ufficiale</a>
          <a href="/api/edilizia/permessi-costruire">API completa</a>
          <Link href="/fonti">Registro fonti →</Link>
        </p>
      </section>
    </main>
  );
}

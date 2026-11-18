import type { Metadata } from "next";
import Link from "next/link";
import data from "@/lib/data/rendite-catalogo.json";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "../studies.module.css";

const catalogue = data;
const title = "Rendite e inefficienze: casi da verificare";
const description =
  "79 casi di indagine e sette proposte di riforma, con fonti ufficiali di partenza. Nessuna stima economica non documentata.";
const sourceUrl =
  "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/blob/main/research/rendite-inefficienze/README.md";

type SourceLink = {
  label: string;
  url: string;
  holder?: string;
  checkedAt?: string;
  note?: string;
};

type Evidence = {
  sourceUrl: string;
  holder: string;
  publishedOn?: string;
  acquiredAt?: string;
  facts: string[];
  doesNotShow?: string;
};

type CatalogueItem = {
  id: string;
  name: string;
  question: string;
  sources?: SourceLink[];
  evidence?: Evidence;
};

export const metadata: Metadata = {
  title: `${title} · Studi`,
  description,
  alternates: { canonical: `${PUBLIC_SITE_URL}/studi/rendite-inefficienze` },
  openGraph: {
    type: "article",
    title,
    description,
    url: `${PUBLIC_SITE_URL}/studi/rendite-inefficienze`,
    locale: "it_IT",
  },
};

function SourcesList({ sources }: Readonly<{ sources?: SourceLink[] }>) {
  if (!sources?.length) return null;
  return (
    <div>
      <p>
        <strong>Fonti di partenza.</strong>
      </p>
      <ul>
        {sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} rel="noopener noreferrer">
              {source.label}
            </a>
            {source.holder ? ` · ${source.holder}` : ""}
            {source.checkedAt ? ` · verificato ${source.checkedAt}` : ""}
            {source.note ? ` — ${source.note}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceBlock({ evidence }: Readonly<{ evidence?: Evidence }>) {
  if (!evidence) return null;
  return (
    <div>
      <p>
        <strong>Dati osservati dalla fonte.</strong> {evidence.holder}
        {evidence.publishedOn ? ` · ${evidence.publishedOn}` : ""}.
      </p>
      <ul>
        {evidence.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {evidence.doesNotShow ? <p>{evidence.doesNotShow}</p> : null}
      <p>
        <a href={evidence.sourceUrl} rel="noopener noreferrer">
          Apri la fonte
        </a>
      </p>
    </div>
  );
}

export default function RenditeCataloguePage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <Link href="/studi">Tutti gli studi</Link>
      <header className={styles.intro}>
        <h1>{title}</h1>
        <p>
          79 casi da approfondire, raccolti in sette gruppi, e sette proposte di riforma da
          discutere — con fonti ufficiali di partenza per ciascun tema.
        </p>
        <p>
          <strong>Catalogo di ricerca · Da verificare.</strong> Non è uno studio economico
          concluso né una raccomandazione di policy di DVNS: le fonti indicano dove cercare, non
          importi da sommare.
        </p>
        <p className={styles.meta}>
          I nomi dei casi indicano temi di indagine, non rendite, sprechi o illeciti accertati.
          Le stime originarie del contributo non sono pubblicate in questa pagina.
        </p>
        <div className={styles.actions}>
          <a href="#catalogo">Esplora i casi</a>
          <a href="#proposte">Leggi le proposte e i limiti</a>
          <a href={sourceUrl}>Dossier e metodo di verifica</a>
        </div>
      </header>

      <aside className={styles.note}>
        <strong>Nessuna stima economica non documentata.</strong> Il catalogo non quantifica costi
        o risparmi e non calcola un totale. Un importo non disponibile non equivale a un costo
        nullo. Casi e proposte possono sovrapporsi: non si sommano e non dimostrano responsabilità
        o causalità.
      </aside>

      <section className={styles.section} aria-labelledby="perimetri-title">
        <h2 id="perimetri-title">Tre perimetri da tenere distinti</h2>
        <ul>
          <li>
            <strong>Spesa pubblica:</strong> risorse di amministrazioni ed enti pubblici. Per
            valutarle servono una voce contabile, un periodo e una fonte ufficiale.
          </li>
          <li>
            <strong>Costi privati:</strong> oneri sostenuti da famiglie e imprese. Non sono
            automaticamente spesa pubblica o risparmi per il bilancio dello Stato.
          </li>
          <li>
            <strong>Costi sistemici:</strong> effetti su tempi, accesso ai servizi, concorrenza o
            produttività. Richiedono una metodologia specifica; non coincidono necessariamente con
            un esborso monetario.
          </li>
        </ul>
        <p>
          Prima di formulare un risultato occorre definire il perimetro di ciascun caso, cercare
          prove verificabili, confrontare spiegazioni alternative e dichiarare limiti e
          sovrapposizioni.
        </p>
      </section>

      <nav className={styles.section} aria-labelledby="catalogo">
        <h2 id="catalogo">Catalogo dei casi</h2>
        <p>Ogni voce è una domanda aperta con fonti di partenza. Apri un caso per leggere che cosa verificare.</p>
        <ul>
          {catalogue.groups.map((group) => (
            <li key={group.id}>
              <a href={`#${group.id}`}>{group.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      {catalogue.groups.map((group) => (
        <section
          className={styles.section}
          key={group.id}
          id={group.id}
          aria-labelledby={`${group.id}-title`}
        >
          <h2 id={`${group.id}-title`}>{group.title}</h2>
          <p>
            Stato del gruppo: <strong>Da verificare</strong>.
          </p>
          <p>{group.description}</p>
          {group.items.map((raw) => {
            const item = raw as CatalogueItem;
            return (
              <details className="data-details" key={item.id} id={item.id}>
                <summary>
                  {item.name} · Da verificare
                </summary>
                <p>
                  <strong>Domanda di indagine.</strong> {item.question}
                </p>
                <EvidenceBlock evidence={item.evidence} />
                <SourcesList sources={item.sources} />
              </details>
            );
          })}
        </section>
      ))}

      <section className={styles.section} id="proposte" aria-labelledby="proposte-title">
        <h2 id="proposte-title">Sette proposte di riforma, con i loro limiti</h2>
        <p>
          Alternative da valutare, non raccomandazioni chiuse. Efficacia, fattibilità, effetti
          distributivi e costi di attuazione restano da verificare.
        </p>
        {catalogue.proposals.map((proposal) => (
          <article
            className={styles.card}
            key={proposal.id}
            id={`proposta-${proposal.id}`}
            aria-labelledby={`proposta-${proposal.id}-title`}
          >
            <h3 id={`proposta-${proposal.id}-title`}>{proposal.title}</h3>
            <p>
              <strong>Da verificare.</strong>
            </p>
            <p>
              <strong>Azione proposta.</strong> {proposal.action}
            </p>
            <p>
              <strong>Limiti e condizioni.</strong> {proposal.limits}
            </p>
            <SourcesList sources={(proposal as { sources?: SourceLink[] }).sources} />
          </article>
        ))}
      </section>

      <section className={styles.section} aria-labelledby="fonte-title">
        <h2 id="fonte-title">Fonte e stato della ricerca</h2>
        <p>
          Il materiale di partenza è un elenco proposto in comunità. L’inclusione in questo
          catalogo non costituisce verifica dei fatti, adesione alle proposte o conferma da parte
          di un&apos;istituzione. Le fonti collegate sono punti di ingresso ufficiali: non
          trasformano le domande in risultati.
        </p>
        <p>
          <a href={sourceUrl}>Leggi il dossier, i materiali e il percorso di verifica su GitHub</a>.
        </p>
        <p>
          <Link href="/metodologia">Come leggiamo e verifichiamo i dati</Link>
        </p>
      </section>
    </main>
  );
}

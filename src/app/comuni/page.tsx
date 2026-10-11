import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DEFAULT_COMUNI_IPA,
  displayMunicipalityName,
  featuredComuni,
  getComuniFootprintByIpaCode,
  searchComuni,
} from "@/lib/comuni-footprint";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { ComuniDossier } from "./comuni-dossier";
import { ComuniSearch } from "./comuni-search";
import styles from "./comuni.module.css";

export const metadata: Metadata = {
  title: "Impronta finanziaria dei Comuni",
  description:
    "Esplora i pagamenti di cassa SIOPE di ogni Comune italiano, confrontali con territori simili e consulta le fonti ufficiali collegate. Nessun voto opaco.",
};

type ComuniPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function ComuniPage({ searchParams }: ComuniPageProps) {
  const params = await searchParams;
  const requestedEnte = first(params.ente).trim();
  const query = first(params.q).trim().slice(0, 120);
  const searching = query.length >= 2;
  const ente = requestedEnte || (searching ? "" : DEFAULT_COMUNI_IPA);
  const footprint = ente ? await getComuniFootprintByIpaCode(ente) : null;
  const defaultFootprint = !footprint && !searching && !requestedEnte
    ? await getComuniFootprintByIpaCode(DEFAULT_COMUNI_IPA)
    : null;
  const shown = footprint ?? defaultFootprint;
  const searchHits = searching ? searchComuni(query, 14) : [];
  const featured = featuredComuni();
  const missingRequested = Boolean(requestedEnte && !footprint);

  return (
    <main className={styles.immersivePage} data-immersive-page="comuni">
      <a className={styles.skipLink} href="#comuni-contenuto">Vai al contenuto</a>
      <header className={styles.immersiveChrome}>
        <div className={styles.brandLockup}>
          <a className={styles.immersiveBrand} href={PUBLIC_SITE_URL} aria-label="DoveVannoINostriSoldi, pagina iniziale">
            DVNS
          </a>
          <span className={styles.brandSeparator} aria-hidden="true" />
          <p className={styles.brandTitle}>Comuni</p>
        </div>
        <ComuniSearch initialQuery={query} />
        <div className={styles.immersiveActions}>
          <details className={styles.sourcesDisclosure}>
            <summary>Fonti</summary>
            <div className={styles.sourcesPanel}>
              <h2>Cosa misura questa pagina</h2>
              <p>
                Ogni asse del grafico è un indicatore ufficiale. La mediana dei comuni
                confrontabili vale 100. Contiamo solo la distanza dal gruppo di pari: non
                assegniamo un punteggio di rischio.
              </p>
              <ul>
                <li>SIOPE · pagamenti e incassi di cassa.</li>
                <li>Geografia ISTAT · definizione del gruppo di pari.</li>
                <li>OpenCivitas · spesa storica rispetto allo standard, se collegabile.</li>
                <li>IRPEF MEF · contribuenti, misure e fasce di reddito, se collegabili.</li>
                <li>ANAC · profilo appalti dell’ente, se pubblicato.</li>
                <li>MIM · sedi scolastiche; PNRR ReGiS localizzato + slice asili.</li>
                <li>BDAP (autonomia, FCDE, rigidità) non è inventata: resta fuori finché non c’è la fonte.</li>
              </ul>
              <p>
                Zero, dato mancante e fuori perimetro restano distinti. La scheda completa dell’ente
                resta su {PUBLIC_SITE_URL.replace(/^https:\/\//, "")}/enti.
              </p>
            </div>
          </details>
          <a
            className={styles.immersiveHomeLink}
            href={PUBLIC_SITE_URL}
            aria-label="Torna al sito DoveVannoINostriSoldi"
          >
            <span className={styles.homeLinkLabel}>Torna al sito</span>
            <span aria-hidden="true">↗</span>
          </a>
          <ThemeToggle />
        </div>
      </header>

      <div id="comuni-contenuto" className={styles.stage} tabIndex={-1}>
        {missingRequested ? (
          <p className={styles.searchHint} role="status">
            Nessun profilo SIOPE per il Codice IPA «{requestedEnte}». Prova un altro Comune dalla ricerca.
          </p>
        ) : null}

        {searching ? (
          <section className={styles.resultsBlock} aria-labelledby="comuni-results-title">
            <h2 id="comuni-results-title" className={styles.sectionLabel}>
              Risultati per «{query}»
            </h2>
            {searchHits.length > 0 ? (
              <ul className={styles.resultList}>
                {searchHits.map((hit) => (
                  <li key={hit.codiceIpa}>
                    <Link href={`/comuni?ente=${encodeURIComponent(hit.codiceIpa)}`}>
                      <strong>{displayMunicipalityName(hit.name)}</strong>
                      <span>Codice IPA {hit.codiceIpa}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.searchHint} role="status">
                Nessun Comune trovato per «{query}» nello snapshot SIOPE.
              </p>
            )}
            <div className={styles.featuredBlock}>
              <h2 className={styles.sectionLabel}>Oppure scegli</h2>
              <ul className={styles.featuredGrid}>
                {featured.map((hit) => (
                  <li key={hit.codiceIpa}>
                    <Link href={`/comuni?ente=${encodeURIComponent(hit.codiceIpa)}`}>
                      <strong>{displayMunicipalityName(hit.name)}</strong>
                      <span>
                        {[hit.province, hit.region].filter(Boolean).join(" · ") || hit.codiceIpa}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {shown && !searching ? <ComuniDossier footprint={shown} /> : null}
      </div>
    </main>
  );
}

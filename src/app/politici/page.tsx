import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { getRepubblicaGraph, getRepubblicaMap } from "@/lib/politici-repubblica";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { RepubblicaGraph, type GraphSelection } from "./repubblica-graph";
import styles from "./politici.module.css";

export const metadata: Metadata = {
  title: "Mappa della politica italiana",
  description:
    "Presidenza della Repubblica, Governo, Camera e Senato della XIX legislatura in una sola mappa: 626 persone, ruoli istituzionali, gruppi parlamentari, ritratti ufficiali e notizie recenti.",
};

type PoliticiPageProps = {
  searchParams: Promise<{ person?: string; group?: string; istituzione?: string; deputy?: string }>;
};

export default async function PoliticiPage({ searchParams }: PoliticiPageProps) {
  const graph = getRepubblicaGraph();
  const map = getRepubblicaMap();
  const params = await searchParams;

  const requestedPerson = params.person ?? (params.deputy ? `dep-${params.deputy}` : undefined);
  const initialSelection: GraphSelection =
    requestedPerson && map.people.some((person) => person.id === requestedPerson)
      ? { kind: "person", id: requestedPerson }
      : params.group && map.groups.some((group) => group.id === params.group)
        ? { kind: "group", id: params.group }
        : params.istituzione && map.institutions.some((institution) => institution.id === params.istituzione)
          ? { kind: "institution", id: params.istituzione }
          : { kind: "overview" };

  return (
    <main className={styles.immersivePage}>
      <header className={styles.immersiveChrome}>
        <Link className={styles.immersiveBrand} href={PUBLIC_SITE_URL}>
          DoveVannoINostriSoldi
        </Link>
        <div className={styles.immersiveActions}>
          <Link className={styles.immersiveHomeLink} href={PUBLIC_SITE_URL}>
            Torna al sito
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <RepubblicaGraph map={map} initialSelection={initialSelection} />
      <details className={styles.immersiveDetails}>
        <summary>Fonti e limiti · {graph.legislature.label}</summary>
        <ul>
          {graph.sources.map((source, index) => (
            <li key={`${source.url}#${index}`}>
              <a href={source.url}>{source.label}</a> · {source.license}, osservata il {source.observedDate}.
              {source.gap ? <> Limite: {source.gap}</> : null}
            </li>
          ))}
          {graph.caveats.slice(0, 3).map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
        <p>
          <Link href={`${PUBLIC_SITE_URL}/parlamento`}>Parlamento</Link>
          {" · "}
          <Link href={`${PUBLIC_SITE_URL}/governi`}>Governi</Link>
          {" · "}
          <Link href={PUBLIC_SITE_URL}>DoveVannoINostriSoldi</Link>
        </p>
      </details>
    </main>
  );
}

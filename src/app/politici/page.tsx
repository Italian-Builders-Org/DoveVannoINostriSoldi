import type { Metadata } from "next";
import Link from "next/link";
import { getPoliticiParlamentoSnapshot } from "@/lib/politici-parlamento";
import { PoliticiGraphExplorer, type PoliticiSelection } from "./politici-graph";

export const metadata: Metadata = {
  title: "Grafo politici",
  description:
    "Doppio emiciclo di Camera e Senato nella XIX legislatura, con gruppi, schede ufficiali e co-citazioni nelle notizie.",
};

type PoliticiPageProps = {
  searchParams: Promise<{ person?: string; deputy?: string; group?: string }>;
};

export default async function PoliticiPage({ searchParams }: PoliticiPageProps) {
  const snapshot = getPoliticiParlamentoSnapshot();
  const params = await searchParams;
  const requestedPerson = params.person ?? (params.deputy ? `camera:${params.deputy}` : undefined);
  const initialSelection: PoliticiSelection = requestedPerson && snapshot.people.some((item) => item.id === requestedPerson)
    ? { kind: "person", personId: requestedPerson }
    : params.group && snapshot.groups.some((item) => item.id === params.group)
      ? { kind: "group", groupId: params.group }
      : { kind: "overview" };

  return (
    <main className="shell page">
      <section className="page-intro">
        <p className="eyebrow">Istituzioni · Parlamento italiano</p>
        <h1>Grafo politici</h1>
        <p>
          Esplora Camera e Senato nello stesso doppio emiciclo della {snapshot.legislature.label}.
          Le linee tra i rami collegano gruppi omologhi; selezionando una persona emergono le co-citazioni nelle notizie.
        </p>
      </section>

      <PoliticiGraphExplorer snapshot={snapshot} initialSelection={initialSelection} />

      <details className="data-details">
        <summary>Come leggere il grafo, fonti e limiti</summary>
        <p>
          Fonti: {snapshot.chambers.map((chamber, index) => (
            <span key={chamber.id}>
              {index ? " · " : null}
              <a href={chamber.sourceUrl}>{chamber.sourceTitle}</a> ({chamber.license}, osservata {chamber.observedDate})
            </span>
          ))}.
        </p>
        <ul>
          {snapshot.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
          <li>
            Le notizie sono una ricerca live nei metadati GDELT degli ultimi tre mesi:
            non costituiscono una rassegna completa e restano attribuite ai rispettivi editori.
          </li>
        </ul>
        <p>
          Collegamenti utili: <Link href="/parlamento">spesa del Parlamento</Link>,{" "}
          <Link href="/governi">pagella dei governi</Link>,{" "}
          <Link href="/esplora">relazioni da incarichi pubblici</Link>.
        </p>
      </details>
    </main>
  );
}

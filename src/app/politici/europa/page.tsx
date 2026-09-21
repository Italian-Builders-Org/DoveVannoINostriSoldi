import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { buildEurodeputatiPageView } from "@/lib/politici-eurodeputati";
import local from "./europa.module.css";

export const metadata: Metadata = {
  title: "Eurodeputati eletti in Italia",
  description:
    "Elenco ufficiale degli eurodeputati con country-of-representation Italia, dal portale Open Data del Parlamento europeo. Vista separata dall’atlante nazionale.",
};

export default function PoliticiEuropaPage() {
  const view = buildEurodeputatiPageView();

  return (
    <main className={`shell page ${local.page}`} id="eurodeputati-italia">
      <div className="page-intro">
        <p className={local.eyebrow}>Parlamento europeo</p>
        <h1>{view.institution.chamberLabel}</h1>
        <p>
          {view.coverage.memberCount} persone con country-of-representation Italia, in{" "}
          {view.coverage.groupCount} gruppi politici europei, rilevati il{" "}
          {longDate(view.period.observedDate)}. Non fanno parte dell’atlante Camera/Senato/Governo.
        </p>
        <p className={local.trail}>
          <Link href="/politici">Atlante nazionale</Link>
          {" · "}
          <Link href="/parlamento">Spese del Parlamento</Link>
          {" · "}
          <a href={view.source.landingUrl} target="_blank" rel="noopener noreferrer">
            Elenco ufficiale
            <span className="sr-only"> (nuova scheda)</span>
          </a>
        </p>
      </div>

      <dl className={`stat-strip ${local.stats}`}>
        <div>
          <dt>Eurodeputati IT</dt>
          <dd>{view.coverage.memberCount}</dd>
        </div>
        <div>
          <dt>Gruppi UE</dt>
          <dd>{view.coverage.groupCount}</dd>
        </div>
        <div>
          <dt>Rilevazione</dt>
          <dd>{longDate(view.period.observedDate)}</dd>
        </div>
      </dl>

      <details className={local.sources}>
        <summary>Fonti e limiti</summary>
        <div>
          <h2>Da dove arrivano i dati</h2>
          <ul>
            <li>
              <a href={view.source.landingUrl} target="_blank" rel="noopener noreferrer">
                Parlamento europeo, elenco MEPs
                <span className="sr-only"> (nuova scheda)</span>
              </a>
              <p>
                {view.source.license} · osservata il {longDate(view.source.observedDate)}.
              </p>
              <p>
                Endpoint Open Data:{" "}
                <a href={view.source.apiDocsUrl} target="_blank" rel="noopener noreferrer">
                  API v2
                  <span className="sr-only"> (nuova scheda)</span>
                </a>
                .
              </p>
            </li>
          </ul>
          <h3>Metodo e limiti</h3>
          <ul>
            {view.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      </details>

      <div className={local.groups}>
        {view.groups.map((group) => {
          const tableId = `gruppo-${group.code.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          return (
            <section key={group.code} className={local.group} aria-labelledby={tableId}>
              <h2 id={tableId}>
                {group.code}
                <span className={local.groupCount}>
                  {group.memberCount} {group.memberCount === 1 ? "persona" : "persone"}
                </span>
              </h2>
              <div className="table-scroll" role="region" aria-labelledby={tableId} tabIndex={0}>
                <table className="table">
                  <caption className="table-caption">
                    Eurodeputati del gruppo {group.code}, ordine alfabetico per cognome
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Persona</th>
                      <th scope="col">Scheda ufficiale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.meps.map((mep) => (
                      <tr key={mep.id}>
                        <th scope="row">{mep.displayName}</th>
                        <td>
                          <a href={mep.officialPage} target="_blank" rel="noopener noreferrer">
                            Apri su europarl.europa.eu
                            <span className="sr-only"> (nuova scheda)</span>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      <p className={local.sourceNote}>
        Fonte: {view.source.owner} · licenza {view.source.license} · osservata il{" "}
        {longDate(view.source.observedDate)} ·{" "}
        <a href={view.institution.landingUrl}>elenco ufficiale</a>
      </p>
    </main>
  );
}

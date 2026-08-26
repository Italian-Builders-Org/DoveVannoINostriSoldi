import type { Metadata } from "next";
import { BUY_ME_A_COFFEE_URL } from "@/lib/site";
import { SITE_SUPPORTERS } from "@/lib/supporters";
import styles from "../legal-page.module.css";

export const metadata: Metadata = {
  title: "Chi ci sostiene",
  description: "Chi sostiene DoveVannoINostriSoldi con infrastruttura, tempo o community.",
};

export default function SupportersPage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <div className="page-intro">
        <h1>Chi ci sostiene</h1>
        <p>
          Il sito resta indipendente e open source. Qui riconosciamo chi ci dà infrastruttura,
          tempo o una community in cui lavorare. Non sono fonti dei dati pubblici e non
          influenzano i numeri pubblicati.
        </p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Donazioni individuali</h2>
        <p>
          Se vuoi contribuire a compute e hosting puoi farlo su Buy Me a Coffee. Il contributo
          resta volontario e non influenza i dati pubblicati.
        </p>
        <p>
          <a className="btn btn-primary" href={BUY_ME_A_COFFEE_URL} target="_blank" rel="noreferrer">
            Buy me an AI compute
          </a>
        </p>
      </section>

      {SITE_SUPPORTERS.map((supporter) => (
        <section className="panel" key={supporter.href}>
          <h2 className="panel-title">{supporter.name}</h2>
          <p>{supporter.contribution}</p>
          <p>
            <a href={supporter.href} target="_blank" rel="noreferrer">
              {new URL(supporter.href).hostname} ↗
            </a>
          </p>
        </section>
      ))}
    </main>
  );
}

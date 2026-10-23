import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { compactEuro, longDate } from "@/lib/format";
import { getTedOpenNoticeByNumber, TED_OPEN_FORM_LABELS } from "@/lib/ted-open-notices";
import styles from "../bandi-aperti.module.css";

type Params = { numero: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { numero } = await params;
  const notice = await getTedOpenNoticeByNumber(decodeURIComponent(numero));
  if (!notice) return { title: "Avviso non trovato" };
  return {
    title: `${notice.number} · bando TED`,
    description: notice.title,
  };
}

export default async function BandiApertiDettaglioPage({ params }: { params: Promise<Params> }) {
  const { numero } = await params;
  const notice = await getTedOpenNoticeByNumber(decodeURIComponent(numero));
  if (!notice) notFound();

  return (
    <main className={`shell page ${styles.page}`}>
      <nav aria-label="Percorso">
        <Link href="/appalti">Appalti pubblici</Link> / <Link href="/appalti/bandi-aperti">Bandi aperti</Link> / {notice.number}
      </nav>
      <div className="page-intro">
        <p className="eyebrow">Scheda sintetica · TED · non è un contratto aggiudicato</p>
        <h1>{notice.title}</h1>
        <p>Avviso {notice.number} · {notice.nature} · {TED_OPEN_FORM_LABELS[notice.form]}</p>
      </div>
      <dl className="detail-list">
        <div>
          <dt>Stazione appaltante</dt>
          <dd lang={notice.buyerLanguage === "eng" ? "en" : "it"}>{notice.buyers.join(" · ")}</dd>
        </div>
        <div>
          <dt>Scadenza presentazione offerte</dt>
          <dd>
            <time dateTime={notice.deadline}>{longDate(notice.deadline)}</time>
            {" · "}
            {notice.stillOpen ? "scadenza futura alla data odierna" : "scadenza già passata"}
          </dd>
        </div>
        <div>
          <dt>Data pubblicazione avviso</dt>
          <dd><time dateTime={notice.publicationDate}>{longDate(notice.publicationDate)}</time></dd>
        </div>
        <div>
          <dt>Codici CPV</dt>
          <dd>{notice.cpvs.join(" · ")}</dd>
        </div>
        <div>
          <dt>Importo stimato</dt>
          <dd>{notice.amountCents === null ? "Non pubblicato in euro nello snapshot" : compactEuro(notice.amountCents / 100)}</dd>
        </div>
        {notice.cities.length > 0 ? (
          <div>
            <dt>Luoghi citati</dt>
            <dd>{notice.cities.join(" · ")}</dd>
          </div>
        ) : null}
        <div>
          <dt>Fonte ufficiale</dt>
          <dd>
            <a href={notice.url} rel="noreferrer" target="_blank">
              Avviso TED {notice.number}
              <span className="sr-only"> (nuova scheda)</span>
            </a>
          </dd>
        </div>
      </dl>
      <aside className="notice">
        <p>
          Questa scheda riassume metadati TED. Non certifica l&apos;esito della gara né sostituisce il bando completo.
          Per aggiudicazioni concluse consulta lo storico ANAC; per ordini MePA lo{" "}
          <Link href="/appalti/mepa">strumento MePA</Link>.
        </p>
      </aside>
      <p><Link href="/appalti/bandi-aperti">Torna all&apos;elenco bandi aperti</Link></p>
    </main>
  );
}

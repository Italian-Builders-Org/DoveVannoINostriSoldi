import type { Metadata } from "next";
import { CONTACT_EMAIL } from "@/lib/site";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Come trattiamo i dati delle richieste di consulenza.",
};

export default function PrivacyPage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <div className="page-intro">
        <h1>Informativa privacy</h1>
        <p>
          Questa pagina riguarda solo i dati che invii dal form di consulenza. Il resto del
          sito legge fonti pubbliche e non chiede un account.
        </p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Titolare</h2>
        <p>
          Domenico Gagliardi, contattabile all&apos;indirizzo{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Quali dati e perché</h2>
        <p>
          Nome, email, organizzazione, tipo di ente, ruolo, oggetto della richiesta e
          messaggio. Li usiamo solo per rispondere e, se ha senso, per un eventuale
          incarico. Base giuridica: consenso e, se avviamo una trattativa, misure
          precontrattuali.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Quanto restano e chi li vede</h2>
        <p>
          Conserviamo la richiesta fino a 24 mesi, o meno se chiedi la cancellazione
          prima. L&apos;email di notifica passa da Resend e arriva nella casella indicata
          sopra. Non vendiamo i contatti e non facciamo profilazione pubblicitaria.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">I tuoi diritti</h2>
        <p>
          Puoi chiedere accesso, correzione, cancellazione, limitazione o opposizione
          scrivendo alla stessa email. Puoi anche revocare il consenso e presentare
          reclamo al Garante per la protezione dei dati personali.
        </p>
      </section>
    </main>
  );
}

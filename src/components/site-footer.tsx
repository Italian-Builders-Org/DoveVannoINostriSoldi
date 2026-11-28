import Link from "next/link";
import { BrandIcon } from "@/components/brand-icons";
import { CHATGPT_PLUGIN_URL, REPO_URL, SOCIAL_LINKS } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="shell site-footer">
      <div className="footer-top">
        <aside className="footer-support" aria-labelledby="footer-support-title">
          <div className="footer-support-copy">
            <strong id="footer-support-title">Dove vanno i nostri soldi?</strong>
            <span>Dati ufficiali sulla spesa pubblica italiana.</span>
          </div>
        </aside>
        <div className="footer-directory">
          <nav className="footer-social" aria-label="Canali social">
            <ul>{SOCIAL_LINKS.map((channel) => <li key={channel.id}>
              <a className="footer-link" href={channel.href} target="_blank" rel="noopener noreferrer" aria-label={`${channel.label} (nuova scheda)`} title={`${channel.label} (nuova scheda)`}>
                <BrandIcon name={channel.id} size={19} />
              </a>
            </li>)}</ul>
          </nav>
          <nav className="footer-actions" aria-label="Link di servizio">
            <Link prefetch={false} href="/fonti">Fonti</Link>
            <Link prefetch={false} href="/metodologia">Metodo</Link>
            <Link prefetch={false} href="/privacy">Privacy</Link>
            <Link prefetch={false} href="/termini">Termini</Link>
            <Link prefetch={false} href="/supporto">Supporto</Link>
            <a href={CHATGPT_PLUGIN_URL} target="_blank" rel="noopener noreferrer" aria-label="DVNS su ChatGPT (nuova scheda)">ChatGPT</a>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub (nuova scheda)">GitHub</a>
          </nav>
        </div>
      </div>
      <p className="footer-disclaimer">
        Usiamo anche l’AI per organizzare e presentare i dati. Sono possibili errori:
        verifica le fonti originali prima di decidere. Il sito non fornisce consulenza.
      </p>
      <div className="footer-credits">
        <div className="footer-makers">
          <span>Un progetto di</span>
          <a href="https://x.com/fragiannicola" target="_blank" rel="noreferrer">@fragiannicola</a>
          <a href="https://x.com/dom_gag_96" target="_blank" rel="noreferrer">@dom_gag_96</a>
        </div>
        <div className="footer-backer">
          <Link prefetch={false} href="/supporter">Chi ci sostiene</Link>
        </div>
      </div>
    </footer>
  );
}

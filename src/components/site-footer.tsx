import Link from "next/link";
import {
  Facebook01Icon,
  GithubIcon,
  InstagramIcon,
  NewTwitterIcon,
  ThreadsIcon,
  TiktokIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { REPO_URL, SOCIAL_LINKS } from "@/lib/site";

const SOCIAL_ICONS = {
  threads: ThreadsIcon,
  facebook: Facebook01Icon,
  instagram: InstagramIcon,
  tiktok: TiktokIcon,
  x: NewTwitterIcon,
} as const;

export function SiteFooter() {
  return (
    <footer className="shell site-footer">
      <div className="footer-top">
        <aside className="footer-support" aria-labelledby="footer-support-title">
          <div className="footer-support-copy">
            <strong id="footer-support-title">Dove vanno i nostri soldi?</strong>
            <span>Dati ufficiali sulla spesa pubblica italiana.</span>
            <Link prefetch={false} href="/metodologia" className="footer-support-label">Fonti e metodo</Link>
          </div>
        </aside>
        <div className="footer-directory">
          <nav className="footer-social" aria-label="Canali social">
            <ul>{SOCIAL_LINKS.map((channel) => <li key={channel.id}>
              <a className="footer-link" href={channel.href} target="_blank" rel="noopener noreferrer" aria-label={`${channel.label} (nuova scheda)`} title={`${channel.label} (nuova scheda)`}>
                <HugeiconsIcon icon={SOCIAL_ICONS[channel.id]} size={19} strokeWidth={1.8} aria-hidden="true" />
              </a>
            </li>)}</ul>
          </nav>
          <nav className="footer-actions" aria-label="Link di servizio">
            <Link prefetch={false} href="/fonti">Fonti</Link>
            <Link prefetch={false} href="/metodologia">Metodo</Link>
            <Link prefetch={false} href="/privacy">Privacy</Link>
            <Link prefetch={false} href="/termini">Termini</Link>
            <Link prefetch={false} href="/supporto">Supporto</Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub (nuova scheda)"><HugeiconsIcon icon={GithubIcon} size={16} aria-hidden="true" /> GitHub</a>
          </nav>
        </div>
      </div>
      <p className="footer-disclaimer">
        Usiamo anche l’AI per organizzare e presentare i dati. Sono possibili errori:
        verifica le fonti originali prima di decidere. Il sito non fornisce consulenza.{" "}
        <Link prefetch={false} href="/metodologia">Metodo</Link>
        {" · "}
        <Link prefetch={false} href="/termini">Termini</Link>
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

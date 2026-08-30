import Link from "next/link";
import { Coffee02Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ReportProblemButton } from "@/components/report-problem/report-problem-button";
import { FOOTER_SITEMAP_GROUPS } from "@/lib/site-navigation";
import { BUY_ME_A_COFFEE_URL, REPO_URL } from "@/lib/site";

type SiteFooterProps = Readonly<{
  latestTerritorialCheckLabel: string;
}>;

export function SiteFooter({ latestTerritorialCheckLabel }: SiteFooterProps) {
  return (
    <footer className="shell site-footer">
      <section className="footer-sitemap" aria-labelledby="footer-sitemap-title">
        <h2 id="footer-sitemap-title" className="footer-sitemap-title">
          Mappa del sito
        </h2>
        <div className="footer-sitemap-columns">
          {FOOTER_SITEMAP_GROUPS.map((group) => (
            <div key={group.title} className="footer-sitemap-group">
              <h3>{group.title}</h3>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
              </div>
            ))}
        </div>
      </section>

      <aside className="footer-support" aria-labelledby="footer-support-title">
        <div className="footer-support-copy">
          <h2 id="footer-support-title">Sostieni il progetto</h2>
          <p>
            Il sito resta indipendente e open source. Un contributo aiuta a pagare compute e
            hosting; non influenza i dati pubblicati.
          </p>
        </div>
        <a
          className="footer-support-action"
          href={BUY_ME_A_COFFEE_URL}
          target="_blank"
          rel="noreferrer"
        >
          <HugeiconsIcon icon={Coffee02Icon} size={16} strokeWidth={1.8} aria-hidden="true" />
          Buy me an AI compute
        </a>
      </aside>

      <div className="footer-utility">
        <div className="footer-meta">
          <span>Ultimo controllo SIOPE o IRPEF: {latestTerritorialCheckLabel}</span>
          <span>Dati pubblici, liberi da riusare</span>
        </div>
        <nav className="footer-actions" aria-label="Link di servizio">
          <Link className="footer-link" href="/privacy">Privacy</Link>
          <a className="footer-link" href={REPO_URL} target="_blank" rel="noreferrer">
            <HugeiconsIcon icon={GithubIcon} size={16} strokeWidth={1.8} aria-hidden="true" />
            Codice su GitHub
          </a>
          <Link className="footer-link" href="/mcp">MCP</Link>
        </nav>
      </div>
      <div className="footer-credits">
        <div className="footer-makers">
          <span className="footer-credit">Fatto da</span>
          <a href="https://x.com/fragiannicola" target="_blank" rel="noreferrer">@fragiannicola</a>
          <span aria-hidden="true">·</span>
          <a href="https://x.com/dom_gag_96" target="_blank" rel="noreferrer">@dom_gag_96</a>
        </div>
        <nav className="footer-secondary-links" aria-label="Informazioni sul progetto">
          <Link href="/supporter">Chi ci sostiene</Link>
          <Link href="/supporto">Supporto</Link>
          <ReportProblemButton variant="inline" />
          <Link href="/termini">Termini</Link>
        </nav>
      </div>
    </footer>
  );
}

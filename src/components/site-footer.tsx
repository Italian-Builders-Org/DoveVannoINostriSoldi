import Link from "next/link";
import {
  Coffee02Icon,
  ArrowUpRight01Icon,
  Facebook01Icon,
  GithubIcon,
  InstagramIcon,
  NewTwitterIcon,
  ThreadsIcon,
  TiktokIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FOOTER_SITEMAP_GROUPS } from "@/lib/site-navigation";
import { BUY_ME_A_COFFEE_URL, REPO_URL, SOCIAL_LINKS } from "@/lib/site";
import { SITE_SUPPORTERS } from "@/lib/supporters";

function mantoVentureSupporter() {
  const supporter = SITE_SUPPORTERS.find((item) => item.name === "Manto Venture");
  if (!supporter?.href) {
    throw new Error("Manto Venture deve avere un URL pubblico nel footer");
  }
  return supporter;
}

const MANTO_VENTURE = mantoVentureSupporter();

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
          <a className="footer-support-action" href={BUY_ME_A_COFFEE_URL} target="_blank" rel="noreferrer">
            <HugeiconsIcon icon={Coffee02Icon} size={22} strokeWidth={1.8} aria-hidden="true" />
            <span className="footer-support-copy">
              <strong id="footer-support-title">Sostieni DVNS</strong>
              <span>Dati accessibili, progetto indipendente.</span>
              <span className="footer-support-label">Contribuisci <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} aria-hidden="true" /></span>
            </span>
          </a>
        </aside>
        <div className="footer-directory">
          <nav className="footer-social" aria-label="Canali social">
            <ul>{SOCIAL_LINKS.map((channel) => <li key={channel.id}>
              <a className="footer-link" href={channel.href} target="_blank" rel="noreferrer" aria-label={channel.label} title={channel.label}>
                <HugeiconsIcon icon={SOCIAL_ICONS[channel.id]} size={19} strokeWidth={1.8} aria-hidden="true" />
              </a>
            </li>)}</ul>
          </nav>
          <nav className="footer-actions" aria-label="Link di servizio">
            <Link href="/fonti">Fonti</Link>
            <Link href="/metodologia">Metodo</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/termini">Termini</Link>
            <Link href="/supporto">Supporto</Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer"><HugeiconsIcon icon={GithubIcon} size={16} aria-hidden="true" /> GitHub</a>
          </nav>
        </div>
      </div>
      <details className="footer-sitemap">
        <summary>Mappa del sito</summary>
        <div className="footer-sitemap-columns">
          {FOOTER_SITEMAP_GROUPS.map((group) => <div key={group.title} className="footer-sitemap-group">
            <h3>{group.title}</h3>
            <ul>{group.links.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}</ul>
          </div>)}
        </div>
      </details>
      <div className="footer-credits">
        <div className="footer-makers">
          <span>Un progetto di</span>
          <a href="https://x.com/fragiannicola" target="_blank" rel="noreferrer">@fragiannicola</a>
          <a href="https://x.com/dom_gag_96" target="_blank" rel="noreferrer">@dom_gag_96</a>
        </div>
        <div className="footer-backer">
          <span>Con il supporto di <a href={MANTO_VENTURE.href} target="_blank" rel="noreferrer">{MANTO_VENTURE.name}</a></span>
          <Link href="/supporter">Chi ci sostiene</Link>
        </div>
      </div>
    </footer>
  );
}

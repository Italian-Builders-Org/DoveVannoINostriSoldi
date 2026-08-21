"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { REPO_URL } from "@/lib/site";

const primary = [
  { href: "/", label: "Home" },
  { href: "/spese", label: "Soldi", aliases: ["/stato", "/parlamento"] },
  { href: "/territori", label: "Territori" },
  { href: "/coesione", label: "Fondi e progetti" },
  { href: "/enti", label: "Enti e società", aliases: ["/partecipazioni"] },
  { href: "/controlli", label: "Cosa controllare" },
  { href: "/fonti", label: "Fonti", aliases: ["/metodologia"] },
];

export function Navigation() {
  const pathname = usePathname();
  const navigationRef = useRef<HTMLElement>(null);
  const activeLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const navigation = navigationRef.current;
    const activeLink = activeLinkRef.current;
    if (!navigation || !activeLink) return;
    const navigationBox = navigation.getBoundingClientRect();
    const activeBox = activeLink.getBoundingClientRect();
    if (activeBox.left < navigationBox.left || activeBox.right > navigationBox.right) {
      activeLink.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [pathname]);

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand" aria-label="Dove vanno i nostri soldi, home">
          <Image
            className="brand-mark"
            src="/brand/dvns-mark-transparent.svg"
            width={44}
            height={44}
            alt=""
            aria-hidden="true"
            priority
          />
          <span className="brand-text">
            <strong>Dove vanno i nostri soldi?</strong>
            <small>I soldi pubblici, spiegati semplice</small>
          </span>
        </Link>

        <span className="header-spacer" />

        <form className="header-search" action="/enti" method="get" role="search">
          <label htmlFor="global-entity-search">Cerca nel registro degli enti</label>
          <input
            className="input"
            id="global-entity-search"
            name="q"
            type="search"
            placeholder="Cerca un Comune, un ente o un ministero"
            autoComplete="off"
          />
          <button type="submit" aria-label="Cerca">
            <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </form>

        <div className="header-actions">
          <Link className="header-action" href="/fonti">
            Scarica i dati
          </Link>
          <Link className="header-action" href="/consulenza">
            Consulenza
          </Link>
          <Link className="header-action header-action-accent" href="/mcp">
            MCP
          </Link>
          <a
            className="header-action header-action-icon"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Codice su GitHub, si apre in una nuova scheda"
            title="Codice su GitHub"
          >
            <HugeiconsIcon icon={GithubIcon} size={19} strokeWidth={1.7} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="shell nav-row">
        <nav className="primary-nav" aria-label="Navigazione principale" ref={navigationRef}>
          {primary.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href) ||
                  item.aliases?.some((alias) => pathname.startsWith(alias));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                ref={active ? activeLinkRef : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <span className="nav-note">Fonte e data sempre visibili</span>
      </div>
    </header>
  );
}

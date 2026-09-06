"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { HeaderSearch } from "@/components/header-search";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, Menu01Icon, Cancel01Icon,
  GithubIcon, Home01Icon, News01Icon, Building03Icon, School01Icon, Money01Icon,
  MapsGlobal01Icon, Task01Icon, Building04Icon, Building06Icon, Search01Icon,
  AiChat01Icon, BookSearchIcon, BookOpen01Icon,
} from "@hugeicons/core-free-icons";
import { PRIMARY_NAV, isNavChildActive, isNavSectionActive } from "@/lib/site-navigation";
import { REPO_URL } from "@/lib/site";

const NAV_ICONS = {
  home: Home01Icon,
  news: News01Icon,
  business: Building03Icon,
  education: School01Icon,
  money: Money01Icon,
  map: MapsGlobal01Icon,
  projects: Task01Icon,
  institutions: Building04Icon,
  entities: Building06Icon,
  checks: Search01Icon,
  assistant: AiChat01Icon,
  sources: BookSearchIcon,
  research: BookOpen01Icon,
} as const;


type NavigationLocation = Readonly<{ pathname: string; currentSearch: string | null }>;

/** One link map and disclosure implementation for both responsive surfaces. */
function NavigationLinks({ pathname, currentSearch, id, collapsed = false, onNavigate }:
  NavigationLocation & Readonly<{ id: string; collapsed?: boolean; onNavigate?: () => void }>) {
  const [selection, setSelection] = useState<{ pathname: string; href: string | null } | null>(null);
  const activeSection = PRIMARY_NAV.find((item) => item.children?.length && isNavSectionActive(pathname, item));
  const openHref = selection?.pathname === pathname ? selection.href : activeSection?.href;
  return (
    <nav id={id} className="primary-nav" aria-label="Navigazione principale"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !onNavigate && openHref) {
          event.currentTarget.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus();
          setSelection({ pathname, href: null });
        }
      }}>
      <ul className="primary-nav-list">
        {PRIMARY_NAV.map((item) => {
          const active = isNavSectionActive(pathname, item);
          const hasChildren = Boolean(item.children?.length);
          const open = !collapsed && openHref === item.href;
          const menuId = `${id}-${item.icon}`;
          return (
            <li key={item.href} className={hasChildren ? "nav-item nav-item-has-menu" : "nav-item"}
              data-section-active={active ? "true" : undefined} data-open={open ? "true" : undefined}>
              {item.href === "/imprese" || item.href === "/report" ? (
                <span className="sidebar-group">{item.href === "/report" ? "Pubblicazioni" : "Esplora i dati"}</span>
              ) : null}
              <Link href={item.href} title={collapsed ? item.label : undefined}
                aria-current={pathname === item.href && currentSearch === "" && (!hasChildren || !open) ? "page" : undefined}
                data-section-active={active ? "true" : undefined} onNavigate={onNavigate}>
                <HugeiconsIcon icon={NAV_ICONS[item.icon]} size={19} strokeWidth={1.8} aria-hidden="true" />
                <span className="nav-label">{item.label}</span>
              </Link>
              {hasChildren ? (
                <button type="button" className="nav-item-toggle" aria-expanded={open}
                  aria-controls={menuId} aria-label={`Pagine in ${item.label}`}
                  onClick={() => setSelection({ pathname, href: open ? null : item.href })}>
                  <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : null}
              {hasChildren ? (
                <ul id={menuId} className="nav-submenu" hidden={!open} aria-label={`Pagine in ${item.label}`}>
                  {item.children!.map((child) => (
                    <li key={child.href}>
                      <Link href={child.href} onNavigate={onNavigate}
                        aria-current={currentSearch !== null && isNavChildActive(pathname, child.href, item.children!, currentSearch) ? "page" : undefined}>
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Navigation() {
  const pathname = usePathname();
  const [currentSearch, setCurrentSearch] = useState<string | null>(null);
  return (
    <>
      <Suspense fallback={null}><NavigationSearchSync onChange={setCurrentSearch} /></Suspense>
      <NavigationContent pathname={pathname} currentSearch={currentSearch} />
    </>
  );
}

function NavigationSearchSync({ onChange }: Readonly<{ onChange: (search: string) => void }>) {
  const currentSearch = useSearchParams().toString();
  useLayoutEffect(() => { onChange(currentSearch); }, [currentSearch, onChange]);
  return null;
}

function NavigationContent({ pathname, currentSearch }: NavigationLocation) {
  // Layout state survives client navigation; no storage-driven shift during hydration.
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openedLocationRef = useRef("");
  const backdropPointerRef = useRef(false);

  function closeDrawer() { dialogRef.current?.close(); }
  function openDrawer() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    openedLocationRef.current = window.location.pathname + window.location.search;
    dialog.showModal();
    setDrawerOpen(true);
    closeRef.current?.focus();
  }

  useEffect(() => {
    // Also close on history navigation, without closing on the first query sync.
    if (dialogRef.current?.open && openedLocationRef.current !== window.location.pathname + window.location.search) {
      dialogRef.current.close();
    }
  }, [pathname, currentSearch]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    function resize() {
      if (media.matches && dialogRef.current?.open) {
        dialogRef.current.close();
        collapseRef.current?.focus();
      } else if (!media.matches && document.activeElement?.closest(".desktop-sidebar")) {
        mobileTriggerRef.current?.focus();
      }
    }
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);

  return (
    <>
      <header className="site-header">
        <div className="shell header-inner">
          <button type="button" className="navigation-button mobile-menu-trigger" ref={mobileTriggerRef}
            aria-label="Apri menu di navigazione" aria-controls="mobile-navigation" aria-expanded={drawerOpen}
            aria-haspopup="dialog" onClick={openDrawer}>
            <HugeiconsIcon icon={Menu01Icon} size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <Link href="/" className="brand" aria-label="Dove vanno i nostri soldi, home">
            <Image className="brand-mark" src="/brand/dvns-mark-transparent.svg" width={44} height={44} alt="" aria-hidden="true" priority />
            <span className="brand-text"><strong>Dove vanno i nostri soldi?</strong></span>
          </Link>
          <span className="header-spacer" />
          <HeaderSearch />
          <div className="header-actions">
            <Link className="header-action header-action-accent" href="/mcp">Istruzioni MCP</Link>
            <a className="header-action header-action-icon" href={REPO_URL} target="_blank" rel="noreferrer"
              aria-label="Codice su GitHub, si apre in una nuova scheda" title="Codice su GitHub">
              <HugeiconsIcon icon={GithubIcon} size={19} strokeWidth={1.7} aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>
      <aside className="desktop-sidebar" data-collapsed={collapsed} aria-label="Menu del sito">
        <div className="sidebar-toolbar">
          <span className="sidebar-heading">Esplora</span>
          <button type="button" className="navigation-button sidebar-collapse" ref={collapseRef}
            aria-label={collapsed ? "Espandi menu di navigazione" : "Riduci menu a icone"}
            title={collapsed ? "Espandi menu di navigazione" : "Riduci menu a icone"}
            aria-expanded={!collapsed} aria-controls="desktop-navigation" onClick={() => setCollapsed(!collapsed)}>
            <HugeiconsIcon icon={collapsed ? ArrowRight01Icon : ArrowLeft01Icon} size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <NavigationLinks id="desktop-navigation" pathname={pathname} currentSearch={currentSearch} collapsed={collapsed} />
      </aside>
      <dialog id="mobile-navigation" className="mobile-navigation" ref={dialogRef} aria-labelledby="mobile-navigation-title"
        onClose={() => setDrawerOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
            .filter((node) => node.getClientRects().length > 0);
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onPointerDown={(event) => { backdropPointerRef.current = event.target === event.currentTarget; }}
        onClick={(event) => {
          if (backdropPointerRef.current && event.target === event.currentTarget) closeDrawer();
          backdropPointerRef.current = false;
        }}>
        <div className="mobile-navigation-panel">
          <div className="sidebar-toolbar">
            <h2 id="mobile-navigation-title" className="sidebar-heading">Esplora il sito</h2>
            <button type="button" className="navigation-button" ref={closeRef} aria-label="Chiudi menu di navigazione" onClick={closeDrawer}>
              <HugeiconsIcon icon={Cancel01Icon} size={22} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          {drawerOpen ? <NavigationLinks id="mobile-navigation-links" pathname={pathname} currentSearch={currentSearch} onNavigate={closeDrawer} /> : null}
        </div>
      </dialog>
    </>
  );
}

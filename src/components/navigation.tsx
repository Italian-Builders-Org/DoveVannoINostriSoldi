"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiBrain02Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  BuildingIcon,
  Cancel01Icon,
  ConstructionIcon,
  ContractsIcon,
  Database01Icon,
  Download04Icon,
  GitCompareArrowsIcon,
  GithubIcon,
  Home02Icon,
  Location01Icon,
  Menu04Icon,
  Money03Icon,
  Notification01Icon,
  Store01Icon,
} from "@hugeicons/core-free-icons";
import { HeaderSearch } from "@/components/header-search";
import {
  DASHBOARD_NAV,
  isNavChildActive,
  isNavSectionActive,
  type DashboardNavSection,
} from "@/lib/site-navigation";
import { isEventTargetWithin } from "@/lib/navigation-boundary";
import { REPO_URL } from "@/lib/site";

type NavigationContentProps = Readonly<{
  pathname: string;
  currentSearch: string | null;
}>;

const NAV_ICONS = {
  overview: Home02Icon,
  map: Location01Icon,
  spending: Money03Icon,
  institutions: BuildingIcon,
  business: Store01Icon,
  contracts: ContractsIcon,
  projects: ConstructionIcon,
  controls: Alert02Icon,
  comparison: GitCompareArrowsIcon,
  reports: Notification01Icon,
  data: Database01Icon,
  docs: BookOpen01Icon,
  assistant: AiBrain02Icon,
} as const;

function submenuId(href: string) {
  return `nav-menu-${href === "/" ? "overview" : href.slice(1).replaceAll("/", "-")}`;
}

export function Navigation() {
  const pathname = usePathname();
  const [currentSearch, setCurrentSearch] = useState<string | null>(null);
  return (
    <>
      <Suspense fallback={null}>
        <NavigationSearchSync onChange={setCurrentSearch} />
      </Suspense>
      <NavigationContent pathname={pathname} currentSearch={currentSearch} />
    </>
  );
}

function NavigationSearchSync({ onChange }: Readonly<{ onChange: (search: string) => void }>) {
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();

  useLayoutEffect(() => {
    onChange(currentSearch);
  }, [currentSearch, onChange]);

  return null;
}

function NavigationContent({ pathname, currentSearch }: NavigationContentProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<{
    href: string;
    pathname: string;
    search: string | null;
  } | null>(null);
  const openHref =
    openMenu?.pathname === pathname &&
    (openMenu.search === null || currentSearch === null || openMenu.search === currentSearch)
      ? openMenu.href
      : null;

  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const closeNavigation = useCallback(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, []);
  const openItem = useCallback(
    (href: string) => setOpenMenu({ href, pathname, search: currentSearch }),
    [currentSearch, pathname],
  );

  useEffect(() => {
    if (openHref === null && !mobileOpen) return;
    function dismissOutside(event: PointerEvent) {
      if (!isEventTargetWithin(navigationRef.current, event.target)) closeNavigation();
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Tab" && mobileOpen) {
        const focusable = [...(sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      const menuTrigger = openHref
        ? navigationRef.current?.querySelector<HTMLButtonElement>(`[aria-controls="${submenuId(openHref)}"]`)
        : null;
      const returnTarget = mobileOpen ? mobileToggleRef.current : menuTrigger;
      closeNavigation();
      window.requestAnimationFrame(() => returnTarget?.focus());
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [openHref, mobileOpen, closeNavigation]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => navigationRef.current?.querySelector<HTMLElement>("a")?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <button
            ref={mobileToggleRef}
            type="button"
            className="mobile-menu-toggle"
            aria-expanded={mobileOpen}
            aria-controls="dashboard-sidebar"
            aria-label={mobileOpen ? "Chiudi la navigazione" : "Apri la navigazione"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            <HugeiconsIcon
              icon={mobileOpen ? Cancel01Icon : Menu04Icon}
              size={20}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </button>

          <Link href="/" className="brand" aria-label="Dove vanno i nostri soldi, home">
            <Image
              className="brand-mark"
              src="/brand/dvns-lv-mark.svg"
              width={38}
              height={38}
              alt=""
              aria-hidden="true"
              priority
            />
            <span className="brand-text">
              <strong>DoveVannoINostriSoldi</strong>
              <small>Trasparenza. Dati pubblici. Futuro nostro.</small>
            </span>
          </Link>

          <HeaderSearch />

          <nav className="header-actions" aria-label="Azioni rapide">
            <Link className="header-action" href="/supporto">
              <HugeiconsIcon icon={Notification01Icon} size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>Segnalazioni</span>
            </Link>
            <Link className="header-action" href="/confronti">
              <HugeiconsIcon icon={GitCompareArrowsIcon} size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>Confronta</span>
            </Link>
            <Link className="header-action" href="/dati">
              <HugeiconsIcon icon={Download04Icon} size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>Esporta</span>
            </Link>
            <a
              className="header-action header-action-icon"
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Codice su GitHub, si apre in una nuova scheda"
              title="Codice su GitHub"
            >
              <HugeiconsIcon icon={GithubIcon} size={18} strokeWidth={1.7} aria-hidden="true" />
            </a>
          </nav>
        </div>
      </header>

      <aside
        ref={sidebarRef}
        id="dashboard-sidebar"
        className="dashboard-sidebar"
        data-mobile-open={mobileOpen ? "true" : undefined}
      >
        <nav
          className="primary-nav"
          aria-label="Navigazione principale"
          ref={navigationRef}
          onPointerLeave={(event) => {
            if (event.pointerType === "touch" || mobileOpen) return;
            if (isEventTargetWithin(navigationRef.current, event.relatedTarget)) return;
            closeMenu();
          }}
          onBlur={(event) => {
            if (isEventTargetWithin(navigationRef.current, event.relatedTarget)) return;
            closeMenu();
          }}
        >
          <ul className="primary-nav-list">
            {DASHBOARD_NAV.map((item) => (
              <NavigationItem
                key={item.href}
                item={item}
                pathname={pathname}
                currentSearch={currentSearch}
                open={openHref === item.href}
                onOpen={openItem}
                onClose={closeNavigation}
                setOpenMenu={setOpenMenu}
              />
            ))}
          </ul>
        </nav>

        <aside className="sidebar-mission" aria-label="Impegno del progetto">
          <strong>La trasparenza è il primo passo per il cambiamento.</strong>
          <p>I dati sono un bene comune.</p>
          <Link href="/metodologia" onClick={closeNavigation}>
            Scopri di più
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </aside>

        <div className="sidebar-meta">
          <strong>DoveVannoINostriSoldi</strong>
          <span>© 2026 Tutti i diritti riservati</span>
          <div>
            <Link href="/supporter">Chi siamo</Link>
            <Link href="/metodologia">Metodologia</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/supporto">Contatti</Link>
          </div>
        </div>
      </aside>
      <button
        type="button"
        className="sidebar-backdrop"
        data-visible={mobileOpen ? "true" : undefined}
        aria-label="Chiudi la navigazione"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={closeNavigation}
      />
    </>
  );
}

function NavigationItem({
  item,
  pathname,
  currentSearch,
  open,
  onOpen,
  onClose,
  setOpenMenu,
}: Readonly<{
  item: DashboardNavSection;
  pathname: string;
  currentSearch: string | null;
  open: boolean;
  onOpen: (href: string) => void;
  onClose: () => void;
  setOpenMenu: React.Dispatch<React.SetStateAction<{
    href: string;
    pathname: string;
    search: string | null;
  } | null>>;
}>) {
  const active = isNavSectionActive(pathname, item);
  const hasChildren = Boolean(item.children?.length);
  const menuId = submenuId(item.href);

  return (
    <li
      className={hasChildren ? "nav-item nav-item-has-menu" : "nav-item"}
      data-section-active={active ? "true" : undefined}
      data-open={open ? "true" : undefined}
      data-utility={item.utility ? "true" : undefined}
      data-utility-start={item.href === "/assistente" ? "true" : undefined}
      onFocusCapture={(event) => {
        if (hasChildren && !(event.target as HTMLElement).matches(".nav-item-toggle")) {
          onOpen(item.href);
        }
      }}
    >
      <Link
        href={item.href}
        aria-current={pathname === item.href && currentSearch === "" ? "page" : undefined}
        data-section-active={active ? "true" : undefined}
        onClick={onClose}
      >
        <HugeiconsIcon icon={NAV_ICONS[item.icon]} size={17} strokeWidth={1.7} aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
      {hasChildren && item.children ? (
        <>
          <button
            type="button"
            className="nav-item-toggle"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={`${open ? "Chiudi" : "Apri"} le pagine in ${item.label}`}
            onClick={() =>
              setOpenMenu(open ? null : { href: item.href, pathname, search: currentSearch })
            }
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <div className="nav-submenu" id={menuId} role="region" aria-label={`Pagine in ${item.label}`}>
            <strong className="nav-submenu-title">{item.label}<span>{item.children.length} pagine</span></strong>
            <ul>
              {item.children.map((child) => (
                <Fragment key={child.href}>
                  {child.group ? <li className="nav-submenu-group">{child.group}</li> : null}
                  <li>
                    <Link
                      href={child.href}
                      aria-current={
                        currentSearch !== null &&
                        isNavChildActive(pathname, child.href, item.children!, currentSearch)
                          ? "page"
                          : undefined
                      }
                      onClick={onClose}
                    >
                      {child.label}
                      <HugeiconsIcon icon={ArrowRight01Icon} size={13} strokeWidth={1.8} aria-hidden="true" />
                    </Link>
                  </li>
                </Fragment>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </li>
  );
}

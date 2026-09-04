"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { HeaderSearch } from "@/components/header-search";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  GithubIcon,
} from "@hugeicons/core-free-icons";
import {
  PRIMARY_NAV,
  isNavChildActive,
  isNavSectionActive,
} from "@/lib/site-navigation";
import { isEventTargetWithin } from "@/lib/navigation-boundary";
import { REPO_URL } from "@/lib/site";

type NavigationContentProps = Readonly<{
  pathname: string;
  currentSearch: string | null;
}>;

const FINE_POINTER_HOVER_QUERY = "(hover: hover) and (pointer: fine)";
/** Mouse on a viewport wide enough that swipe is not the primary way to pan. */
const MOUSE_NAV_SCROLL_CONTROLS_QUERY = `${FINE_POINTER_HOVER_QUERY} and (min-width: 901px)`;

function subscribeFinePointerHover(onChange: () => void) {
  const media = window.matchMedia(FINE_POINTER_HOVER_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function subscribeMouseNavScrollControls(onChange: () => void) {
  const media = window.matchMedia(MOUSE_NAV_SCROLL_CONTROLS_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useFinePointerHover() {
  return useSyncExternalStore(
    subscribeFinePointerHover,
    () => window.matchMedia(FINE_POINTER_HOVER_QUERY).matches,
    () => false,
  );
}

function useMouseNavScrollControls() {
  return useSyncExternalStore(
    subscribeMouseNavScrollControls,
    () => window.matchMedia(MOUSE_NAV_SCROLL_CONTROLS_QUERY).matches,
    () => false,
  );
}

function navMenuId(href: string) {
  return `nav-menu-${href.replace(/\W+/g, "-")}`;
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

function NavigationSearchSync({
  onChange,
}: Readonly<{ onChange: (search: string) => void }>) {
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();

  useLayoutEffect(() => {
    onChange(currentSearch);
  }, [currentSearch, onChange]);

  return null;
}

function NavigationContent({ pathname, currentSearch }: NavigationContentProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const navRowRef = useRef<HTMLDivElement>(null);
  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  const [navigationScroll, setNavigationScroll] = useState({
    backward: false,
    forward: false,
  });
  const [submenuLeft, setSubmenuLeft] = useState(0);
  const showScrollControls = useMouseNavScrollControls();
  const canHover = useFinePointerHover();
  /**
   * Exactly one submenu may be open. Hover, focus and the caret all write the
   * same state so CSS never opens a second panel through :hover/:focus-within
   * while another is still held open.
   *
   * The URL it was opened on travels with it: a completed navigation has
   * already answered the menu, so the open state simply stops applying rather
   * than being cleared from an effect after the new page has painted.
   */
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
  const liveSearch = useCallback(() => {
    if (typeof window === "undefined") return currentSearch;
    return window.location.search.replace(/^\?/, "");
  }, [currentSearch]);
  const openItem = useCallback(
    (href: string) => setOpenMenu({ href, pathname, search: liveSearch() }),
    [liveSearch, pathname],
  );
  const openSection = PRIMARY_NAV.find((item) => item.href === openHref && item.children?.length);

  const updateNavigationScroll = useCallback(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const maxScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth);
    const next = {
      backward: navigation.scrollLeft > 4,
      forward: navigation.scrollLeft < maxScrollLeft - 4,
    };
    setNavigationScroll((current) => (
      current.backward === next.backward && current.forward === next.forward ? current : next
    ));
  }, []);

  const scrollNavigation = useCallback((direction: "backward" | "forward") => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const maxScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth);
    const distance = Math.max(160, Math.round(navigation.clientWidth * 0.75));
    const nextScrollLeft = navigation.scrollLeft + (direction === "forward" ? distance : -distance);
    navigation.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
  }, []);

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    updateNavigationScroll();
    navigation.addEventListener("scroll", updateNavigationScroll, { passive: true });
    window.addEventListener("resize", updateNavigationScroll);
    const resizeObserver = new ResizeObserver(updateNavigationScroll);
    resizeObserver.observe(navigation);
    return () => {
      navigation.removeEventListener("scroll", updateNavigationScroll);
      window.removeEventListener("resize", updateNavigationScroll);
      resizeObserver.disconnect();
    };
  }, [updateNavigationScroll]);

  useEffect(() => {
    const navigation = navigationRef.current;
    const activeLink = activeLinkRef.current;
    if (!navigation || !activeLink) return;
    const navigationBox = navigation.getBoundingClientRect();
    const activeBox = activeLink.getBoundingClientRect();
    if (activeBox.left < navigationBox.left || activeBox.right > navigationBox.right) {
      activeLink.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [pathname]);

  useLayoutEffect(() => {
    if (!openHref) return;
    const item = navigationRef.current?.querySelector(".nav-item-has-menu[data-open='true']");
    const row = navRowRef.current;
    if (!item || !row) return;
    const itemBox = item.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    setSubmenuLeft(itemBox.left - rowBox.left);
  }, [openHref]);

  useEffect(() => {
    if (openHref === null) return;
    function dismissOutside(event: PointerEvent) {
      if (!isEventTargetWithin(navRowRef.current, event.target)) closeMenu();
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [openHref, closeMenu]);

  return (
    <>
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
            </span>
          </Link>

          <span className="header-spacer" />

          <HeaderSearch />

          <div className="header-actions">
            <Link className="header-action header-action-accent" href="/mcp">
              Istruzioni MCP
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

        <div
          className="shell nav-row"
          ref={navRowRef}
          data-menu-open={openHref ? "true" : undefined}
          onPointerLeave={(event) => {
            if (!canHover || event.pointerType === "touch") return;
            if (isEventTargetWithin(navRowRef.current, event.relatedTarget)) return;
            closeMenu();
          }}
          onBlur={(event) => {
            // Touch browsers blur/focus unpredictably around the caret; outside
            // pointerdown and Escape already own dismiss there.
            if (!canHover) return;
            if (isEventTargetWithin(navRowRef.current, event.relatedTarget)) return;
            closeMenu();
          }}
        >
          <nav
            className="primary-nav"
            aria-label="Navigazione principale"
            ref={navigationRef}
          >
            <ul className="primary-nav-list">
              {PRIMARY_NAV.map((item) => {
                const active = isNavSectionActive(pathname, item);
                const hasChildren = Boolean(item.children?.length);
                const menuId = navMenuId(item.href);
                const open = openHref === item.href;
                return (
                  <li
                    key={item.href}
                    className={hasChildren ? "nav-item nav-item-has-menu" : "nav-item"}
                    data-section-active={active ? "true" : undefined}
                    data-open={open ? "true" : undefined}
                    onPointerEnter={(event) => {
                      // Touch uses the caret; mouse/pen transfer the single open slot.
                      // Do not gate on matchMedia(hover): headless and some hybrids
                      // report hover:none even when pointer events are mouse-like.
                      if (event.pointerType === "touch") return;
                      if (hasChildren) openItem(item.href);
                      else closeMenu();
                    }}
                    onFocusCapture={(event) => {
                      if (!canHover) return;
                      if (
                        hasChildren &&
                        !(event.target as HTMLElement).matches(".nav-item-toggle")
                      ) {
                        openItem(item.href);
                      }
                    }}
                  >
                    <Link
                      href={item.href}
                      aria-current={
                        pathname === item.href && currentSearch === "" ? "page" : undefined
                      }
                      data-section-active={active ? "true" : undefined}
                      ref={active ? activeLinkRef : undefined}
                      onClick={closeMenu}
                    >
                      {item.label}
                    </Link>
                    {hasChildren ? (
                      <button
                        type="button"
                        className="nav-item-toggle"
                        aria-expanded={open}
                        aria-controls={menuId}
                        aria-label={`${open ? "Chiudi" : "Apri"} le pagine in ${item.label}`}
                        onClick={() =>
                          setOpenMenu(
                            open
                              ? null
                              : { href: item.href, pathname, search: liveSearch() },
                          )
                        }
                      >
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          size={15}
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </nav>
          {openSection?.children ? (
            <div
              className="nav-submenu"
              id={navMenuId(openSection.href)}
              role="region"
              aria-label={`Pagine in ${openSection.label}`}
              style={{ ["--nav-submenu-left" as string]: `${submenuLeft}px` }}
            >
              <ul>
                {openSection.children.map((child) => (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      aria-current={
                        currentSearch !== null &&
                        isNavChildActive(
                          pathname,
                          child.href,
                          openSection.children!,
                          currentSearch,
                        )
                          ? "page"
                          : undefined
                      }
                      onClick={closeMenu}
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {showScrollControls && navigationScroll.backward ? (
            <button
              type="button"
              className="nav-scroll-control nav-scroll-control-backward"
              aria-label="Scorri la navigazione verso sinistra"
              onClick={() => scrollNavigation("backward")}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.8} aria-hidden="true" />
              <span aria-hidden="true">Indietro</span>
            </button>
          ) : null}
          {showScrollControls && navigationScroll.forward ? (
            <button
              type="button"
              className="nav-scroll-control nav-scroll-control-forward"
              aria-label="Scorri la navigazione verso destra"
              onClick={() => scrollNavigation("forward")}
            >
              <span aria-hidden="true">Scorri</span>
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      {openHref ? (
        <button
          type="button"
          className="nav-menu-dismiss"
          aria-label="Chiudi il menu"
          onClick={closeMenu}
        />
      ) : null}
    </>
  );
}

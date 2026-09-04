"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import type { GovernmentScorecardV6ContextSlide } from "@/lib/government-scorecard-page";

import styles from "../government-scorecard.module.css";

type MandatePeriod = { startDate: string; endDate: string };

const MANDATE_RELATION_LABELS = {
  inherited: "ereditato",
  during: "durante il mandato",
  cross_government: "attraversa più governi",
} as const;

function channelLabel(value: string | null): string {
  if (!value) return "non disponibile";
  const labels: Record<string, string> = {
    documented_external_or_financial_shock: "prezzi, credito, commercio o produzione",
    documented_government_measure: "bilancio, imposte, spesa o incentivi",
    documented_government_measures: "bilancio, imposte, spesa o incentivi",
    energy_trade_fiscal_support_and_geopolitics: "energia, commercio, bilancio pubblico e geopolitica",
    trade_exports_investment_and_uncertainty: "commercio, export e investimenti",
    oil_supply_fuel_prices_inflation_and_growth: "carburanti, energia e inflazione",
    common_monetary_policy: "tassi, credito e costo del debito",
    inherited_public_debt_per_capita: "debito pubblico di partenza",
    institutional_timeline: "perimetro istituzionale del periodo",
    mandate_overview: "lettura del periodo istituzionale",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function ContextCard({
  slide,
  position,
  total,
}: {
  slide: GovernmentScorecardV6ContextSlide;
  position: number;
  total: number;
}) {
  return (
    <article className={styles.contextCard} data-active="true" data-slide-id={slide.id}>
      <header className={styles.contextCardHeader}>
        <div>
          <span className={styles.contextPosition}>{position} / {total}</span>
          <h3>{slide.title}</h3>
        </div>
        <span className={styles.contextBadge}>{slide.badge}</span>
      </header>

      {slide.summary.map((sentence) => <p key={sentence}>{sentence}</p>)}

      {slide.status === "empty" ? (
        <div className={styles.contextEmpty} role="status">
          <strong>Nessun elemento documentato per questa sezione</strong>
          <span>{slide.message}</span>
        </div>
      ) : null}

      {slide.items.length > 0 ? (
        <ul className={styles.contextItems} aria-label="Eventi inclusi">
          {slide.items.map((item, itemIndex) => (
            <li key={item.id}>
              <article tabIndex={0}>
                <div className={styles.contextItemHeading}>
                  <span className={styles.contextItemNumber} aria-hidden="true">
                    {String(itemIndex + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <span className={styles.contextItemPeriod}>{item.period}</span>
                    <h4>{item.title}</h4>
                  </div>
                </div>
                <p>{item.summary}</p>
                <dl>
                  <div><dt>Possibile canale economico</dt><dd>{channelLabel(item.economic_channel)}</dd></div>
                  <div><dt>Rapporto col mandato</dt><dd>{MANDATE_RELATION_LABELS[item.mandate_relation]}</dd></div>
                </dl>
                <div className={styles.contextSources}>
                  {item.sources.map((source) => (
                    <a
                      href={source.url}
                      key={source.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Apri la fonte ${source.owner} in una nuova scheda`}
                    >
                      Fonte: {source.owner} ↗
                    </a>
                  ))}
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className={styles.contextCardFooter}>
        <span>Criterio applicato allo stesso modo a tutti i governi: {slide.selection_rule}</span>
      </footer>
    </article>
  );
}

export function ContextCarousel({
  slides,
  mandate,
}: {
  slides: readonly GovernmentScorecardV6ContextSlide[];
  mandate: MandatePeriod;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const headingId = useId();
  const tabId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const total = slides.length;
  const activeSlide = slides[activeIndex];

  if (!activeSlide) return null;

  const activate = (index: number) => {
    const nextIndex = (index + total) % total;
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activate(index - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      activate(index + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      activate(0);
    } else if (event.key === "End") {
      event.preventDefault();
      activate(total - 1);
    }
  };

  return (
    <section className={styles.contextLayout} aria-labelledby={headingId}>
      <div className={styles.contextHeading}>
        <div>
          <span className={styles.sectionEyebrow}>Lettura documentata</span>
          <h2 id={headingId}>Cosa è successo</h2>
        </div>
        <p className={styles.contextDeck}>
          Eventi e decisioni documentati, separati dai dati usati per calcolare il voto.
        </p>
      </div>

      <div className={styles.contextNavigation}>
        <p className={styles.timelineNote}>Mandato: {mandate.startDate} → {mandate.endDate}</p>
        <div className={styles.contextTabList} role="tablist" aria-orientation="vertical" aria-label="Sezioni di contesto">
          {slides.map((slide, index) => {
            const selected = index === activeIndex;
            const panelId = `${tabId}-panel-${slide.id}`;
            const currentTabId = `${tabId}-tab-${slide.id}`;
            return (
              <button
                key={slide.id}
                ref={(element) => { tabRefs.current[index] = element; }}
                id={currentTabId}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-current={selected ? "page" : undefined}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                className={styles.contextTab}
                onClick={() => setActiveIndex(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{slide.label}</strong>
                <small>{slide.title}</small>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.contextPanels}>
        {slides.map((slide, index) => {
          const selected = index === activeIndex;
          const panelId = `${tabId}-panel-${slide.id}`;
          const currentTabId = `${tabId}-tab-${slide.id}`;
          return (
            <section
              key={slide.id}
              id={panelId}
              role="tabpanel"
              aria-labelledby={currentTabId}
              hidden={!selected}
              tabIndex={0}
              className={styles.contextPanel}
            >
              <ContextCard slide={slide} position={index + 1} total={total} />
            </section>
          );
        })}
      </div>
    </section>
  );
}

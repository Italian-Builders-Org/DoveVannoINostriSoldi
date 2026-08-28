"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { TreemapNode } from "recharts";
import { institutionalCategoryColor } from "@/lib/chart-category-colors";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "./simulatore.module.css";

const SHARE_HOST = new URL(PUBLIC_SITE_URL).host.replace(/^www\./, "");

const compactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const percentage = new Intl.NumberFormat("it-IT", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const integerFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

function signedPercent(value: number | null): string {
  if (value === null) return "n/d";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function signedCompactEuro(value: number): string {
  return `${value >= 0 ? "+" : "−"}${compactEuro.format(Math.abs(value))}`;
}

/** Miliardi con separatore di migliaia: leggibile per i grandi totali. */
function billionsEuro(value: number): string {
  return `${integerFmt.format(value / 1_000_000_000)} Mld €`;
}

/**
 * Missioni che restano fuori dal treemap perché sotto questa quota dello
 * stanziamento dell'ultimo anno diventerebbero riquadri di pochi pixel: le
 * serviamo come striscia di chip di pari dimensione, tutte selezionabili.
 * La ripartizione fra treemap ed elenco resta ancorata al dato osservato,
 * così un riquadro non salta nell'elenco quando lo ridimensioni.
 */
const MAJOR_SHARE_THRESHOLD = 0.007;

/** Etichette brevi per la tassonomia RGS delle missioni (nomi stabili dal 2017). */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  "Agricoltura, politiche agroalimentari e pesca": "Agricoltura e pesca",
  "Amministrazione generale e supporto alla rappresentanza generale di Governo e dello Stato sul territorio":
    "Amministrazione generale",
  "Casa e assetto urbanistico": "Casa e urbanistica",
  "Commercio internazionale ed internazionalizzazione del sistema produttivo": "Commercio internazionale",
  "Competitivita' e sviluppo delle imprese": "Sviluppo delle imprese",
  "Comunicazioni": "Comunicazioni",
  "Debito pubblico": "Debito pubblico",
  "Difesa e sicurezza del territorio": "Difesa",
  "Diritti sociali, politiche sociali e famiglia": "Diritti sociali e famiglia",
  "Diritto alla mobilita' e sviluppo dei sistemi di trasporto": "Mobilità e trasporti",
  "Energia e diversificazione delle fonti energetiche": "Energia",
  "Fondi da ripartire": "Fondi da ripartire",
  "Giovani e sport": "Giovani e sport",
  "Giustizia": "Giustizia",
  "Immigrazione, accoglienza e garanzia dei diritti": "Immigrazione e accoglienza",
  "Infrastrutture pubbliche e logistica": "Infrastrutture e logistica",
  "Istruzione scolastica": "Istruzione scolastica",
  "Istruzione universitaria e formazione post-universitaria": "Università e ricerca",
  "L'Italia in Europa e nel mondo": "Italia in Europa e nel mondo",
  "Ordine pubblico e sicurezza": "Ordine pubblico e sicurezza",
  "Organi costituzionali, a rilevanza costituzionale e Presidenza del Consiglio dei ministri":
    "Organi costituzionali e PCM",
  "Politiche economico-finanziarie e di bilancio e tutela della finanza pubblica":
    "Politiche economiche e bilancio",
  "Politiche per il lavoro": "Lavoro",
  "Politiche previdenziali": "Previdenza",
  "Regolazione dei mercati": "Regolazione dei mercati",
  "Relazioni finanziarie con le autonomie territoriali": "Finanza delle autonomie",
  "Ricerca e innovazione": "Ricerca e innovazione",
  "Servizi istituzionali e generali delle amministrazioni pubbliche": "Servizi istituzionali PA",
  "Soccorso civile": "Soccorso civile",
  "Sviluppo e riequilibrio territoriale": "Sviluppo territoriale",
  "Sviluppo sostenibile e tutela del territorio e dell'ambiente": "Ambiente e territorio",
  "Turismo": "Turismo",
  "Tutela della salute": "Salute",
  "Tutela e valorizzazione dei beni e attivita' culturali e paesaggistici": "Cultura e paesaggio",
};

function shortLabel(mission: string): string {
  return SHORT_LABELS[mission] ?? mission;
}

function scenarioPctOf(map: Record<string, number>, mission: string): number {
  return map[mission] ?? 0;
}

/** Verde quando la voce cresce, rosso quando cala, neutro se invariata. */
function toneColor(value: number): string {
  if (value > 0) return "var(--color-positive)";
  if (value < 0) return "var(--color-critical)";
  return "var(--color-neutral-500)";
}

function effectiveAmount(item: MissionSummary, map: Record<string, number>): number {
  return item.latestAmountEur * (1 + scenarioPctOf(map, item.mission) / 100);
}

export type MissionSummary = {
  mission: string;
  latestAmountEur: number;
  realDeltaPct: number | null;
};

type MissionNode = TreemapNode & {
  mission?: string;
  shortLabel?: string;
  /** Importo che dimensiona il riquadro: ipotetico se la missione è stata toccata. */
  sizeEur?: number;
  observedEur?: number;
  effectiveEur?: number;
  scenarioPct?: number;
  share?: number;
  deltaPct?: number | null;
};

export function MissionPicker({
  summaries,
  selectedMission,
  onSelect,
  onClearMission,
  onClearAll,
  latestYear,
  scenarioByMission,
}: {
  summaries: MissionSummary[];
  selectedMission: string;
  onSelect: (mission: string) => void;
  onClearMission: (mission: string) => void;
  onClearAll: () => void;
  latestYear: number;
  /** Variazione ipotetica (punti percentuali) per missione toccata. */
  scenarioByMission: Record<string, number>;
}) {
  const hatchId = useId();
  const shareDialogRef = useRef<HTMLDialogElement>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  const plan = useMemo(() => {
    const observedTotal = summaries.reduce((acc, item) => acc + item.latestAmountEur, 0);
    const effectiveTotal = summaries.reduce(
      (acc, item) => acc + effectiveAmount(item, scenarioByMission),
      0,
    );
    const entries = summaries
      .filter((item) => scenarioPctOf(scenarioByMission, item.mission) !== 0 && item.latestAmountEur > 0)
      .map((item) => {
        const observed = item.latestAmountEur;
        const effective = effectiveAmount(item, scenarioByMission);
        return {
          mission: item.mission,
          pct: scenarioPctOf(scenarioByMission, item.mission),
          realDeltaPct: item.realDeltaPct,
          observed,
          effective,
          diff: effective - observed,
        };
      })
      .sort((left, right) => Math.abs(right.diff) - Math.abs(left.diff));

    const increases = entries.filter((entry) => entry.diff > 0);
    const cuts = entries.filter((entry) => entry.diff < 0);
    const increasesTotal = increases.reduce((acc, entry) => acc + entry.diff, 0);
    const cutsTotal = cuts.reduce((acc, entry) => acc + entry.diff, 0); // ≤ 0
    const net = effectiveTotal - observedTotal;

    return {
      observedTotal,
      effectiveTotal,
      entries,
      net,
      netPct: observedTotal > 0 ? (net / observedTotal) * 100 : 0,
      increasesTotal,
      cutsTotal,
      increasesCount: increases.length,
      cutsCount: cuts.length,
    };
  }, [summaries, scenarioByMission]);

  const hasScenario = plan.entries.length > 0;

  const SHARE_HASHTAG = "#lamialeggedibilancio";
  const shareText = `E se la prossima Legge di Bilancio la scrivessi tu? Ecco la mia proposta: saldo netto ${signedCompactEuro(
    plan.net,
  )} su ${plan.entries.length} ${plan.entries.length === 1 ? "missione" : "missioni"}. Fatta con Dove Vanno I Nostri Soldi, ora prova a scrivere la tua:`;
  // Messaggio completo: testo, poi il link, poi l'hashtag a capo.
  const shareMessage = `${shareText}\n${shareUrl}\n\n${SHARE_HASHTAG}`;

  function openShare() {
    setShareUrl(window.location.href);
    setLinkCopied(false);
    shareDialogRef.current?.showModal();
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareMessage);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard non disponibile: resta lo screenshot del riquadro */
    }
  }

  // Solo le piattaforme che accettano un testo personalizzato: Facebook e
  // LinkedIn ignorano ogni parametro di testo e mostrano solo l'anteprima del link.
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedMessage = encodeURIComponent(shareMessage);
  const socialLinks = [
    // testo tutto nel parametro `text`, senza `url`, così l'hashtag resta in fondo
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encodedMessage}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodedMessage}` },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(
        `${shareText}\n\n${SHARE_HASHTAG}`,
      )}`,
    },
  ];

  const { treemapData, minor } = useMemo(() => {
    const observedTotal = summaries.reduce((acc, item) => acc + item.latestAmountEur, 0);
    const effectiveTotal = summaries.reduce(
      (acc, item) => acc + effectiveAmount(item, scenarioByMission),
      0,
    );
    const ranked = [...summaries].sort((left, right) => right.latestAmountEur - left.latestAmountEur);
    const major: MissionSummary[] = [];
    const rest: MissionSummary[] = [];
    for (const item of ranked) {
      const observedShare = observedTotal > 0 ? item.latestAmountEur / observedTotal : 0;
      if (item.latestAmountEur > 0 && observedShare >= MAJOR_SHARE_THRESHOLD) {
        major.push(item);
      } else {
        rest.push(item);
      }
    }
    return {
      minor: rest,
      treemapData: major.map((item) => {
        const observed = item.latestAmountEur;
        const effective = effectiveAmount(item, scenarioByMission);
        return {
          name: item.mission,
          mission: item.mission,
          shortLabel: shortLabel(item.mission),
          sizeEur: Math.max(effective, 1),
          observedEur: observed,
          effectiveEur: effective,
          scenarioPct: scenarioPctOf(scenarioByMission, item.mission),
          share: effectiveTotal > 0 ? effective / effectiveTotal : 0,
          deltaPct: item.realDeltaPct,
        };
      }),
    };
  }, [summaries, scenarioByMission]);

  const renderTile = (props: unknown) => {
    const node = props as MissionNode;
    const width = node.width ?? 0;
    const height = node.height ?? 0;
    const mission = node.mission ?? node.name ?? "";
    // Recharts calls `content` anche per il nodo radice che avvolge l'intera area.
    if (!mission || node.depth === 0 || width <= 0 || height <= 0) return <g />;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const selected = mission === selectedMission;
    const showLabel = width >= 46 && height >= 24;
    const showMeta = width >= 74 && height >= 46;
    const select = () => onSelect(mission);

    const pct = node.scenarioPct ?? 0;
    const adjusted = pct !== 0;
    const tone = toneColor(pct);
    const hatchRef = pct >= 0 ? `url(#${hatchId}-up)` : `url(#${hatchId}-down)`;
    const observed = node.observedEur ?? 0;
    const effective = node.effectiveEur ?? observed;

    // Barra di confronto "oggi vs ipotesi" in fondo al riquadro, su scala
    // condivisa: dice di quanto la tua ipotesi allunga o accorcia la voce.
    const showGauge = adjusted && width >= 132 && height >= 104;
    const gaugeX = x + 12;
    const gaugeW = width - 24;
    const gaugeY = y + height - 26;
    const gaugeMax = Math.max(observed, effective, 1);
    const observedW = gaugeW * (observed / gaugeMax);
    const effectiveW = gaugeW * (effective / gaugeMax);

    // Le voci toccate mostrano il bordo nel colore del verso (verde su, rosso giù);
    // la selezione resta leggibile dallo spessore maggiore e dal velo a righe.
    const stroke = adjusted
      ? tone
      : selected
        ? "var(--color-accent-600)"
        : "var(--color-raised)";

    return (
      <g
        className={styles.tile}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${node.shortLabel ?? mission}: ${
          adjusted
            ? `ipotesi ${exactEuro.format(effective)} (${signedPercent(pct)} sullo stanziamento ${latestYear} di ${exactEuro.format(observed)})`
            : `stanziamento ${latestYear} ${exactEuro.format(observed)}, variazione reale ${signedPercent(node.deltaPct ?? null)}`
        }`}
        onClick={select}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select();
          }
        }}
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={institutionalCategoryColor(node.index ?? 0)}
          stroke={stroke}
          strokeWidth={selected ? 4 : adjusted ? 3 : 2}
          strokeDasharray={adjusted && !selected ? "5 3" : undefined}
        />
        {adjusted ? (
          <>
            <defs>
              <pattern
                id={`${hatchId}-up`}
                patternUnits="userSpaceOnUse"
                width="6"
                height="6"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="var(--color-positive-bg)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-positive)" strokeWidth="2" />
              </pattern>
              <pattern
                id={`${hatchId}-down`}
                patternUnits="userSpaceOnUse"
                width="6"
                height="6"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="var(--color-critical-bg)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-critical)" strokeWidth="2" />
              </pattern>
            </defs>
            {/* velo a righe: marca il riquadro come ipotesi, non dato pubblicato */}
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={hatchRef}
              fillOpacity={0.2}
              pointerEvents="none"
            />
          </>
        ) : null}
        {showGauge ? (
          <>
            <rect x={gaugeX} y={gaugeY} width={gaugeW} height={10} fill="var(--color-raised)" fillOpacity={0.26} />
            <rect x={gaugeX} y={gaugeY} width={observedW} height={10} fill="var(--color-raised)" fillOpacity={0.5} />
            <rect
              x={gaugeX}
              y={gaugeY}
              width={effectiveW}
              height={10}
              fill={hatchRef}
              stroke={tone}
              strokeWidth={1.5}
            />
            <line
              x1={gaugeX + observedW}
              x2={gaugeX + observedW}
              y1={gaugeY - 3}
              y2={gaugeY + 13}
              stroke="var(--color-raised)"
              strokeWidth={2}
            />
            <text x={gaugeX} y={gaugeY - 6} className={styles.gaugeCaption}>
              oggi {compactEuro.format(observed)} · ipotesi {compactEuro.format(effective)}
            </text>
          </>
        ) : null}
        {showLabel ? (
          <foreignObject x={x} y={y} width={width} height={height} className={styles.tileFo}>
            <div className={styles.tileBox}>
              <span className={styles.tileLabel}>{node.shortLabel}</span>
              {showMeta ? (
                <span className={styles.tileMeta}>
                  {adjusted
                    ? `${compactEuro.format(observed)} → ${compactEuro.format(effective)}`
                    : `${compactEuro.format(observed)} · ${signedPercent(node.deltaPct ?? null)}`}
                </span>
              ) : null}
              {adjusted && showMeta ? (
                <span
                  className={styles.tileScenarioTag}
                  style={{
                    color: tone,
                    borderColor: tone,
                    background: pct > 0 ? "var(--color-positive-bg)" : "var(--color-critical-bg)",
                  }}
                >
                  ipotesi {signedPercent(pct)}
                </span>
              ) : null}
            </div>
          </foreignObject>
        ) : null}
      </g>
    );
  };

  return (
    <div className={styles.picker}>
      <p className={styles.pickerHeader}>Scegli una missione</p>

      {hasScenario ? (
        <div className={styles.plan}>
          <div className={styles.planHead}>
            <span>
              <span className={styles.scenarioSwatch} aria-hidden="true" /> Il tuo piano di
              riallocazione ({plan.entries.length}{" "}
              {plan.entries.length === 1 ? "missione" : "missioni"})
            </span>
            <div className={styles.planHeadActions}>
              <button type="button" className="btn btn-secondary" onClick={onClearAll}>
                Torna al dato pubblicato
              </button>
              <button type="button" className="btn btn-primary" onClick={openShare}>
                Condividi la tua finanziaria
              </button>
            </div>
          </div>
          <ul className={styles.planList}>
            {plan.entries.map((entry) => (
              <li key={entry.mission}>
                <button
                  type="button"
                  className={styles.planJump}
                  onClick={() => onSelect(entry.mission)}
                >
                  {shortLabel(entry.mission)}
                </button>
                <span className={styles.planNums}>
                  <b style={{ color: toneColor(entry.pct) }}>{signedPercent(entry.pct)}</b> ipotesi
                  {entry.realDeltaPct !== null ? ` · ${signedPercent(entry.realDeltaPct)} reale` : ""}
                  {" · "}
                  {compactEuro.format(entry.observed)} → {compactEuro.format(entry.effective)}
                </span>
                <button
                  type="button"
                  className={styles.planRemove}
                  aria-label={`Rimuovi l'ipotesi su ${entry.mission}`}
                  onClick={() => onClearMission(entry.mission)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {(() => {
            const scale = Math.max(plan.increasesTotal, Math.abs(plan.cutsTotal), 1);
            const netAbsShare =
              plan.observedTotal > 0 ? Math.abs(plan.net) / plan.observedTotal : 0;
            let verdict: string;
            if (plan.increasesCount > 0 && plan.cutsCount > 0 && netAbsShare < 0.0025) {
              verdict = "aumenti e tagli quasi si compensano";
            } else if (plan.net > 0) {
              verdict = "in più, da trovare come copertura";
            } else if (plan.net < 0) {
              verdict = "in meno: risorse liberate";
            } else {
              verdict = "nessuno scostamento";
            }
            return (
              <div className={styles.saldoWrap}>
                <p className={styles.saldoTitle}>Come cambia la Legge di Bilancio {latestYear}</p>
                <div className={styles.saldo}>
                  <div className={styles.saldoBars}>
                    <div className={styles.saldoRow}>
                      <span className={styles.saldoName}>Aumenti</span>
                      <span
                        className={styles.saldoValue}
                        style={
                          plan.increasesCount > 0 ? { color: "var(--color-positive)" } : undefined
                        }
                      >
                        {plan.increasesCount > 0 ? signedCompactEuro(plan.increasesTotal) : "0"}
                      </span>
                      <span className={styles.saldoTrack}>
                        {plan.increasesCount > 0 ? (
                          <i
                            className={styles.saldoBarUp}
                            style={{ inlineSize: `${(plan.increasesTotal / scale) * 100}%` }}
                          />
                        ) : null}
                      </span>
                      <span className={styles.saldoCount}>
                        {plan.increasesCount} {plan.increasesCount === 1 ? "voce" : "voci"}
                      </span>
                    </div>
                    <div className={styles.saldoRow}>
                      <span className={styles.saldoName}>Tagli</span>
                      <span
                        className={styles.saldoValue}
                        style={plan.cutsCount > 0 ? { color: "var(--color-critical)" } : undefined}
                      >
                        {plan.cutsCount > 0 ? signedCompactEuro(plan.cutsTotal) : "0"}
                      </span>
                      <span className={styles.saldoTrack}>
                        {plan.cutsCount > 0 ? (
                          <i
                            className={styles.saldoBarDown}
                            style={{ inlineSize: `${(Math.abs(plan.cutsTotal) / scale) * 100}%` }}
                          />
                        ) : null}
                      </span>
                      <span className={styles.saldoCount}>
                        {plan.cutsCount} {plan.cutsCount === 1 ? "voce" : "voci"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.saldoNet} style={{ borderColor: toneColor(plan.net) }}>
                    <span className={styles.saldoNetLabel}>Saldo netto</span>
                    <span className={styles.saldoNetValue} style={{ color: toneColor(plan.net) }}>
                      {signedCompactEuro(plan.net)}
                    </span>
                    <span className={styles.saldoNetSub}>
                      {verdict} · {signedPercent(plan.netPct)} sul totale
                    </span>
                    <span className={styles.saldoNetSub}>
                      Bilancio <b>{billionsEuro(plan.observedTotal)}</b> →{" "}
                      <b>{billionsEuro(plan.effectiveTotal)}</b>
                    </span>
                  </div>
                </div>
                <p className={styles.planNet}>
                  Somma delle {summaries.length} missioni confrontabili (campo RGS «Legge di Bilancio
                  CP A1»), non l&apos;intera manovra; numeri tuoi, non un dato pubblicato.
                </p>
              </div>
            );
          })()}

          <dialog
            ref={shareDialogRef}
            className={styles.shareDialog}
            onClick={(event) => {
              if (event.target === shareDialogRef.current) shareDialogRef.current?.close();
            }}
          >
            <div className={styles.shareDialogInner}>
              <button
                type="button"
                className={styles.shareClose}
                aria-label="Chiudi"
                onClick={() => shareDialogRef.current?.close()}
              >
                ×
              </button>

              <figure
                className={styles.shareCard}
                style={{ borderTopColor: toneColor(plan.net) }}
              >
                <figcaption className={styles.shareKicker}>
                  La mia proposta per la prossima Legge di Bilancio
                </figcaption>
                <p className={styles.shareNet} style={{ color: toneColor(plan.net) }}>
                  {signedCompactEuro(plan.net)}
                </p>
                <p className={styles.shareLead}>
                  saldo netto · {plan.entries.length}{" "}
                  {plan.entries.length === 1 ? "missione" : "missioni"} ·{" "}
                  {signedPercent(plan.netPct)} sul totale
                </p>
                <ul className={styles.shareList}>
                  {plan.entries.slice(0, 4).map((entry) => (
                    <li key={entry.mission}>
                      <span>{shortLabel(entry.mission)}</span>
                      <b style={{ color: toneColor(entry.pct) }}>{signedPercent(entry.pct)}</b>
                    </li>
                  ))}
                  {plan.entries.length > 4 ? (
                    <li className={styles.shareMore}>
                      <span>+{plan.entries.length - 4} altre missioni</span>
                    </li>
                  ) : null}
                </ul>
                <p className={styles.shareCta}>
                  Crea la tua finanziaria · {SHARE_HOST}/spese/legge-di-bilancio
                </p>
              </figure>

              <div className={styles.shareLinks}>
                {socialLinks.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {social.label}
                  </a>
                ))}
                <button type="button" onClick={copyShareLink}>
                  {linkCopied ? "Copiato ✓" : "Copia link"}
                </button>
              </div>

              <small className={styles.shareHint}>
                Oppure fai uno screenshot di questo riquadro e postalo.
              </small>
            </div>
          </dialog>
        </div>
      ) : null}

      {hasScenario ? (
        <p className={styles.treemapBadge}>
          I riquadri qui sotto sono dimensionati sulla <b>tua ipotesi di riallocazione</b>, non sullo
          stanziamento pubblicato {latestYear}. Le voci toccate sono a righe e con bordo tratteggiato.
        </p>
      ) : null}

      <div
        className={`${styles.treemap} ${hasScenario ? styles.treemapScenario : ""}`}
        style={hasScenario ? { borderColor: toneColor(plan.net) } : undefined}
        role="group"
        aria-label={
          hasScenario
            ? `Missioni dimensionate sulla tua ipotesi di riallocazione. ${plan.entries.length} voci modificate.`
            : `Scegli una missione. I riquadri sono dimensionati sullo stanziamento pubblicato ${latestYear}; le missioni più piccole sono nell'elenco sotto il grafico.`
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treemapData}
            dataKey="sizeEur"
            nameKey="name"
            nodeGap={2}
            content={renderTile}
            isAnimationActive={false}
          >
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as MissionNode | undefined;
                if (!active || !point) return null;
                const adjusted = (point.scenarioPct ?? 0) !== 0;
                return (
                  <div className={styles.tooltip}>
                    <span>{point.mission}</span>
                    <strong>{exactEuro.format(point.observedEur ?? 0)}</strong>
                    {adjusted ? (
                      <b>
                        ipotesi {exactEuro.format(point.effectiveEur ?? 0)} ({signedPercent(point.scenarioPct ?? 0)})
                        · {percentage.format(point.share ?? 0)} del totale ipotetico
                      </b>
                    ) : (
                      <b>
                        {percentage.format(point.share ?? 0)} del totale · variazione reale{" "}
                        {signedPercent(point.deltaPct ?? null)}
                      </b>
                    )}
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>

      {minor.length > 0 ? (
        <div className={styles.minorStrip} role="group" aria-label="Missioni minori">
          <p className={styles.minorLabel}>
            Missioni minori (sotto lo {percentage.format(MAJOR_SHARE_THRESHOLD)} del totale {latestYear})
          </p>
          {minor.map((item) => {
            const selected = item.mission === selectedMission;
            const pct = scenarioPctOf(scenarioByMission, item.mission);
            const adjusted = pct !== 0;
            const effective = effectiveAmount(item, scenarioByMission);
            return (
              <button
                key={item.mission}
                type="button"
                className={`${styles.minorChip} ${selected ? styles.minorChipActive : ""} ${
                  adjusted ? styles.minorChipAdjusted : ""
                }`}
                style={adjusted && !selected ? { borderColor: toneColor(pct) } : undefined}
                aria-pressed={selected}
                onClick={() => onSelect(item.mission)}
              >
                <span>{shortLabel(item.mission)}</span>
                <small style={adjusted ? { color: toneColor(pct) } : undefined}>
                  {adjusted
                    ? `${compactEuro.format(item.latestAmountEur)} → ${compactEuro.format(effective)} (${signedPercent(pct)})`
                    : `${item.latestAmountEur > 0 ? compactEuro.format(item.latestAmountEur) : "≈ 0"} · ${signedPercent(item.realDeltaPct)}`}
                </small>
              </button>
            );
          })}
        </div>
      ) : null}

      <p className={styles.pickerCaption}>
        {hasScenario
          ? `Il treemap è dimensionato sulla tua ipotesi. «Torna al dato pubblicato» rimette tutto sullo stanziamento reale ${latestYear}.`
          : "Scegli un riquadro, poi usa lo slider qui sotto per costruire lo scenario."}
      </p>
    </div>
  );
}

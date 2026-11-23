import { GOVERNMENT_SCORECARD_V6_CHRONOLOGY } from "@/lib/government-scorecard-chronology";
import type { GovernmentScorecardChartEvent } from "@/lib/government-scorecard-events";
import {
  getGovernmentScorecardV6View,
} from "@/lib/government-scorecard-governments";
import type { GovernmentScorecardV6ChartSlide } from "@/lib/government-scorecard-page";
import {
  getGovernmentChartSelection,
  isGovernmentChartPointInWindow,
} from "@/app/governi/_components/chart-utils";

/**
 * Questions that recur in the political debate, answered only with the series
 * already published on the government pages. Every number is the same one a
 * reader finds on `/governi/<id>` in the "Mandato" view: first and last
 * published period inside the mandate, with the same-quarter baseline for
 * quarterly series. Nothing here scores, ranks or attributes causes.
 */
export const GOVERNMENT_DEBATE_QUESTIONS = [
  {
    id: "debito",
    indicator_id: "debt_ratio",
    question: "Il debito pubblico è salito con tutti i governi?",
    measures: "Debito delle amministrazioni pubbliche in rapporto al PIL, all'inizio e alla fine di ogni mandato.",
    how_to_read: "Il rapporto sale anche quando il PIL scende, come nel 2009 e nel 2020. La serie trimestrale parte dal 2000.",
  },
  {
    id: "disoccupazione",
    indicator_id: "unemployment",
    question: "La disoccupazione è scesa o salita durante ogni governo?",
    measures: "Disoccupati sulla popolazione attiva, primo e ultimo mese pubblicati del mandato.",
    how_to_read: "Il mercato del lavoro reagisce con ritardo: una parte della variazione può dipendere da scelte e shock precedenti.",
  },
  {
    id: "inflazione",
    indicator_id: "inflation",
    question: "L'inflazione alta è stata solo un problema italiano?",
    measures: "Inflazione armonizzata annua in Italia, con la variazione negli stessi mesi in Francia, Germania e Spagna.",
    how_to_read: "Prezzi dell'energia e politica monetaria sono comuni all'area euro: il confronto con gli altri tre paesi mostra quanto il movimento sia stato condiviso.",
  },
  {
    id: "stipendi",
    indicator_id: "real_compensation",
    question: "Gli stipendi reali sono cresciuti?",
    measures: "Retribuzione reale per dipendente (indice 2020=100), primo e ultimo anno pubblicati del mandato.",
    how_to_read: "È una media per dipendente al netto dei prezzi: non dice come cambia la distribuzione tra lavoratori.",
  },
  {
    id: "crescita",
    indicator_id: "real_gdp_per_capita",
    question: "L'economia è cresciuta durante ogni governo?",
    measures: "PIL reale per abitante (indice 2020=100, non destagionalizzato), confrontato sullo stesso trimestre.",
    how_to_read: "Crisi internazionali, pandemia e prezzi dell'energia pesano su tutti i paesi: guarda anche la variazione degli altri tre.",
  },
  {
    id: "tassi",
    indicator_id: "long_term_rate",
    question: "I tassi sui titoli di Stato sono saliti o scesi?",
    measures: "Rendimento dei titoli di Stato a circa 10 anni, primo e ultimo mese pubblicati del mandato.",
    how_to_read: "Dipende anche dalla politica della BCE, comune a Francia, Germania e Spagna: la differenza con gli altri paesi conta quanto il livello.",
  },
  {
    id: "investimenti",
    indicator_id: "investment_share",
    question: "Gli investimenti sono aumentati?",
    measures: "Investimenti fissi lordi in rapporto al PIL, confrontati sullo stesso trimestre.",
    how_to_read: "Comprende investimenti pubblici e privati. Il PNRR e gli incentivi edilizi spostano la serie dal 2021.",
  },
] as const;

type Question = (typeof GOVERNMENT_DEBATE_QUESTIONS)[number];
type ChartPoint = GovernmentScorecardV6ChartSlide["series"][number]["points"][number];
type CountryId = GovernmentScorecardV6ChartSlide["series"][number]["id"];

export type GovernmentDebateRow = {
  government_id: string;
  name: string;
  start_date: string;
  /** Successor's oath (exclusive); null for the government in office. */
  end_date: string | null;
  status: "ended" | "current";
  first: Pick<ChartPoint, "period" | "value" | "status"> | null;
  last: Pick<ChartPoint, "period" | "value" | "status"> | null;
  change: number | null;
  missing_reason: string | null;
  peers: { id: Exclude<CountryId, "IT">; label: string; change: number | null }[];
  /** Numbers of the chart events that overlap the mandate. */
  event_numbers: number[];
};

export type GovernmentDebateAnswer = Question & {
  title: string;
  unit: string;
  frequency: GovernmentScorecardV6ChartSlide["frequency"];
  source: GovernmentScorecardV6ChartSlide["source"];
  rows: GovernmentDebateRow[];
};

function mandatePoints(slide: GovernmentScorecardV6ChartSlide, countryId: CountryId) {
  const window = slide.mandate_window;
  return (slide.series.find((series) => series.id === countryId)?.points ?? []).filter((point) => isGovernmentChartPointInWindow(
    point.period_start,
    window.start_date,
    window.end_date,
    window.end_exclusive,
    slide.frequency,
  ));
}

function changeOver(points: readonly ChartPoint[]) {
  return getGovernmentChartSelection(points, points.at(-1)?.period ?? null);
}

function missingReason(points: readonly ChartPoint[], frequency: GovernmentScorecardV6ChartSlide["frequency"]): string {
  if (points.length === 0) return "Nessun dato pubblicato nel periodo del mandato.";
  if (points.length === 1) return "Un solo periodo pubblicato nel mandato: non basta per una variazione.";
  if (frequency === "Trimestrale") return "Mandato più breve di un anno: manca lo stesso trimestre di partenza.";
  return "Variazione non calcolabile sui periodi pubblicati.";
}

function overlappingEvents(
  events: readonly GovernmentScorecardChartEvent[],
  start: string,
  endExclusive: string,
): number[] {
  return events
    .filter((event) => event.start_date < endExclusive && (event.end_date === null || event.end_date >= start))
    .map((event) => event.number);
}

let cached: { answers: GovernmentDebateAnswer[]; events: readonly GovernmentScorecardChartEvent[] } | null = null;

function build() {
  if (cached) return cached;
  const views = GOVERNMENT_SCORECARD_V6_CHRONOLOGY.map((government) => ({
    government,
    charts: getGovernmentScorecardV6View(government.id).charts,
  }));
  const firstReady = views.find((view) => view.charts.status === "ready")?.charts;
  if (!firstReady || firstReady.status !== "ready") throw new Error("serie dei governi non disponibili");
  const events = firstReady.events;

  const answers = GOVERNMENT_DEBATE_QUESTIONS.map((question): GovernmentDebateAnswer => {
    let reference: GovernmentScorecardV6ChartSlide | undefined;
    const rows = views.map(({ government, charts }): GovernmentDebateRow => {
      if (charts.status !== "ready") throw new Error(`grafici non pronti per ${government.id}`);
      const slide = charts.slides.find((candidate) => candidate.indicator_id === question.indicator_id);
      if (!slide) throw new Error(`indicatore ${question.indicator_id} assente per ${government.id}`);
      reference ??= slide;
      const points = mandatePoints(slide, "IT");
      const selection = changeOver(points);
      const change = selection.change;
      const endExclusive = slide.mandate_window.end_exclusive ? slide.mandate_window.end_date : "9999-12-31";
      return {
        government_id: government.id,
        name: government.name,
        start_date: government.start_date,
        end_date: government.end_exclusive,
        status: government.status,
        first: change === null || !selection.first ? null : { period: selection.first.period, value: selection.first.value, status: selection.first.status },
        last: change === null || !selection.selected ? null : { period: selection.selected.period, value: selection.selected.value, status: selection.selected.status },
        change,
        missing_reason: change === null ? missingReason(points, slide.frequency) : null,
        peers: (["FR", "DE", "ES"] as const).map((id) => ({
          id,
          label: slide.series.find((series) => series.id === id)?.label ?? id,
          change: changeOver(mandatePoints(slide, id)).change,
        })),
        event_numbers: overlappingEvents(events, government.start_date, endExclusive),
      };
    });
    if (!reference) throw new Error(`nessuna serie per ${question.indicator_id}`);
    return {
      ...question,
      title: reference.title,
      unit: reference.unit,
      frequency: reference.frequency,
      source: reference.source,
      rows,
    };
  });
  cached = { answers, events };
  return cached;
}

export function buildGovernmentDebateAnswers(): GovernmentDebateAnswer[] {
  return build().answers;
}

export function getGovernmentDebateEvents(): readonly GovernmentScorecardChartEvent[] {
  return build().events;
}

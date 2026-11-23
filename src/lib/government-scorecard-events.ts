import type { GovernmentScorecardV6SupplementalSnapshot } from "@/lib/data/government-scorecard-page-contract";

/**
 * External events drawn as bands on the indicator charts. They are not new
 * facts: each one points at a context item already frozen, sourced and
 * reviewed in the page snapshot. The same event is stored once per government
 * it overlaps (`<government>:<slug>`), so every copy must agree or the build
 * fails instead of showing a band that contradicts a government page.
 */
export const GOVERNMENT_SCORECARD_CHART_EVENT_REFS = [
  { item_id: "dalema-ii:dot-com-slowdown", short_label: "Crisi dot-com" },
  { item_id: "berlusconi-iv:global-financial-crisis", short_label: "Crisi finanziaria globale" },
  { item_id: "monti-i:sovereign-debt-crisis", short_label: "Crisi dei debiti sovrani" },
  { item_id: "conte-ii:pandemic", short_label: "Pandemia" },
  { item_id: "conte-ii:energy-inflation", short_label: "Energia e guerra in Ucraina" },
] as const;

export type GovernmentScorecardChartEvent = {
  id: string;
  number: number;
  title: string;
  short_label: string;
  summary: string;
  start_date: string;
  end_date: string | null;
  sources: readonly { owner: string; url: string }[];
};

type ContextItem = GovernmentScorecardV6SupplementalSnapshot["contexts"][number]["slides"][number]["items"][number];

const comparable = (item: ContextItem) => JSON.stringify([
  item.title,
  item.summary,
  item.start_date,
  item.end_date_or_null,
  item.sources.map((source) => [source.owner, source.url]),
]);

export function resolveGovernmentScorecardChartEvents(
  snapshot: GovernmentScorecardV6SupplementalSnapshot,
): GovernmentScorecardChartEvent[] {
  const items = snapshot.contexts.flatMap((context) => context.slides.flatMap((slide) => slide.items));
  const events = GOVERNMENT_SCORECARD_CHART_EVENT_REFS.map((ref, index) => {
    const item = items.find((candidate) => candidate.id === ref.item_id);
    if (!item) throw new Error(`evento di contesto assente nello snapshot: ${ref.item_id}`);
    const slug = ref.item_id.slice(ref.item_id.indexOf(":") + 1);
    const copies = items.filter((candidate) => candidate.id.endsWith(`:${slug}`));
    if (copies.some((copy) => comparable(copy) !== comparable(item))) {
      throw new Error(`copie divergenti dell'evento di contesto ${slug}`);
    }
    return {
      id: slug,
      number: index + 1,
      title: item.title,
      short_label: ref.short_label,
      summary: item.summary,
      start_date: item.start_date,
      end_date: item.end_date_or_null,
      sources: item.sources.map((source) => ({ owner: source.owner, url: source.url })),
    };
  });
  for (let index = 1; index < events.length; index += 1) {
    if (events[index]!.start_date < events[index - 1]!.start_date) {
      throw new Error("eventi di contesto non in ordine cronologico");
    }
  }
  return events;
}

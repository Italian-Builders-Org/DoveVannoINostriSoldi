import type { PublishedPaper } from "@/lib/papers-contract";

// Only human-reviewed editions belong here. Never import drafts or live research.
export const PUBLISHED_PAPERS: readonly PublishedPaper[] = [];

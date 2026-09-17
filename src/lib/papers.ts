import { PUBLISHED_PAPERS } from "@/content/papers/published/index";
import { createPapersCatalog } from "@/lib/papers-contract";

export const papers = createPapersCatalog(PUBLISHED_PAPERS);

export const GLOBAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const GLOBAL_SEARCH_MAX_QUERY_LENGTH = 180;
export const GLOBAL_SEARCH_DEFAULT_LIMIT = 8;
export const GLOBAL_SEARCH_MAX_LIMIT = 20;

export type SearchKind = "pagina" | "sezione" | "dataset" | "strumento" | "ente";

export type SearchMatchReason =
  | "title-exact"
  | "title-prefix"
  | "title-tokens"
  | "alias"
  | "description"
  | "entity";

export type SearchResult = Readonly<{
  id: string;
  href: string;
  title: string;
  context: string;
  type: SearchKind;
  description: string | null;
  match: Readonly<{
    reason: SearchMatchReason;
    label: string;
  }>;
  score: number;
}>;

export type SearchGroup = Readonly<{
  type: SearchKind;
  label: string;
  results: readonly SearchResult[];
}>;

export type GlobalSearchResponse = Readonly<{
  ok: true;
  query: string;
  groups: readonly SearchGroup[];
  total: number;
  hasMore: boolean;
  staticTotal: number;
  entityTotal: number;
  entitiesAvailable: boolean;
}>;


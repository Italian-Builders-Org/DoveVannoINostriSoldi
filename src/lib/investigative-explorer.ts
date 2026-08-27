import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Relation = {
  id: string;
  relation_type: string;
  subject_type: "person" | "organization" | "public_entity" | "contract";
  subject_key: string;
  object_type: string;
  object_key: string;
  source_dataset: string;
  source_record_id: string;
  period: string;
  acquisition_date: string;
  confidence_note: string;
  role?: string | null;
  amount?: number | null;
  ipa?: string | null;
  source_url?: string | null;
  note_source?: string | null;
};

export type InvestigativeMeta = {
  schemaVersion?: number;
  scope?: string;
  generatedAt?: string;
  relationCount: number;
  duplicatesRemoved?: number;
  acquisitionDate?: string;
  license?: string;
  caveat?: string;
  mergePolicy?: string;
  source?: Record<string, unknown>;
  topPersons?: { key: string; count: number }[];
  topEntities?: { key: string; count: number }[];
  edgesByRole?: Record<string, number>;
};

export type InvestigativeExplorerArtifact = {
  schemaVersion: number;
  transformVersion: number;
  scope: string;
  generatedAt: string;
  relationCount: number;
  duplicatesRemoved: number;
  license: string;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  relations: Relation[];
};

const ARTIFACT_PATH = join(
  process.cwd(),
  "src/data/generated/investigative-explorer-incarichi.json",
);
const META_PATH = join(
  process.cwd(),
  "src/data/generated/investigative-explorer-incarichi.meta.json",
);

let cache: InvestigativeExplorerArtifact | null = null;

export function loadInvestigativeExplorer(): InvestigativeExplorerArtifact {
  if (cache) return cache;
  const data = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as InvestigativeExplorerArtifact;
  if (data.schemaVersion !== 1) throw new Error("schema artifact non supportato");
  cache = data;
  return data;
}

const EMPTY_META: InvestigativeMeta = { relationCount: 0, caveat: "" };

export function loadInvestigativeMeta(): InvestigativeMeta {
  if (!existsSync(META_PATH)) return EMPTY_META;
  try {
    return JSON.parse(readFileSync(META_PATH, "utf8")) as InvestigativeMeta;
  } catch {
    return EMPTY_META;
  }
}

export type SearchIndex = {
  relations: Relation[];
  tokenToIds: Map<string, number[]>;
};

const INDEXED_FIELDS: (keyof Relation)[] = [
  "subject_key",
  "object_key",
  "role",
  "source_record_id",
  "note_source",
  "ipa",
];

function tokenize(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 2);
}

export function buildSearchIndex(relations: Relation[]): SearchIndex {
  const tokenToIds = new Map<string, number[]>();
  relations.forEach((rel, i) => {
    const tokens = new Set<string>();
    for (const field of INDEXED_FIELDS) {
      const v = rel[field];
      if (typeof v === "string" && v) {
        for (const t of tokenize(v)) tokens.add(t);
      }
    }
    for (const t of tokens) {
      const arr = tokenToIds.get(t);
      if (arr) arr.push(i);
      else tokenToIds.set(t, [i]);
    }
  });
  return { relations, tokenToIds };
}

export function searchExplorer(index: SearchIndex, query: string, limit = 100): Relation[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const tokens = tokenize(q);
  if (tokens.length === 0) return [];
  let candidates: number[] | null = null;
  for (const t of tokens) {
    const post = index.tokenToIds.get(t);
    if (!post || post.length === 0) return [];
    candidates = candidates ? intersect(candidates, post) : post;
  }
  if (!candidates) return [];
  return candidates.slice(0, Math.max(1, limit)).map((i) => index.relations[i]);
}

function intersect(a: number[], b: number[]): number[] {
  const setB = new Set(b);
  const out: number[] = [];
  for (const v of a) if (setB.has(v)) out.push(v);
  return out;
}

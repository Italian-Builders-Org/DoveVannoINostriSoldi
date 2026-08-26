import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Relation = {
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

export type InvestigativeExplorerArtifact = {
  schemaVersion: number;
  transformVersion: number;
  scope: string;
  generatedAt: string;
  relationCount: number;
  duplicatesRemoved: number;
  source: Record<string, unknown>;
  methodology: Record<string, unknown>;
  relations: Relation[];
};

let cache: InvestigativeExplorerArtifact | null = null;

export function loadInvestigativeExplorer(): InvestigativeExplorerArtifact {
  if (cache) return cache;
  const path = join(
    process.cwd(),
    "src/data/generated/investigative-explorer-incarichi.json",
  );
  const data = JSON.parse(readFileSync(path, "utf8")) as InvestigativeExplorerArtifact;
  if (data.schemaVersion !== 1) throw new Error("schema artifact non supportato");
  cache = data;
  return data;
}

export function searchRelations(query: string, limit = 100): Relation[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const artifact = loadInvestigativeExplorer();
  const out: Relation[] = [];
  for (const rel of artifact.relations) {
    if (
      rel.subject_key.toUpperCase().includes(q) ||
      rel.object_key.toUpperCase().includes(q) ||
      rel.source_record_id.toUpperCase().includes(q) ||
      (rel.role ?? "").toUpperCase().includes(q)
    ) {
      out.push(rel);
      if (out.length >= limit) break;
    }
  }
  return out;
}

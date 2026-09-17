import snapshot from "@/data/generated/politici-camera-xix.json";
import {
  parsePoliticiCameraSnapshot,
  type PoliticiCameraSnapshot,
} from "@/lib/data/politici-camera-contract";

export type PoliticiGraphNodeKind = "electorate" | "chamber" | "group" | "deputy";

export type PoliticiGraphNode = {
  id: string;
  kind: PoliticiGraphNodeKind;
  label: string;
  subtitle?: string;
  memberCount?: number;
  groupId?: string | null;
  officialPage?: string | null;
  photoUrl?: string | null;
};

export type PoliticiGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "elects" | "belongs";
};

let cached: PoliticiCameraSnapshot | null = null;

export function getPoliticiCameraSnapshot(): PoliticiCameraSnapshot {
  if (!cached) cached = parsePoliticiCameraSnapshot(snapshot);
  return cached;
}

export function buildPoliticiGraph(data: PoliticiCameraSnapshot = getPoliticiCameraSnapshot()) {
  const nodes: PoliticiGraphNode[] = [
    {
      id: "electorate",
      kind: "electorate",
      label: "Corpo elettorale",
      subtitle: "Nodo concettuale: chi elegge la Camera",
    },
    {
      id: "chamber-camera",
      kind: "chamber",
      label: "Camera dei deputati",
      subtitle: data.legislature.label,
      memberCount: data.coverage.deputies,
      officialPage: "https://www.camera.it/",
    },
  ];

  for (const group of data.groups) {
    nodes.push({
      id: `group:${group.id}`,
      kind: "group",
      label: group.label,
      memberCount: group.memberCount,
      officialPage: group.uri,
    });
  }

  for (const deputy of data.deputies) {
    nodes.push({
      id: `deputy:${deputy.id}`,
      kind: "deputy",
      label: deputy.displayName,
      subtitle: deputy.groupLabel ?? "Gruppo non dichiarato",
      groupId: deputy.groupId,
      officialPage: deputy.officialPage ?? deputy.uri,
      photoUrl: deputy.photoUrl ?? null,
    });
  }

  const edges: PoliticiGraphEdge[] = [
    { id: "e-elects-camera", source: "electorate", target: "chamber-camera", kind: "elects" },
  ];

  for (const group of data.groups) {
    edges.push({
      id: `e-chamber-${group.id}`,
      source: "chamber-camera",
      target: `group:${group.id}`,
      kind: "belongs",
    });
  }

  for (const deputy of data.deputies) {
    if (!deputy.groupId) continue;
    edges.push({
      id: `e-group-${deputy.id}`,
      source: `group:${deputy.groupId}`,
      target: `deputy:${deputy.id}`,
      kind: "belongs",
    });
  }

  return { nodes, edges, data };
}

export function deputiesForGroup(groupId: string, data: PoliticiCameraSnapshot = getPoliticiCameraSnapshot()) {
  return data.deputies.filter((deputy) => deputy.groupId === groupId);
}

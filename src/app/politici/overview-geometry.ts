import type { RepublicMap } from "@/lib/politici-repubblica";

/**
 * Radial institutional overview: Capo dello Stato at the centre, executive on the
 * lower arc, Camera and Senato as chamber portals on the upper arc. Pure layout
 * from official map data — not a measure of political power.
 */

export const OVERVIEW = {
  width: 1200,
  height: 1000,
  cx: 600,
  cy: 500,
  rAuthority: 72,
  rExecutive: 178,
  rCabinet: 305,
  rJunior: 378,
  rChambers: 440,
  rOuter: 492,
} as const;

export const OVERVIEW_STACKED = {
  width: 900,
  height: 1100,
  cx: 450,
  cy: 560,
  rAuthority: 64,
  rExecutive: 160,
  rCabinet: 268,
  rJunior: 328,
  rChambers: 385,
  rOuter: 425,
} as const;

export type OverviewLayout = "wide" | "stacked";
export type ChamberId = "camera" | "senato";

export type ApexNode = {
  personId: string;
  x: number;
  y: number;
  radius: number;
};

export type OverviewWedge = {
  groupId: string;
  family: string;
  seatCount: number;
  bandPath: string;
  anchorX: number;
  anchorY: number;
};

export type ChamberCard = {
  chamberId: ChamberId;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  wedges: OverviewWedge[];
};

export type OverviewGeometry = {
  layout: OverviewLayout;
  width: number;
  height: number;
  cx: number;
  cy: number;
  rings: {
    authority: number;
    executive: number;
    cabinet: number;
    junior: number;
    chambers: number;
    outer: number;
  };
  executiveArc: { start: number; end: number };
  legislativeArcs: { camera: { start: number; end: number }; senato: { start: number; end: number } };
  headOfState: ApexNode | null;
  primeMinister: ApexNode | null;
  vicePresidents: ApexNode[];
  ministers: ApexNode[];
  juniorMembers: ApexNode[];
  apexByPerson: Map<string, ApexNode>;
  cards: ChamberCard[];
  cardByChamber: Map<ChamberId, ChamberCard>;
};

export function overviewCanvas(layout: OverviewLayout) {
  return layout === "stacked" ? OVERVIEW_STACKED : OVERVIEW;
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return {
    x: Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
    y: Math.round((cy - radius * Math.sin(angle)) * 100) / 100,
  };
}

function arcPath(cx: number, cy: number, rInner: number, rOuter: number, start: number, end: number): string {
  const sweep = end < start ? 1 : 0;
  const outerStart = polar(cx, cy, rOuter, start);
  const outerEnd = polar(cx, cy, rOuter, end);
  const innerEnd = polar(cx, cy, rInner, end);
  const innerStart = polar(cx, cy, rInner, start);
  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 0 ${sweep} ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 0 ${1 - sweep} ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function overviewSector(cx: number, cy: number, rInner: number, rOuter: number, start: number, end: number): string {
  return arcPath(cx, cy, rInner, rOuter, start, end);
}

export function overviewBridge(from: { x: number; y: number }, to: { x: number; y: number }, lift: number): string {
  const c1 = { x: from.x, y: from.y - lift };
  const c2 = { x: to.x, y: to.y - lift };
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function orderedGroupIds(map: RepublicMap, chamberId: ChamberId): string[] {
  return map.groups
    .filter((group) => group.chamberId === chamberId)
    .toSorted((a, b) => a.shortLabel.localeCompare(b.shortLabel, "it") || a.id.localeCompare(b.id))
    .map((group) => group.id);
}

function buildCard(
  map: RepublicMap,
  chamberId: ChamberId,
  x: number,
  y: number,
  width: number,
  height: number,
): ChamberCard {
  const cx = x + width / 2;
  const cy = y + height - 10;
  const rOuter = Math.min(74, width * 0.3);
  const rInner = rOuter * 0.42;
  const members = map.people.filter((person) => person.chamberId === chamberId);
  const wedges: OverviewWedge[] = [];
  let start = Math.PI;
  for (const groupId of orderedGroupIds(map, chamberId)) {
    const count = members.filter((person) => person.groupId === groupId).length;
    if (count === 0) continue;
    const end = start - (Math.PI * count) / members.length;
    const family = map.groups.find((group) => group.id === groupId)?.partyFamily ?? "misto";
    const mid = (start + end) / 2;
    const padding = 0.004;
    const anchor = polar(cx, cy, rOuter, mid);
    wedges.push({
      groupId,
      family,
      seatCount: count,
      bandPath: arcPath(cx, cy, rInner, rOuter, start + padding, end - padding),
      anchorX: anchor.x,
      anchorY: anchor.y,
    });
    start = end;
  }
  return {
    chamberId,
    x,
    y,
    width,
    height,
    cx: Math.round(cx * 100) / 100,
    cy: Math.round(cy * 100) / 100,
    rInner: Math.round(rInner * 100) / 100,
    rOuter: Math.round(rOuter * 100) / 100,
    wedges,
  };
}

function spreadOnArc(
  count: number,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  nodeRadius: number,
): Array<{ x: number; y: number; radius: number }> {
  if (count === 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const angle = startAngle + (endAngle - startAngle) * t;
    return { ...polar(cx, cy, radius, angle), radius: nodeRadius };
  });
}

export function buildOverviewGeometry(map: RepublicMap, layout: OverviewLayout = "wide"): OverviewGeometry {
  const canvas = overviewCanvas(layout);
  const { cx, cy } = canvas;
  const byRole = (kind: string) => map.people.filter((person) => person.roleKind === kind);

  const executiveArc = { start: Math.PI * 1.12, end: Math.PI * 1.88 };
  const legislativeArcs = {
    camera: { start: Math.PI * 0.55, end: Math.PI * 0.92 },
    senato: { start: Math.PI * 0.08, end: Math.PI * 0.45 },
  };

  const headOfStatePerson = byRole("capo-stato")[0] ?? null;
  const primeMinisterPerson = byRole("presidente-del-consiglio")[0] ?? null;
  const midExec = (executiveArc.start + executiveArc.end) / 2;

  const headOfState = headOfStatePerson
    ? { personId: headOfStatePerson.id, x: cx, y: cy, radius: layout === "stacked" ? 36 : 40 }
    : null;

  const primeMinister = primeMinisterPerson
    ? {
        personId: primeMinisterPerson.id,
        ...polar(cx, cy, canvas.rExecutive, midExec),
        radius: layout === "stacked" ? 28 : 30,
      }
    : null;

  const vicePeople = byRole("vice-presidente-consiglio");
  const vicePresidents = vicePeople.map((person, index) => ({
    personId: person.id,
    ...polar(cx, cy, canvas.rExecutive, midExec + (index === 0 ? -0.32 : 0.32)),
    radius: 22,
  }));

  const ministerPeople = map.people.filter(
    (person) => person.roleKind === "ministro" || person.roleKind === "ministro-senza-portafoglio",
  );
  const ministers = spreadOnArc(
    ministerPeople.length,
    cx,
    cy,
    canvas.rCabinet,
    executiveArc.start + 0.08,
    executiveArc.end - 0.08,
    16,
  ).map((point, index) => ({ personId: ministerPeople[index]!.id, ...point }));

  const juniorPeople = map.people.filter(
    (person) => person.roleKind === "vice-ministro" || person.roleKind === "sottosegretario",
  );
  const juniorMembers = spreadOnArc(
    juniorPeople.length,
    cx,
    cy,
    canvas.rJunior,
    executiveArc.start + 0.05,
    executiveArc.end - 0.05,
    10,
  ).map((point, index) => ({ personId: juniorPeople[index]!.id, ...point }));

  const apexByPerson = new Map<string, ApexNode>();
  for (const node of [headOfState, primeMinister, ...vicePresidents, ...ministers, ...juniorMembers]) {
    if (node) apexByPerson.set(node.personId, node);
  }

  const cardW = layout === "stacked" ? 230 : 288;
  const cardH = layout === "stacked" ? 204 : 232;
  const cameraAnchor = polar(cx, cy, canvas.rOuter - 36, (legislativeArcs.camera.start + legislativeArcs.camera.end) / 2);
  const senatoAnchor = polar(cx, cy, canvas.rOuter - 36, (legislativeArcs.senato.start + legislativeArcs.senato.end) / 2);
  const placeCard = (anchorX: number, anchorY: number) => ({
    x: Math.max(10, Math.min(canvas.width - cardW - 10, Math.round(anchorX - cardW / 2))),
    y: Math.max(56, Math.min(canvas.height - cardH - 10, Math.round(anchorY - cardH * 0.38))),
  });
  const cameraOrigin = placeCard(cameraAnchor.x, cameraAnchor.y);
  const senatoOrigin = placeCard(senatoAnchor.x, senatoAnchor.y);
  const cards = [
    buildCard(map, "camera", cameraOrigin.x, cameraOrigin.y, cardW, cardH),
    buildCard(map, "senato", senatoOrigin.x, senatoOrigin.y, cardW, cardH),
  ];

  return {
    layout,
    width: canvas.width,
    height: canvas.height,
    cx,
    cy,
    rings: {
      authority: canvas.rAuthority,
      executive: canvas.rExecutive,
      cabinet: canvas.rCabinet,
      junior: canvas.rJunior,
      chambers: canvas.rChambers,
      outer: canvas.rOuter,
    },
    executiveArc,
    legislativeArcs,
    headOfState,
    primeMinister,
    vicePresidents,
    ministers,
    juniorMembers,
    apexByPerson,
    cards,
    cardByChamber: new Map(cards.map((card) => [card.chamberId, card])),
  };
}

export function overviewAnchor(
  nodeId: string,
  overview: OverviewGeometry,
): { x: number; y: number } | null {
  if (nodeId === "presidenza-repubblica" && overview.headOfState) {
    return { x: overview.headOfState.x, y: overview.headOfState.y };
  }
  if (nodeId === "governo" && overview.primeMinister) {
    return { x: overview.primeMinister.x, y: overview.primeMinister.y };
  }
  if (nodeId === "governo") return null;
  const card = overview.cardByChamber.get(nodeId as ChamberId);
  return card ? { x: card.x + card.width / 2, y: card.y + card.height * 0.35 } : null;
}

export function cardWedgeAnchor(groupId: string, overview: OverviewGeometry): { x: number; y: number } | null {
  for (const card of overview.cards) {
    const wedge = card.wedges.find((candidate) => candidate.groupId === groupId);
    if (wedge) return { x: wedge.anchorX, y: wedge.anchorY };
  }
  return null;
}

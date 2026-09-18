import type { RepublicMap, RepublicMapPerson } from "@/lib/politici-repubblica";

/**
 * Geometry of the institutional map, in two scenes.
 *
 * The overview is a CivLab-inspired radial power map: Capo dello Stato at the
 * centre, the executive on the lower arc, Camera and Senato as portals on the
 * upper arc. Concentric rings carry the hierarchy — not spaghetti lines.
 *
 * Opening a chamber switches to its own scene: one hemicycle filling the canvas.
 *
 * Pure functions: the same data always produces the same layout.
 */

/** Wide desktop radial canvas. */
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

/** Narrow screens keep the same radial language, slightly tighter. */
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

export function overviewCanvas(layout: OverviewLayout) {
  return layout === "stacked" ? OVERVIEW_STACKED : OVERVIEW;
}

export const CHAMBER = {
  width: 1600,
  height: 940,
  cx: 800,
  cy: 930,
  rInner: 250,
  rOuter: 640,
} as const;

const CHAMBER_ROWS = { camera: 9, senato: 7 } as const;

/** Left-to-right political spectrum used to order the wedges of both chambers. */
export const SPECTRUM: string[] = [
  "alleanza-verdi-sinistra",
  "movimento-5-stelle",
  "partito-democratico",
  "italia-viva",
  "azione",
  "misto",
  "autonomie",
  "noi-moderati",
  "forza-italia",
  "lega",
  "fratelli-italia",
];

export type ChamberId = "camera" | "senato";

export type Seat = {
  personId: string;
  x: number;
  y: number;
  angle: number;
  row: number;
  radius: number;
};

export type Wedge = {
  groupId: string;
  family: string;
  seatCount: number;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  /** Coloured band drawn outside the seats. */
  bandPath: string;
  /** Where a callout or a cross-chamber arc touches the group. */
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "middle" | "end";
};

export type ChamberScene = {
  chamberId: ChamberId;
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  seatRadius: number;
  seats: Seat[];
  seatByPerson: Map<string, Seat>;
  wedges: Wedge[];
  wedgeByGroup: Map<string, Wedge>;
};

export type ApexNode = {
  personId: string;
  x: number;
  y: number;
  radius: number;
};

export type ChamberCard = {
  chamberId: ChamberId;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Centre and radii of the miniature hemicycle drawn inside the card. */
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  wedges: Wedge[];
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
  /** Lower arc occupied by the Consiglio (radians, math angles, 0 = east). */
  executiveArc: { start: number; end: number };
  /** Upper arcs for the two chambers. */
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

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return {
    x: Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
    y: Math.round((cy - radius * Math.sin(angle)) * 100) / 100,
  };
}

function arcPath(cx: number, cy: number, rInner: number, rOuter: number, start: number, end: number): string {
  const outerStart = polar(cx, cy, rOuter, start);
  const outerEnd = polar(cx, cy, rOuter, end);
  const innerEnd = polar(cx, cy, rInner, end);
  const innerStart = polar(cx, cy, rInner, start);
  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 0 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/**
 * Seats of a half circle: every row holds a number of seats proportional to its
 * own circumference, so the spacing stays even from the front row to the back.
 */
function buildSeatGrid(
  total: number,
  rows: number,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
): Array<Omit<Seat, "personId">> {
  const radii = Array.from({ length: rows }, (_, index) =>
    rows === 1 ? rInner : rInner + ((rOuter - rInner) * index) / (rows - 1),
  );
  const weightSum = radii.reduce((sum, radius) => sum + radius, 0);
  const counts = radii.map((radius) => Math.max(1, Math.floor((total * radius) / weightSum)));
  let assigned = counts.reduce((sum, count) => sum + count, 0);
  // Hand the rounding remainder to the roomiest rows, back to front.
  for (let index = counts.length - 1; assigned < total; index = (index - 1 + counts.length) % counts.length) {
    counts[index] += 1;
    assigned += 1;
  }
  for (let index = 0; assigned > total; index = (index + 1) % counts.length) {
    if (counts[index]! > 1) {
      counts[index] -= 1;
      assigned -= 1;
    }
  }

  const seats: Array<Omit<Seat, "personId">> = [];
  radii.forEach((radius, row) => {
    const count = counts[row]!;
    for (let index = 0; index < count; index += 1) {
      // Half-step inset keeps the outermost seats away from the floor line.
      const angle = Math.PI - (Math.PI * (index + 0.5)) / count;
      const { x, y } = polar(cx, cy, radius, angle);
      seats.push({ x, y, angle, row, radius });
    }
  });
  return seats.sort((a, b) => b.angle - a.angle || a.row - b.row);
}

function orderedGroupIds(map: RepublicMap, chamberId: ChamberId): string[] {
  return map.groups
    .filter((group) => group.chamberId === chamberId)
    .sort((a, b) => {
      const left = SPECTRUM.indexOf(a.partyFamily);
      const right = SPECTRUM.indexOf(b.partyFamily);
      return (
        (left === -1 ? SPECTRUM.length : left) - (right === -1 ? SPECTRUM.length : right)
        || a.label.localeCompare(b.label, "it")
      );
    })
    .map((group) => group.id);
}

/** Front rows go to the people who carry the heaviest institutional role. */
function orderMembers(people: RepublicMapPerson[]): RepublicMapPerson[] {
  return [...people].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "it"));
}

type WedgeShape = {
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  bandInner: number;
  bandOuter: number;
  labelRadius: number;
  anchorRadius: number;
};

function buildWedge(
  groupId: string,
  family: string,
  angles: number[],
  padding: number,
  shape: WedgeShape,
): Wedge {
  const startAngle = Math.max(...angles);
  const endAngle = Math.min(...angles);
  const midAngle = (startAngle + endAngle) / 2;
  const label = polar(shape.cx, shape.cy, shape.labelRadius, midAngle);
  const anchor = polar(shape.cx, shape.cy, shape.anchorRadius, midAngle);
  return {
    groupId,
    family,
    seatCount: angles.length,
    startAngle,
    endAngle,
    midAngle,
    bandPath: arcPath(
      shape.cx,
      shape.cy,
      shape.bandInner,
      shape.bandOuter,
      startAngle + padding,
      endAngle - padding,
    ),
    anchorX: anchor.x,
    anchorY: anchor.y,
    labelX: label.x,
    labelY: label.y,
    labelAnchor: midAngle > Math.PI / 2 + 0.3 ? "end" : midAngle < Math.PI / 2 - 0.3 ? "start" : "middle",
  };
}

export function buildChamberScene(map: RepublicMap, chamberId: ChamberId): ChamberScene {
  const rows = CHAMBER_ROWS[chamberId];
  const members = map.people.filter((person) => person.chamberId === chamberId);
  const grid = buildSeatGrid(members.length, rows, CHAMBER.cx, CHAMBER.cy, CHAMBER.rInner, CHAMBER.rOuter);
  const shape: WedgeShape = {
    cx: CHAMBER.cx,
    cy: CHAMBER.cy,
    rInner: CHAMBER.rInner,
    rOuter: CHAMBER.rOuter,
    bandInner: CHAMBER.rOuter + 18,
    bandOuter: CHAMBER.rOuter + 38,
    labelRadius: CHAMBER.rOuter + 70,
    anchorRadius: CHAMBER.rOuter + 28,
  };

  const seats: Seat[] = [];
  const wedges: Wedge[] = [];
  let cursor = 0;

  for (const groupId of orderedGroupIds(map, chamberId)) {
    const groupMembers = orderMembers(members.filter((person) => person.groupId === groupId));
    if (groupMembers.length === 0) continue;
    const slice = grid.slice(cursor, cursor + groupMembers.length);
    cursor += groupMembers.length;

    // Inside the wedge the innermost row comes first, so leaders sit up front.
    const ordered = [...slice].sort((a, b) => a.row - b.row || b.angle - a.angle);
    ordered.forEach((cell, index) => {
      seats.push({ ...cell, personId: groupMembers[index]!.id });
    });

    const family = map.groups.find((group) => group.id === groupId)?.partyFamily ?? "misto";
    wedges.push(buildWedge(groupId, family, slice.map((cell) => cell.angle), Math.PI / (2 * members.length), shape));
  }

  const rowGap = (CHAMBER.rOuter - CHAMBER.rInner) / (rows - 1);
  const frontRow = Math.max(1, grid.filter((cell) => cell.row === 0).length);
  const step = (Math.PI * CHAMBER.rInner) / frontRow;
  const sorted = seats.sort((a, b) => b.angle - a.angle || a.row - b.row);
  return {
    chamberId,
    cx: CHAMBER.cx,
    cy: CHAMBER.cy,
    rInner: CHAMBER.rInner,
    rOuter: CHAMBER.rOuter,
    // Keep seats from colliding: slightly tighter than the geometric maximum.
    seatRadius: Math.max(5.5, Math.min(step * 0.34, rowGap * 0.3)),
    seats: sorted,
    seatByPerson: new Map(sorted.map((seat) => [seat.personId, seat])),
    wedges,
    wedgeByGroup: new Map(wedges.map((wedge) => [wedge.groupId, wedge])),
  };
}

/** Silhouette of a chamber inside its overview card: bands only, no seats. */
function buildCard(
  map: RepublicMap,
  chamberId: ChamberId,
  x: number,
  y: number,
  width: number,
  height: number,
): ChamberCard {
  const cx = x + width / 2;
  // Keep the mini hemicycle in the lower third so the HTML header never sits on seats.
  const cy = y + height - 10;
  const rOuter = Math.min(74, width * 0.3);
  const rInner = rOuter * 0.42;
  const shape: WedgeShape = {
    cx,
    cy,
    rInner,
    rOuter,
    bandInner: rInner,
    bandOuter: rOuter,
    labelRadius: rOuter + 26,
    anchorRadius: rOuter,
  };

  const members = map.people.filter((person) => person.chamberId === chamberId);
  const wedges: Wedge[] = [];
  let start = Math.PI;
  for (const groupId of orderedGroupIds(map, chamberId)) {
    const count = members.filter((person) => person.groupId === groupId).length;
    if (count === 0) continue;
    const end = start - (Math.PI * count) / members.length;
    const family = map.groups.find((group) => group.id === groupId)?.partyFamily ?? "misto";
    wedges.push(buildWedge(groupId, family, [start, end], 0.004, shape));
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
    const point = polar(cx, cy, radius, angle);
    return { ...point, radius: nodeRadius };
  });
}

export function buildOverviewGeometry(map: RepublicMap, layout: OverviewLayout = "wide"): OverviewGeometry {
  const canvas = overviewCanvas(layout);
  const { cx, cy } = canvas;
  const byRole = (kind: string) => map.people.filter((person) => person.roleKind === kind);

  // Lower arc = executive (through south). Upper-left = Camera, upper-right = Senato.
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
  const vicePresidents = vicePeople.map((person, index) => {
    const angle = midExec + (index === 0 ? -0.32 : 0.32);
    return {
      personId: person.id,
      ...polar(cx, cy, canvas.rExecutive, angle),
      radius: 22,
    };
  });

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

/** Smooth link between two points, bent away from the straight line. */
export function curve(from: { x: number; y: number }, to: { x: number; y: number }, bend = 0.22): string {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const controlX = midX - dy * bend;
  const controlY = midY + dx * bend;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/** Arc that leaves and lands vertically: used for the two hemicycles side by side. */
export function bridge(from: { x: number; y: number }, to: { x: number; y: number }, lift: number): string {
  const c1 = { x: from.x, y: from.y - lift };
  const c2 = { x: to.x, y: to.y - lift };
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/** Ring arc path for labels and soft sector fills. */
export function ringArc(
  cx: number,
  cy: number,
  radius: number,
  start: number,
  end: number,
): string {
  const from = polar(cx, cy, radius, start);
  const to = polar(cx, cy, radius, end);
  const large = Math.abs(end - start) > Math.PI ? 1 : 0;
  // Sweep flag 1 = clockwise in SVG when y grows down; our angles increase CCW in math space.
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} A ${radius} ${radius} 0 ${large} 0 ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

export function sectorBand(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  start: number,
  end: number,
): string {
  return arcPath(cx, cy, rInner, rOuter, start, end);
}

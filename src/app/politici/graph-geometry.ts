import type { RepublicMap } from "@/lib/politici-repubblica";

export type ChamberId = "camera" | "senato";
export type Seat = { id: string; personId: string | null; groupId: string | null; family: string | null; x: number; y: number; angle: number; row: number; };
export type Wedge = { groupId: string; family: string; label: string; count: number; startAngle: number; endAngle: number; path: string; };
export type ChamberScene = { seats: Seat[]; wedges: Wedge[]; members: number; vacancies: number | null; capacity: number | null; };
export const CHAMBER = { width: 800, height: 510, cx: 400, cy: 396, inner: 138, outer: 338 } as const;

/** Exact largest-remainder allocation, including empty and very small chambers. */
export function allocateRows(total: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || total > 10_000) throw new RangeError("Numero di posti non valido");
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) throw new RangeError("Pesi non validi");
  if (weights.length === 0) {
    if (total !== 0) throw new RangeError("Nessuna fila disponibile");
    return [];
  }
  const sum = weights.reduce((value, weight) => value + weight, 0);
  if (!Number.isFinite(sum)) throw new RangeError("Somma dei pesi non valida");
  const shares = weights.map((weight) => total * (weight / sum));
  const counts = shares.map(Math.floor);
  const order = shares.map((share, index) => ({ index, remainder: share - counts[index]! }))
    .sort((a, b) => b.remainder - a.remainder || b.index - a.index);
  const remainder = total - counts.reduce((value, count) => value + count, 0);
  for (let index = 0; index < remainder; index += 1) counts[order[index]!.index]! += 1;
  return counts;
}

export function polar(radius: number, angle: number): { x: number; y: number; } {
  return { x: CHAMBER.cx + radius * Math.cos(angle), y: CHAMBER.cy - radius * Math.sin(angle) };
}

export function sectorBand(inner: number, outer: number, start: number, end: number): string {
  const a = polar(outer, start);
  const b = polar(outer, end);
  const c = polar(inner, end);
  const d = polar(inner, start);
  const large = Math.abs(start - end) > Math.PI ? 1 : 0;
  const point = (p: { x: number; y: number; }) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  return `M ${point(a)} A ${outer} ${outer} 0 ${large} 1 ${point(b)} L ${point(c)} A ${inner} ${inner} 0 ${large} 0 ${point(d)} Z`;
}

export function buildSeatGrid(total: number, rows: number): Array<Omit<Seat, "id" | "personId" | "groupId" | "family">> {
  if (!Number.isInteger(rows) || rows < 1 || rows > 30) throw new RangeError("Numero di file non valido");
  const actualRows = Math.max(1, Math.min(rows, total));
  const radii = Array.from({ length: actualRows }, (_, index) => actualRows === 1 ? CHAMBER.inner
    : CHAMBER.inner + index * (CHAMBER.outer - CHAMBER.inner) / (actualRows - 1));
  const counts = allocateRows(total, radii);
  const seats = radii.flatMap((radius, row) => Array.from({ length: counts[row]! }, (_, column) => {
    const angle = Math.PI - Math.PI * (column + 0.5) / counts[row]!;
    return { ...polar(radius, angle), angle, row };
  }));
  return seats.sort((a, b) => b.angle - a.angle || a.row - b.row);
}

/** Alphabetical groups are a neutral layout convention, not an official seating plan or ideological score. */
export function buildChamberScene(map: RepublicMap, chamberId: ChamberId): ChamberScene {
  const institution = map.institutions.find((item) => item.id === chamberId);
  const people = map.people.filter((person) => person.chamberId === chamberId);
  const groups = map.groups.filter((group) => group.chamberId === chamberId)
    .toSorted((a, b) => a.shortLabel.localeCompare(b.shortLabel, "it") || a.id.localeCompare(b.id));
  const groupOrder = new Map(groups.map((group, index) => [group.id, index]));
  const sorted = people.toSorted((a, b) => (groupOrder.get(a.groupId ?? "") ?? groups.length) - (groupOrder.get(b.groupId ?? "") ?? groups.length)
    || a.name.localeCompare(b.name, "it") || a.id.localeCompare(b.id));
  if (new Set(people.map((person) => person.id)).size !== people.length) throw new Error("Identità duplicata nell’emiciclo");
  const vacancies = institution?.vacantSeats ?? null;
  if (vacancies !== null && (!Number.isSafeInteger(vacancies) || vacancies < 0)) throw new Error("Posti vacanti non validi");
  const grid = buildSeatGrid(people.length + (vacancies ?? 0), chamberId === "camera" ? 10 : 8);
  const seats: Seat[] = grid.map((seat, index) => {
    const person = sorted[index];
    return { ...seat, id: person?.id ?? `vacant-${index - people.length}`, personId: person?.id ?? null, groupId: person?.groupId ?? null, family: person?.family ?? null };
  });
  const wedges: Wedge[] = groups.flatMap((group) => {
    const positions = seats.filter((seat) => seat.groupId === group.id);
    if (positions.length === 0) return [];
    const startAngle = positions[0]!.angle;
    const endAngle = positions.at(-1)!.angle;
    return [{
      groupId: group.id, family: group.partyFamily, label: group.shortLabel, count: positions.length, startAngle, endAngle,
      path: sectorBand(CHAMBER.outer + 15, CHAMBER.outer + 19, Math.min(Math.PI, startAngle + 0.008), Math.max(0, endAngle - 0.008))
    }];
  });
  return { seats, wedges, members: people.length, vacancies, capacity: institution?.seatCapacity ?? null };
}

/** Quadratic arc used for co-citation links between seats (not institutional edges). */
export function curve(from: { x: number; y: number }, to: { x: number; y: number }, bend = 0.16): string {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const controlX = midX - dy * bend;
  const controlY = midY + dx * bend;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/** Spatial arrow navigation avoids hundreds of Tab stops in the diagram. */
export function adjacentSeat(seats: readonly Seat[], currentId: string, key: string): string | null {
  const available = seats.filter((seat) => seat.personId !== null);
  if (!available.length) return null;
  if (key === "Home") return available[0]!.id;
  if (key === "End") return available.at(-1)!.id;
  const current = available.find((seat) => seat.id === currentId) ?? available[0]!;
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = directions[key];
  if (!direction) return null;
  let best: { id: string; score: number; } | null = null;
  for (const seat of available) {
    const dx = seat.x - current.x;
    const dy = seat.y - current.y;
    const forward = dx * direction[0] + dy * direction[1];
    if (forward <= 0.01) continue;
    const lateral = Math.abs(dx * direction[1] - dy * direction[0]);
    const score = Math.hypot(dx, dy) + lateral * 2;
    if (!best || score < best.score) best = { id: seat.id, score };
  }
  return best?.id ?? current.id;
}

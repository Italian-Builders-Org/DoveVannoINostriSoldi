import { Bus02Icon } from "@hugeicons/core-free-icons";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Freshness } from "@/lib/mobilita/roma-live-model";

export type Emphasis = "followed" | "selected" | "normal" | "muted";

export type DisplayVehicle = {
  id: string;
  text: string;
  lon: number;
  lat: number;
  /** Compass degrees, null when neither bearing nor path direction is known. */
  heading: number | null;
  freshness: Freshness;
  emphasis: Emphasis;
  color: string;
};

export type LayerPalette = {
  vehicle: string;
  vehicleText: string;
  /** Line number on the white pill next to each marker. */
  labelText: string;
  muted: string;
  halo: string;
  stale: string;
  user: string;
};

type Animated = DisplayVehicle & {
  fromLon: number;
  fromLat: number;
  start: number;
};

type Hit = { id: string; x: number; y: number; r: number };

const ANIMATION_MS = 1600;

type IconNode = readonly (readonly [string, Record<string, unknown>])[];

/** Bus pictogram from the site's icon set, as canvas paths (24×24 viewBox). */
let busPaths: Path2D[] | null = null;
function busGlyph(): Path2D[] {
  if (!busPaths) {
    busPaths = (Bus02Icon as unknown as IconNode)
      .map(([, attrs]) => attrs.d)
      .filter((d): d is string => typeof d === "string")
      .map((d) => new Path2D(d));
  }
  return busPaths;
}
const ORDER: Record<Emphasis, number> = { muted: 0, normal: 1, selected: 2, followed: 3 };

/**
 * Draws live vehicles on a canvas laid over the MapLibre map: one draw per
 * map frame, ~1k vehicles, no DOM node per vehicle. Positions ease from the
 * previously drawn location to the new fix; nothing is extrapolated.
 */
export class VehicleLayer {
  private items = new Map<string, Animated>();
  private hits: Hit[] = [];
  private user: [number, number] | null = null;
  private frame = 0;
  private hover: string | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly reducedMotion: boolean;
  private readonly onRender = () => this.draw();

  constructor(
    private readonly map: MapLibreMap,
    private readonly canvas: HTMLCanvasElement,
    private palette: LayerPalette,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_2d_unavailable");
    this.ctx = ctx;
    this.reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    map.on("render", this.onRender);
    map.on("resize", this.onRender);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.map.off("render", this.onRender);
    this.map.off("resize", this.onRender);
  }

  setPalette(palette: LayerPalette) {
    this.palette = palette;
    this.request();
  }

  setHover(id: string | null) {
    if (id === this.hover) return;
    this.hover = id;
    this.request();
  }

  setUser(position: [number, number] | null) {
    this.user = position;
    this.request();
  }

  setVehicles(vehicles: DisplayVehicle[], animate: boolean) {
    const now = performance.now();
    const next = new Map<string, Animated>();
    for (const vehicle of vehicles) {
      const previous = this.items.get(vehicle.id);
      let fromLon = vehicle.lon;
      let fromLat = vehicle.lat;
      if (previous && animate && !this.reducedMotion) {
        [fromLon, fromLat] = this.current(previous, now);
      }
      next.set(vehicle.id, { ...vehicle, fromLon, fromLat, start: now });
    }
    this.items = next;
    this.request();
  }

  /** Current eased position of a vehicle, for camera follow. */
  position(id: string): [number, number] | null {
    const item = this.items.get(id);
    return item ? this.current(item, performance.now()) : null;
  }

  hitTest(x: number, y: number): string | null {
    let best: string | null = null;
    let distance = Infinity;
    // Topmost first: hits are pushed in draw order.
    for (let i = this.hits.length - 1; i >= 0; i -= 1) {
      const hit = this.hits[i]!;
      const d = Math.hypot(hit.x - x, hit.y - y);
      if (d <= hit.r && d < distance) {
        distance = d;
        best = hit.id;
        if (d < hit.r * 0.6) break;
      }
    }
    return best;
  }

  private current(item: Animated, now: number): [number, number] {
    const t = Math.min(1, (now - item.start) / ANIMATION_MS);
    if (t >= 1) return [item.lon, item.lat];
    const e = 1 - (1 - t) ** 3;
    return [item.fromLon + (item.lon - item.fromLon) * e, item.fromLat + (item.lat - item.fromLat) * e];
  }

  private request() {
    // Ask MapLibre to repaint; our draw runs on its "render" event so the
    // vehicles stay locked to the map during pans and zooms.
    this.map.triggerRepaint();
  }

  private draw() {
    const { canvas, ctx, map } = this;
    const container = map.getContainer();
    const width = container.clientWidth;
    const height = container.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.hits = [];
    const now = performance.now();
    const zoom = map.getZoom();
    const bearing = map.getBearing();
    let animating = false;
    const visible: { item: Animated; x: number; y: number }[] = [];
    for (const item of this.items.values()) {
      const [lon, lat] = this.current(item, now);
      if (now - item.start < ANIMATION_MS && (lon !== item.lon || lat !== item.lat)) animating = true;
      const p = map.project([lon, lat]);
      if (p.x < -40 || p.y < -40 || p.x > width + 40 || p.y > height + 40) continue;
      visible.push({ item, x: p.x, y: p.y });
    }
    visible.sort(
      (a, b) =>
        ORDER[a.item.emphasis] - ORDER[b.item.emphasis] ||
        Number(a.item.id === this.hover) - Number(b.item.id === this.hover),
    );
    const occupied: [number, number, number, number][] = [];
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      !occupied.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b);
    // Transit-app markers (bus pictogram + line) where they can be read and
    // do not overlap; elsewhere a directional dot. Always screen-aligned, so
    // they stay crisp in 2D and in the tilted 3D view.
    const markerZoom = { followed: 0, selected: 11.5, normal: 13.5, muted: 99 } as const;
    const markers = new Set<string>();
    // Draw back-to-front, but reserve space front-to-back.
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const { item, x, y } = visible[i]!;
      const hovered = item.id === this.hover;
      if (zoom < markerZoom[item.emphasis] && !hovered) continue;
      const r = this.markerRadius(item, zoom, hovered);
      const w = this.labelWidth(item.text);
      const box: [number, number, number, number] = [x - r - 5, y - r - 5, x + r + w + 2, y + r + 5];
      if (item.emphasis === "followed" || hovered || free(...box)) {
        occupied.push(box);
        markers.add(item.id);
      }
    }
    if (this.user) this.drawUser(this.user);
    for (const { item, x, y } of visible) {
      const hovered = item.id === this.hover;
      if (markers.has(item.id)) this.drawMarker(item, x, y, bearing, zoom, hovered);
      else this.drawDot(item, x, y, bearing, zoom, hovered);
    }
    if (animating) {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.request());
    }
  }

  private markerRadius(item: Animated, zoom: number, hovered: boolean) {
    const base = 10.5 * Math.min(1.25, Math.max(1, 1 + (zoom - 15) * 0.1));
    return item.emphasis === "followed" ? base + 2.5 : hovered ? base + 1.5 : base;
  }

  private labelWidth(text: string) {
    this.ctx.font = "700 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    return Math.max(14, Math.ceil(this.ctx.measureText(text).width)) + 16;
  }

  private fillFor(item: Animated): string {
    if (item.emphasis === "muted") return this.palette.muted;
    if (item.freshness === "stale") return this.palette.stale;
    return item.color;
  }

  private alphaFor(item: Animated): number {
    if (item.emphasis === "muted") return 0.75;
    if (item.freshness === "aging" || item.freshness === "unknown") return 0.72;
    if (item.freshness === "stale") return 0.6;
    return 1;
  }

  private pointer(x: number, y: number, heading: number, bearing: number, distance: number, size: number) {
    const angle = ((heading - bearing) * Math.PI) / 180;
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const tipX = x + dx * (distance + size);
    const tipY = y + dy * (distance + size);
    const baseX = x + dx * distance;
    const baseY = y + dy * distance;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX - dy * size * 0.9, baseY + dx * size * 0.9);
    ctx.lineTo(baseX + dy * size * 0.9, baseY - dx * size * 0.9);
    ctx.closePath();
  }

  private drawDot(item: Animated, x: number, y: number, bearing: number, zoom: number, hovered: boolean) {
    const { ctx, palette } = this;
    const base = item.emphasis === "muted" ? 2.6 : zoom < 11 ? 2.6 : zoom < 13 ? 3.4 : 4.2;
    const r = hovered ? base + 2 : item.emphasis === "selected" ? base + 1.5 : base;
    ctx.globalAlpha = this.alphaFor(item);
    const fill = this.fillFor(item);
    if (item.heading !== null && item.emphasis !== "muted" && zoom >= 11) {
      this.pointer(x, y, item.heading, bearing, r - 0.5, Math.max(2.5, r * 0.75));
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (item.freshness === "stale" && item.emphasis !== "muted") {
      ctx.fillStyle = palette.halo;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = fill;
      ctx.stroke();
    } else {
      ctx.fillStyle = fill;
      ctx.fill();
      if (item.emphasis !== "muted") {
        ctx.lineWidth = 1;
        ctx.strokeStyle = palette.halo;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    this.hits.push({ id: item.id, x, y, r: Math.max(9, r + 5) });
  }

  /**
   * Round marker in the status colour with the bus pictogram, a heading notch
   * on its rim and the line number in a pill attached to the right.
   */
  private drawMarker(item: Animated, x: number, y: number, bearing: number, zoom: number, hovered: boolean) {
    const { ctx, palette } = this;
    const followed = item.emphasis === "followed";
    const stale = item.freshness === "stale";
    const r = this.markerRadius(item, zoom, hovered);
    const fill = this.fillFor(item);
    const ink = stale ? fill : palette.vehicleText;
    ctx.globalAlpha = this.alphaFor(item);
    if (followed) {
      ctx.beginPath();
      ctx.arc(x, y, r + 11, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Line pill first, so the disc overlaps its left end.
    const w = this.labelWidth(item.text);
    const ph = Math.round(r * 1.45);
    const px = x + r * 0.35;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.roundRect(px, y - ph / 2, w + r * 0.65, ph, ph / 2);
    ctx.fillStyle = palette.halo;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.strokeStyle = fill;
    ctx.globalAlpha = Math.min(1, this.alphaFor(item) + 0.1);
    ctx.stroke();
    ctx.font = `700 ${followed ? 12 : 11}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = palette.labelText;
    ctx.fillText(item.text, px + r * 0.65 + w / 2, y + 0.5);
    ctx.globalAlpha = this.alphaFor(item);
    // Heading notch on the rim.
    if (item.heading !== null) {
      this.pointer(x, y, item.heading, bearing, r + 0.5, Math.max(4, r * 0.42));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.halo;
      ctx.stroke();
    }
    // Disc with ring and soft shadow.
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = stale ? palette.halo : fill;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2;
    if (stale) ctx.setLineDash([3, 2]);
    ctx.strokeStyle = stale ? fill : palette.halo;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Bus pictogram (Hugeicons Bus02, stroked).
    const size = r * 1.25;
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.lineWidth = 2.1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    for (const path of busGlyph()) ctx.stroke(path);
    ctx.restore();
    ctx.globalAlpha = 1;
    this.hits.push({ id: item.id, x, y, r: r + 5 });
    this.hits.push({ id: item.id, x: px + (w + r * 0.65) / 2, y, r: ph / 2 + 2 });
  }

  private drawUser([lon, lat]: [number, number]) {
    const p = this.map.project([lon, lat]);
    const { ctx, palette } = this;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = palette.user;
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = palette.user;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = palette.halo;
    ctx.stroke();
  }
}

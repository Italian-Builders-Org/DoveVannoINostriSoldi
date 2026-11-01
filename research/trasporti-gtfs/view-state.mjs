const fields = [
  "city",
  "band",
  "route",
  "speed",
  "sort",
  "mode",
  "stop",
  "segment",
  "camera",
];
const identity = (value, max = 120) =>
  value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
function cameraValue(value) {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 6 || parts.some((x) => !x.trim())) return null;
  const n = parts.map(Number);
  if (!n.every(Number.isFinite)) return null;
  const [x, y, z, b, p, r] = n;
  return Math.abs(x) <= 1e6 &&
    Math.abs(y) <= 1e6 &&
    z >= 10 &&
    z <= 800 &&
    Math.abs(b) <= 180 &&
    p >= 15 &&
    p <= 65 &&
    r >= 0.4 &&
    r <= 1.6
    ? n
    : null;
}
export function readView(search, cities) {
  const q = new URLSearchParams(search),
    fallback = cities.some((c) => c.id === "torino") ? "torino" : cities[0]?.id;
  return {
    city: cities.some((c) => c.id === q.get("city")) ? q.get("city") : fallback,
    band: ["morning", "day", "evening", "all"].includes(q.get("band"))
      ? q.get("band")
      : "morning",
    route: identity(q.get("route"), 100) ?? "",
    speed: /^[0-3]$/.test(q.get("speed") ?? "") ? Number(q.get("speed")) : null,
    sort: ["speed-asc", "speed-desc", "trips-asc", "trips-desc"].includes(
      q.get("sort"),
    )
      ? q.get("sort")
      : "speed-asc",
    mode: q.get("mode") === "2d" ? "2d" : "3d",
    stop: identity(q.get("stop")),
    segment: /^[a-f0-9]{16}$/.test(q.get("segment") ?? "")
      ? q.get("segment")
      : null,
    camera: cameraValue(q.get("camera")),
  };
}
export function viewURL(href, state) {
  const url = new URL(href);
  url.hash = "";
  for (const key of fields) url.searchParams.delete(key);
  for (const key of fields) {
    const value = state[key];
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(
      key,
      key === "camera" ? value.join(",") : String(value),
    );
  }
  return url.href;
}

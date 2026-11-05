const transportLabels = {
  tram: "Tram",
  bus: "Bus",
  metro: "Metro",
  train: "Treni",
  ferry: "Navigazione",
  funicular: "Funicolari",
};
export function modeLabel(mode) {
  if (!transportLabels[mode]) throw Error("Mezzo non riconosciuto: " + mode);
  return transportLabels[mode];
}
export function groupAreas(sources) {
  const areas = new Map(),
    ids = new Set();
  for (const source of sources) {
    modeLabel(source.mode);
    if (ids.has(source.id)) throw Error("Dataset duplicato: " + source.id);
    ids.add(source.id);
    const id = source.areaId || source.id;
    if (!areas.has(id)) areas.set(id, { id, name: source.name, sources: [] });
    const area = areas.get(id);
    if (
      area.name !== source.name ||
      area.sources.some((s) => s.mode === source.mode)
    )
      throw Error("Copertura ambigua per città e mezzo: " + id);
    area.sources.push(source);
  }
  return [...areas.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
}
export function sourceForArea(areas, id, preferredMode) {
  const sources = areas.find((a) => a.id === id)?.sources;
  return (
    sources?.find((s) => s.mode === preferredMode && s.status === "ready") ??
    sources?.find((s) => s.status === "ready") ??
    sources?.[0] ??
    null
  );
}

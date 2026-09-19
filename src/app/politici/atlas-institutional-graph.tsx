"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RepublicMap, RepublicMapPerson } from "@/lib/politici-repubblica";
import type { GraphSelection } from "./atlas-model";
import { Icon, Portrait } from "./atlas-primitives";
import { curve } from "./graph-geometry";
import {
  buildOverviewGeometry,
  cardWedgeAnchor,
  overviewAnchor,
  overviewBridge,
  overviewSector,
  type ApexNode,
  type ChamberCard,
  type OverviewGeometry,
  type OverviewLayout,
} from "./overview-geometry";
import styles from "./politici.module.css";

export function InstitutionalGraph({
  map,
  selection,
  matchingIds,
  onSelect,
}: {
  map: RepublicMap;
  selection: GraphSelection;
  matchingIds: Set<string>;
  onSelect: (selection: GraphSelection) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const previousZoom = useRef(1);
  const [layout, setLayout] = useState<OverviewLayout>("wide");
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      setLayout(entry.contentRect.width < 900 ? "stacked" : "wide");
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
      viewport.scrollTop = zoom === 1 ? 0 : (viewport.scrollTop + viewport.clientHeight / 2) * (zoom / previousZoom.current) - viewport.clientHeight / 2;
    }
    previousZoom.current = zoom;
  }, [layout, zoom]);

  const resetView = () => {
    setZoom(1);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
      viewport.scrollTop = 0;
    }
  };

  const overview = useMemo(() => buildOverviewGeometry(map, layout), [map, layout]);
  const peopleById = useMemo(() => new Map(map.people.map((person) => [person.id, person])), [map.people]);
  const groupById = useMemo(() => new Map(map.groups.map((group) => [group.id, group])), [map.groups]);
  const institutionById = useMemo(
    () => new Map(map.institutions.map((institution) => [institution.id, institution])),
    [map.institutions],
  );

  const filtered = matchingIds.size < map.people.length;
  const litIds = filtered ? matchingIds : null;
  const selectedGroupId = selection.kind === "group" ? selection.id : null;
  const highlightedGroupIds = useMemo(() => {
    if (!selectedGroupId) return new Set<string>();
    const group = groupById.get(selectedGroupId);
    if (!group) return new Set([selectedGroupId]);
    return new Set([selectedGroupId, ...group.relatedGroupIds]);
  }, [groupById, selectedGroupId]);

  const { cx, cy, rings, executiveArc, legislativeArcs } = overview;
  const midExec = (executiveArc.start + executiveArc.end) / 2;
  const juniorLabel = {
    x: Math.round((cx + (rings.junior + 78) * Math.cos(midExec)) * 100) / 100,
    y: Math.round((cy - (rings.junior + 78) * Math.sin(midExec)) * 100) / 100,
  };
  const ringGuide = (radius: number) =>
    `M ${cx + radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx - radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx + radius} ${cy}`;

  return <section className={styles.institutionalGraph} aria-label="Il Grafo Istituzionale">
    <div className={styles.chamberHeading}>
      <div>
        <p className={styles.eyebrow}>Relazioni ufficiali</p>
        <h2>Il Grafo Istituzionale</h2>
      </div>
      <span className={styles.countMark}>{map.coverage.people}</span>
    </div>
    <p className={styles.sectionLead}>
      Presidenza, Governo, Camera e Senato nello stesso schema. Le linee sono rapporti istituzionali della base dati, non una misura di influenza.
    </p>
    <div className={styles.graphFrame}>
      <div className={styles.graphToolbar}>
        <span className={styles.graphNavigationHint} id="graph-navigation-hint">Ingrandisci e scorri per esplorare</span>
        <div className={styles.zoomControls} role="group" aria-label="Zoom del grafo">
          <button type="button" className={styles.iconButton} aria-label="Riduci il grafo" disabled={zoom === 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))}><Icon name="minus" size={16} /></button>
          <output className={styles.graphZoomValue} aria-live="polite" aria-label="Livello di zoom">{Math.round(zoom * 100)}%</output>
          <button type="button" className={styles.iconButton} aria-label="Ingrandisci il grafo" disabled={zoom === 3} onClick={() => setZoom((value) => Math.min(3, value + 0.25))}><Icon name="plus" size={16} /></button>
          <button type="button" className={styles.graphReset} onClick={resetView} aria-label="Ripristina e centra il grafo"><Icon name="reset" size={15} /><span>Centra</span></button>
        </div>
      </div>
      <div ref={viewportRef} className={styles.graphViewport} data-zoomed={zoom > 1 ? "true" : undefined} tabIndex={0} role="region" aria-label="Area esplorabile del grafo" aria-describedby="graph-navigation-hint">
    <div className={styles.graphBoard} style={{ width: `${zoom * 100}%` }} data-layout={layout} data-focused={litIds !== null ? "true" : "false"}>
      <svg
        className={styles.graphCanvas}
        viewBox={`0 0 ${overview.width} ${overview.height}`}
        role="img"
        aria-label={`Grafo istituzionale della ${map.legislature.label}: Presidenza, Governo, Camera e Senato`}>
        <defs>
          <marker id="grafo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" className={styles.graphArrowHead} />
          </marker>
        </defs>
        <g className={styles.graphRings} aria-hidden="true">
          {[rings.authority, rings.executive, rings.cabinet, rings.junior, rings.chambers, rings.outer].map((radius) => (
            <path key={radius} className={styles.graphRingGuide} d={ringGuide(radius)} />
          ))}
          <path
            className={styles.graphSectorExecutive}
            d={overviewSector(cx, cy, rings.executive - 28, rings.junior + 18, executiveArc.start, executiveArc.end)} />
          <path
            className={styles.graphSectorLegislative}
            d={overviewSector(cx, cy, rings.chambers - 72, rings.chambers - 18, legislativeArcs.camera.start, legislativeArcs.camera.end)} />
          <path
            className={styles.graphSectorLegislative}
            d={overviewSector(cx, cy, rings.chambers - 72, rings.chambers - 18, legislativeArcs.senato.start, legislativeArcs.senato.end)} />
          <circle className={styles.graphHubGlow} cx={cx} cy={cy} r={rings.authority + 10} />
        </g>
        <g className={styles.graphHierarchy}>
          {map.edges.filter((edge) => edge.kind === "gerarchia").map((edge) => {
            const from = overviewAnchor(edge.source, overview);
            const to = overviewAnchor(edge.target, overview);
            if (!from || !to) return null;
            const kind = edge.source === "presidenza-repubblica" && edge.target === "governo"
              ? "nominate"
              : edge.source === "governo" ? "confidence" : "promulgate";
            return <path
              key={edge.id}
              className={styles.graphHierarchyLink}
              d={curve(from, to, kind === "promulgate" ? 0.18 : 0.08)}
              markerEnd="url(#grafo-arrow)"
              data-kind={kind}>
              <title>{edge.label}</title>
            </path>;
          })}
        </g>
        {highlightedGroupIds.size > 0 ? <g className={styles.graphFamily}>
          {map.edges
            .filter((edge) => edge.kind === "famiglia-politica"
              && (highlightedGroupIds.has(edge.source) || highlightedGroupIds.has(edge.target)))
            .map((edge) => {
              const from = cardWedgeAnchor(edge.source, overview);
              const to = cardWedgeAnchor(edge.target, overview);
              if (!from || !to) return null;
              const family = groupById.get(edge.source)?.partyFamily ?? null;
              return <path
                key={edge.id}
                className={styles.graphFamilyLink}
                d={overviewBridge(from, to, 40)}
                data-family={family ?? undefined}>
                <title>{edge.label}</title>
              </path>;
            })}
        </g> : null}
        {overview.cards.map((card) => <ChamberMini
          key={card.chamberId}
          card={card}
          groupById={groupById}
          highlightedGroupIds={highlightedGroupIds} />)}
      </svg>
      <div className={styles.graphOverlay}>
        <HubPlaque
          institution={institutionById.get("presidenza-repubblica")}
          selection={selection}
          node={overview.headOfState}
          people={peopleById}
          litIds={litIds}
          overview={overview}
          onSelect={onSelect} />
        <ExecutiveCluster
          institution={institutionById.get("governo")}
          node={overview.primeMinister}
          people={peopleById}
          litIds={litIds}
          selection={selection}
          overview={overview}
          onSelect={onSelect} />
        <span
          className={styles.graphBandLabel}
          style={{
            left: `${(juniorLabel.x / overview.width) * 100}%`,
            top: `${(juniorLabel.y / overview.height) * 100}%`,
          }}>
          Viceministri e sottosegretari · {overview.juniorMembers.length}
        </span>
        {overview.juniorMembers.map((node) => <PersonDot
          key={node.personId}
          node={node}
          people={peopleById}
          litIds={litIds}
          selection={selection}
          size={22}
          overview={overview}
          onSelect={onSelect} />)}
        {overview.ministers.map((node) => <PersonDot
          key={node.personId}
          node={node}
          people={peopleById}
          litIds={litIds}
          selection={selection}
          size={30}
          overview={overview}
          onSelect={onSelect} />)}
        {overview.vicePresidents.map((node) => <PersonDot
          key={node.personId}
          node={node}
          people={peopleById}
          litIds={litIds}
          selection={selection}
          size={40}
          overview={overview}
          onSelect={onSelect} />)}
        {overview.cards.map((card) => {
          const institution = institutionById.get(card.chamberId);
          return institution ? <ChamberPortal
            key={`enter-${card.chamberId}`}
            card={card}
            institution={institution}
            people={peopleById}
            overview={overview}
            onSelect={onSelect} /> : null;
        })}
      </div>
    </div>
      </div>
    <ul className={styles.graphLegend} aria-label="Legenda dei collegamenti">
      <li><span data-kind="nominate" /> Nomina</li>
      <li><span data-kind="confidence" /> Fiducia</li>
      <li><span data-kind="promulgate" /> Promulgazione / scioglimento</li>
    </ul>
    </div>
    <p className={styles.note}>Clicca Camera o Senato per aprire l’emiciclo. I ritratti aprono la scheda della persona.</p>
  </section>;
}

function ChamberMini({
  card,
  groupById,
  highlightedGroupIds,
}: {
  card: ChamberCard;
  groupById: Map<string, RepublicMap["groups"][number]>;
  highlightedGroupIds: Set<string>;
}) {
  return <g className={styles.graphChamberMini} data-chamber={card.chamberId}>
    <rect
      className={styles.graphChamberFrame}
      x={card.x}
      y={card.y}
      width={card.width}
      height={card.height}
      rx={10} />
    {card.wedges.map((wedge) => {
      const group = groupById.get(wedge.groupId);
      if (!group) return null;
      const active = highlightedGroupIds.size === 0 || highlightedGroupIds.has(wedge.groupId);
      return <path
        key={wedge.groupId}
        className={styles.graphChamberBand}
        d={wedge.bandPath}
        data-family={group.partyFamily}
        data-active={active ? "true" : "false"}>
        <title>{`${group.label} · ${wedge.seatCount}`}</title>
      </path>;
    })}
  </g>;
}

function ChamberPortal({
  card,
  institution,
  people,
  overview,
  onSelect,
}: {
  card: ChamberCard;
  institution: RepublicMap["institutions"][number];
  people: Map<string, RepublicMapPerson>;
  overview: OverviewGeometry;
  onSelect: (selection: GraphSelection) => void;
}) {
  const leader = institution.leaderPersonId ? people.get(institution.leaderPersonId) ?? null : null;
  const headerHeight = card.height - 8;
  return <button
    type="button"
    className={styles.graphChamberEnter}
    aria-label={`${institution.label}: apri emiciclo`}
    style={{
      left: `${((card.x + card.width / 2) / overview.width) * 100}%`,
      top: `${((card.y + 4) / overview.height) * 100}%`,
      width: `${(card.width / overview.width) * 100}%`,
      height: `${(headerHeight / overview.height) * 100}%`,
    }}
    onClick={() => onSelect({ kind: "institution", id: card.chamberId })}>
    <span className={styles.graphChamberEnterTitle}>{institution.shortLabel}</span>
    <span className={styles.graphChamberEnterMeta}>
      {institution.vacantSeats
        ? `${institution.memberCount} in carica · ${institution.vacantSeats} vacanti`
        : `${institution.memberCount} in carica`}
    </span>
    {leader ? <span className={styles.graphChamberEnterLeader}>
      <Portrait person={leader} size={36} />
      <span>
        <strong>{leader.name}</strong>
        <small>Apri emiciclo <Icon name="arrow" size={12} /></small>
      </span>
    </span> : <span className={styles.graphChamberEnterCta}>Apri emiciclo <Icon name="arrow" size={12} /></span>}
  </button>;
}

function HubPlaque({
  selection,
  institution,
  node,
  people,
  litIds,
  overview,
  onSelect,
}: {
  selection: GraphSelection;
  institution: RepublicMap["institutions"][number] | undefined;
  node: ApexNode | null;
  people: Map<string, RepublicMapPerson>;
  litIds: Set<string> | null;
  overview: OverviewGeometry;
  onSelect: (selection: GraphSelection) => void;
}) {
  if (!institution || !node) return null;
  const leader = institution.leaderPersonId ? people.get(institution.leaderPersonId) ?? null : null;
  if (!leader) return null;
  return <div
    className={styles.graphHub}
    style={{
      left: `${(node.x / overview.width) * 100}%`,
      top: `${(node.y / overview.height) * 100}%`,
    }}>
    <button
      type="button"
      className={styles.graphHubPortrait}
      aria-pressed={selection.kind === "person" && selection.id === leader.id}
      data-lit={litIds === null || litIds.has(leader.id) ? "true" : "false"}
      aria-label={`${leader.name}, ${institution.leaderRoleLabel ?? institution.role}`}
      onClick={() => onSelect({ kind: "person", id: leader.id })}>
      <Portrait person={leader} size={72} eager />
    </button>
    <button
      type="button"
      className={styles.graphHubLabel}
      onClick={() => onSelect({ kind: "institution", id: institution.id })}>
      <span>{institution.role}</span>
      <strong>{leader.name}</strong>
    </button>
  </div>;
}

function ExecutiveCluster({
  institution,
  node,
  people,
  litIds,
  selection,
  overview,
  onSelect,
}: {
  institution: RepublicMap["institutions"][number] | undefined;
  node: ApexNode | null;
  people: Map<string, RepublicMapPerson>;
  litIds: Set<string> | null;
  selection: GraphSelection;
  overview: OverviewGeometry;
  onSelect: (selection: GraphSelection) => void;
}) {
  if (!institution || !node) return null;
  const leader = institution.leaderPersonId ? people.get(institution.leaderPersonId) ?? null : null;
  if (!leader) return null;
  return <div
    className={styles.graphExecutive}
    style={{
      left: `${(node.x / overview.width) * 100}%`,
      top: `${(node.y / overview.height) * 100}%`,
    }}>
    <span className={styles.graphBandLabel} data-inline="true">Esecutivo</span>
    <button
      type="button"
      className={styles.graphExecutivePortrait}
      data-lit={litIds === null || litIds.has(leader.id) ? "true" : "false"}
      data-selected={selection.kind === "person" && selection.id === leader.id ? "true" : "false"}
      aria-pressed={selection.kind === "person" && selection.id === leader.id}
      aria-label={`${leader.name}, ${leader.roleLabel}`}
      onClick={() => onSelect({ kind: "person", id: leader.id })}>
      <Portrait person={leader} size={56} eager />
    </button>
    <button
      type="button"
      className={styles.graphExecutiveLabel}
      onClick={() => onSelect({ kind: "institution", id: institution.id })}>
      <strong>{institution.label}</strong>
      <span>{leader.name} · {institution.memberCount} componenti</span>
    </button>
  </div>;
}

function PersonDot({
  node,
  people,
  litIds,
  selection,
  size,
  overview,
  onSelect,
}: {
  node: ApexNode;
  people: Map<string, RepublicMapPerson>;
  litIds: Set<string> | null;
  selection: GraphSelection;
  size: number;
  overview: OverviewGeometry;
  onSelect: (selection: GraphSelection) => void;
}) {
  const person = people.get(node.personId);
  if (!person) return null;
  return <button
    type="button"
    className={styles.graphPortraitNode}
    style={{
      left: `${(node.x / overview.width) * 100}%`,
      top: `${(node.y / overview.height) * 100}%`,
      width: `min(${size}px, ${(size / 9).toFixed(3)}cqw)`,
      height: `min(${size}px, ${(size / 9).toFixed(3)}cqw)`,
    }}
    data-lit={litIds === null || litIds.has(person.id) ? "true" : "false"}
    data-selected={selection.kind === "person" && selection.id === person.id ? "true" : "false"}
    aria-pressed={selection.kind === "person" && selection.id === person.id}
    aria-label={`${person.name}, ${person.roleLabel}`}
    title={`${person.name} · ${person.roleLabel}`}
    onClick={() => onSelect({ kind: "person", id: person.id })}>
    <Portrait person={person} size={size} />
  </button>;
}

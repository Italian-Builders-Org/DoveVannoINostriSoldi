"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { RepublicMap } from "@/lib/politici-repubblica";
import type { GraphSelection } from "./atlas-model";
import { adjacentSeat, buildChamberScene, CHAMBER, sectorBand, type ChamberId } from "./graph-geometry";
import { Icon, Portrait } from "./atlas-primitives";
import styles from "./politici.module.css";

export function Hemicycle({ map, chamberId, selection, matchingIds, onSelect }: {
  map: RepublicMap; chamberId: ChamberId; selection: GraphSelection; matchingIds: Set<string>; onSelect: (selection: GraphSelection) => void;
}) {
  const id = useId();
  const scene = useMemo(() => buildChamberScene(map, chamberId), [map, chamberId]);
  const peopleById = useMemo(() => new Map(map.people.map((person) => [person.id, person])), [map.people]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const seatsRef = useRef(new Map<string, SVGGElement>());
  const viewport = useRef<HTMLDivElement>(null);
  const focusId = focusedId && scene.seats.some((seat) => seat.id === focusedId) ? focusedId : scene.seats.find((seat) => seat.personId)?.id;
  const hoverPerson = hoverId ? peopleById.get(hoverId) : null;
  const chosenPerson = selection.kind === "person" ? peopleById.get(selection.id) : null;
  const visiblePerson = hoverPerson ?? (chosenPerson?.chamberId === chamberId ? chosenPerson : null);
  const activeGroup = selection.kind === "group" ? selection.id : null;
  const highlightedCount = scene.seats.filter((seat) => seat.personId && matchingIds.has(seat.personId)).length;

  return <section className={styles.chamber} aria-label={`Emiciclo ${chamberId === "camera" ? "della Camera" : "del Senato"}`} data-chamber={chamberId}>
    <div className={styles.chamberHeading}>
      <div>
        <p className={styles.eyebrow}>La composizione dell’Aula</p>
        <h2>
          {chamberId === "camera" ? "Camera dei deputati" : "Senato della Repubblica"}
        </h2>
      </div>
      <span className={styles.tag}>{scene.members} componenti</span>
    </div>
    <div
      ref={viewport}
      className={styles.diagramViewport}
      data-zoomed={zoom > 1 ? "true" : undefined}
      tabIndex={zoom > 1 ? 0 : -1}
      aria-label={zoom > 1 ? "Mappa ingrandita: scorri per esplorare" : undefined}>
      <svg
        className={styles.hemicycle}
        style={{ width: `${zoom * 100}%` }}
        viewBox={`0 0 ${CHAMBER.width} ${CHAMBER.height}`}
        role="group"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}>
        <title id={`${id}-title`}>{chamberId === "camera" ? "Camera dei deputati" : "Senato della Repubblica"}: {scene.members} persone{scene.vacancies !== null ? `, ${scene.vacancies} posti vacanti` : ""}</title>
        <desc id={`${id}-desc`}>Un seggio per persona. Gruppi ordinati alfabeticamente, non la disposizione reale in Aula. Usa Tab per entrare, frecce per spostarti, Invio o Spazio per aprire la scheda. L’elenco offre gli stessi dati.</desc>
        <g aria-hidden="true" className={styles.architecture}>
          <path d={sectorBand(366, 375, Math.PI, 0)} className={styles.outerArchitecture} />
          {[128, 349, 361].map((radius) => <path key={radius} d={`M ${CHAMBER.cx - radius} ${CHAMBER.cy} A ${radius} ${radius} 0 0 1 ${CHAMBER.cx + radius} ${CHAMBER.cy}`} />)}
          <path d="M24 407h752M62 420h676" />
          <path d={sectorBand(75, 95, Math.PI - 0.08, 0.08)} className={styles.rostrum} />
          <rect x="372" y="365" width="56" height="25" rx="5" className={styles.rostrum} />
          <path d="M377 372h46M377 378h46" />
          <path d="M382 441h12" className={styles.tricoloreGreen} />
          <path d="M394 441h12" className={styles.tricoloreWhite} />
          <path d="M406 441h12" className={styles.tricoloreRed} />
          <text x="400" y="467" className={styles.hemicycleCaption} textAnchor="middle">PARLAMENTO ITALIANO</text>
        </g>
        <g aria-hidden="true">
          {scene.wedges.map((wedge) => <path
            key={wedge.groupId}
            d={wedge.path}
            className={styles.groupArc}
            data-family={wedge.family}
            data-dim={activeGroup && activeGroup !== wedge.groupId ? "true" : undefined} />)}
        </g>
        {scene.seats.map((seat) => {
          const person = seat.personId ? peopleById.get(seat.personId) : null;
          const selected = selection.kind === "person" && selection.id === seat.personId;
          const dim = person && (!matchingIds.has(person.id) || (activeGroup && activeGroup !== seat.groupId));
          const transform = `translate(${seat.x.toFixed(3)} ${seat.y.toFixed(3)}) rotate(${(90 - seat.angle * 180 / Math.PI).toFixed(3)})`;
          if (!person) return <g key={seat.id} transform={transform} className={styles.vacantSeat} aria-hidden="true">
            <rect x="-4.6" y="-5.6" width="9.2" height="11.2" rx="2.4" />
          </g>;
          return <g
            key={seat.id}
            ref={(element) => { if (element) seatsRef.current.set(seat.id, element); else seatsRef.current.delete(seat.id); }}
            transform={transform}
            role="button"
            tabIndex={focusId === seat.id ? 0 : -1}
            aria-label={`${person.name}, ${person.roleLabel}`}
            aria-pressed={selected}
            data-seat-person={person.id}
            className={styles.seat}
            data-family={seat.family ?? undefined}
            data-selected={selected ? "true" : undefined}
            data-dim={dim ? "true" : undefined}
            onClick={() => onSelect({ kind: "person", id: person.id })}
            onFocus={() => {
              setFocusedId(seat.id);
              setHoverId(person.id);
            }}
            onBlur={() => setHoverId(null)}
            onPointerEnter={(event) => { if (event.pointerType !== "touch") setHoverId(person.id); }}
            onPointerLeave={() => { if (document.activeElement !== seatsRef.current.get(seat.id)) setHoverId(null); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect({ kind: "person", id: person.id });
                return;
              }
              const nextId = adjacentSeat(scene.seats, seat.id, event.key);
              if (nextId) {
                event.preventDefault();
                setFocusedId(nextId);
                seatsRef.current.get(nextId)?.focus();
              }
            }}>
            <circle r="8.2" className={styles.seatHitArea} />
            <rect x="-4.6" y="-5.6" width="9.2" height="11.2" rx="2.4" />
            <path d="M-3.1-2.3h6.2" className={styles.seatBack} />
          </g>;
        })}
      </svg>
    </div>
    <div className={styles.diagramFooter}>
      <div className={styles.seatPreview}>
        {visiblePerson ? <>
          <Portrait person={visiblePerson} size={32} />
          <span>
            <strong>
              {visiblePerson.name}
            </strong>
            <small>
              {visiblePerson.roleLabel}
            </small>
          </span>
        </> : <>
          <span className={styles.previewDot} aria-hidden="true" />
          <span>
            <strong>Ogni seggio è una persona</strong>
            <small>Selezionalo per esplorare la scheda</small>
          </span>
        </>}
      </div>
      <div className={styles.zoomControls} role="group" aria-label="Ingrandimento della mappa">
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Riduci mappa"
          disabled={zoom <= 1}
          onClick={() => setZoom((value) => Math.max(1, value - 0.5))}>
          <Icon name="minus" size={17} />
        </button>
        <button
          type="button"
          className={styles.zoomReset}
          aria-label="Ripristina ingrandimento"
          disabled={zoom === 1}
          onClick={() => {
            setZoom(1);
            viewport.current?.scrollTo({ left: 0, top: 0 });
          }}>{Math.round(zoom * 100)}%</button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Ingrandisci mappa"
          disabled={zoom >= 3}
          onClick={() => setZoom((value) => Math.min(3, value + 0.5))}>
          <Icon name="plus" size={17} />
        </button>
      </div>
    </div>
    <div className={styles.legendHeading}>
      <h3>Gruppi parlamentari</h3>
      <span>{highlightedCount}/{scene.members} corrispondono ai filtri</span>
    </div>
    <ul className={styles.groupLegend} aria-label="Seleziona un gruppo parlamentare">
      {scene.wedges.map((wedge) => <li key={wedge.groupId}>
        <button
          type="button"
          aria-pressed={activeGroup === wedge.groupId}
          data-group-id={wedge.groupId}
          onClick={() => onSelect(activeGroup === wedge.groupId ? { kind: "institution", id: chamberId } : { kind: "group", id: wedge.groupId })}>
          <span className={styles.swatch} data-family={wedge.family} />
          <span>
            {wedge.label}
          </span>
          <strong>
            {wedge.count}
          </strong>
        </button>
      </li>)}
    </ul>
    <p className={styles.diagramNote}>Rappresentazione stilizzata, non la disposizione reale in Aula. Gruppi in ordine alfabetico. {scene.vacancies !== null ? `Seggi vuoti: ${scene.vacancies}, indicati dal contorno.` : "Dato sui seggi vacanti non disponibile."}</p>
  </section>;
}

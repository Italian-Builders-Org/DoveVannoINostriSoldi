"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { RepublicMap } from "@/lib/politici-repubblica";
import type { GraphSelection } from "./atlas-model";
import { adjacentSeat, buildChamberScene, CHAMBER, curve, sectorBand, type ChamberId } from "./graph-geometry";
import type { NewsData, Resource } from "./atlas-data";
import { PartySymbol } from "./atlas-symbol";
import { SeatPreview, useSeatPreview } from "./atlas-seat-preview";
import { Icon, Portrait } from "./atlas-primitives";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

export function Hemicycle({ map, chamberId, selection, matchingIds, judicialIds, onSelect, news }: {
  map: RepublicMap;
  chamberId: ChamberId;
  selection: GraphSelection;
  matchingIds: Set<string>;
  judicialIds?: Set<string>;
  onSelect: (selection: GraphSelection) => void;
  news?: Resource<NewsData>;
}) {
  const id = useId();
  const preview = useSeatPreview();
  const scene = useMemo(() => buildChamberScene(map, chamberId), [map, chamberId]);
  const peopleById = useMemo(() => new Map(map.people.map((person) => [person.id, person])), [map.people]);
  const seatByPerson = useMemo(() => {
    const seats = new Map<string, (typeof scene.seats)[number]>();
    for (const seat of scene.seats) {
      if (seat.personId) seats.set(seat.personId, seat);
    }
    return seats;
  }, [scene]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const seatsRef = useRef(new Map<string, SVGGElement>());
  const viewport = useRef<HTMLDivElement>(null);
  const focusId = focusedId && scene.seats.some((seat) => seat.id === focusedId) ? focusedId : scene.seats.find((seat) => seat.personId)?.id;
  const hoverPerson = hoverId ? peopleById.get(hoverId) : null;
  const previewPerson = preview.preview ? peopleById.get(preview.preview.personId) : null;
  const chosenPerson = selection.kind === "person" ? peopleById.get(selection.id) : null;
  const visiblePerson = hoverPerson ?? (chosenPerson?.chamberId === chamberId ? chosenPerson : null);
  const activeGroup = selection.kind === "group" ? selection.id : null;
  const highlightedCount = scene.seats.filter((seat) => seat.personId && matchingIds.has(seat.personId)).length;
  const connections = useMemo(() => news?.status === "ready" ? news.data.connections : [], [news]);
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.person.id, connection])),
    [connections],
  );
  const selectedSeat = chosenPerson?.chamberId === chamberId ? seatByPerson.get(chosenPerson.id) ?? null : null;

  return <section className={styles.chamber} aria-label={`Emiciclo ${chamberId === "camera" ? "della Camera" : "del Senato"}`} data-chamber={chamberId}>
    <div className={`${styles.chamberHeading} ${extra.heading}`}>
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
        <title id={`${id}-title`}>{`${chamberId === "camera" ? "Camera dei deputati" : "Senato della Repubblica"}: ${scene.members} persone${scene.vacancies !== null ? `, ${scene.vacancies} posti vacanti` : ""}`}</title>
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
          const connected = Boolean(person && connectionById.has(person.id));
          const dim = person && (
            (!matchingIds.has(person.id) || (activeGroup && activeGroup !== seat.groupId))
            && !(selectedSeat && (selected || connected))
          );
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
            data-preview={preview.preview?.personId === person.id ? "true" : undefined}
            aria-describedby={preview.preview?.personId === person.id ? `${id}-preview` : undefined}
            className={`${styles.seat} ${preview.preview?.personId === person.id ? extra.previewed : ""}`}
            data-family={seat.family ?? undefined}
            data-selected={selected ? "true" : undefined}
            data-connected={connected ? "true" : undefined}
            data-giudiziario={judicialIds?.has(person.id) ? "true" : "false"}
            data-dim={dim ? "true" : undefined}
            onClick={() => { preview.dismiss(); onSelect({ kind: "person", id: person.id }); }}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) preview.show(person.id, event.currentTarget, true);
              setFocusedId(seat.id);
              setHoverId(person.id);
            }}
            onBlur={() => { setHoverId(null); preview.dismiss(); }}
            onPointerEnter={(event) => { if (event.pointerType !== "touch") { setHoverId(person.id); preview.show(person.id, event.currentTarget, false); } }}
            onPointerLeave={() => { preview.leave(); if (document.activeElement !== seatsRef.current.get(seat.id)) setHoverId(null); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                preview.dismiss();
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
        {selectedSeat && connections.length ? <g className={styles.newsLayer} aria-hidden="true">
          {connections.map((connection) => {
            const to = seatByPerson.get(connection.person.id);
            if (!to) return null;
            return <path
              key={connection.person.id}
              className={styles.newsLink}
              d={curve({ x: selectedSeat.x, y: selectedSeat.y }, { x: to.x, y: to.y })}
              style={{ strokeWidth: Math.min(3.5, 1.1 + connection.articleCount * 0.45) }}>
              <title>{`${connection.person.name}: ${connection.articleCount} notizie in comune`}</title>
            </path>;
          })}
        </g> : null}
      </svg>
    </div>
    {previewPerson ? <SeatPreview id={`${id}-preview`} state={preview} person={previewPerson} groupLabel={map.groups.find((group) => group.id === previewPerson.groupId)?.label ?? null} /> : null}
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
    {selectedSeat && connections.length > 0 ? <p className={styles.connectionLegend} role="note">
      <span aria-hidden="true" />
      Co-citazioni nelle notizie · {connections.length} {connections.length === 1 ? "persona" : "persone"} sulla mappa
    </p> : null}
    <ul className={styles.markerLegend} aria-label="Segni sull’emiciclo">
      <li><span className={styles.judicialSample} aria-hidden="true" /> Ha procedimenti giudiziari documentati: apri la scheda per stato e fonti. Il segno indica dove guardare, non una colpevolezza</li>
    </ul>
    <div className={styles.legendHeading}>
      <h3>Gruppi parlamentari</h3>
      <span>{highlightedCount}/{scene.members} corrispondono ai filtri</span>
    </div>
    <ul className={`${styles.groupLegend} ${extra.legend}`} aria-label="Seleziona un gruppo parlamentare">
      {scene.wedges.map((wedge) => <li key={wedge.groupId}>
        <button
          type="button"
          aria-pressed={activeGroup === wedge.groupId}
          data-group-id={wedge.groupId}
          onClick={() => onSelect(activeGroup === wedge.groupId ? { kind: "institution", id: chamberId } : { kind: "group", id: wedge.groupId })}>
          <PartySymbol family={wedge.family} label={wedge.label} />
          <span>
            {wedge.label}
          </span>
          <strong>
            {wedge.count}
          </strong>
        </button>
      </li>)}
    </ul>
    <p className={styles.diagramNote}>Rappresentazione stilizzata, non la disposizione reale in Aula. Gruppi in ordine alfabetico. Simboli delle famiglie politiche: fonti e attribuzioni nelle schede dei gruppi. {scene.vacancies !== null ? `Seggi vuoti: ${scene.vacancies}, indicati dal contorno.` : "Dato sui seggi vacanti non disponibile."}</p>
  </section>;
}

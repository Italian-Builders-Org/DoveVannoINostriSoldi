"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RepublicMap, RepublicMapPerson } from "@/lib/politici-repubblica";
import { AtlasInspector, AtlasSearch } from "./atlas-controls";
import { AtlasRailResizer, useAtlasRail } from "./atlas-rail";
import { Hemicycle } from "./atlas-hemicycle";
import { ConvictionsDirectory } from "./atlas-condanne";
import { InstitutionalGraph } from "./atlas-institutional-graph";
import { InstitutionalRelations } from "./atlas-facts";
import { Icon, PersonRow, Portrait, SourceLink, Status } from "./atlas-primitives";
import { atlasUrl, defaultSelection, filteredPeople, longDate, readAtlasState, ROLES, SCOPES, scopeForSelection, validSelection, type AtlasScope, type AtlasState, type GraphSelection } from "./atlas-model";
import { buildChamberScene, CHAMBER } from "./graph-geometry";
import { RepubblicaPanel } from "./repubblica-panel";
import { useAtlasData } from "./use-atlas-data";
import type { GiudiziarioCase } from "@/lib/data/parlamento-giudiziario-contract";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

export type { GraphSelection } from "./atlas-model";

const subscribeReady = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function RepubblicaGraph({ map, initialState, invalidSelection = false, initialDetailsOpen = false, judicialPersonIds = [], convictions = [], convictionsNote = "" }: {
  map: RepublicMap;
  initialState: AtlasState;
  invalidSelection?: boolean;
  initialDetailsOpen?: boolean;
  judicialPersonIds?: readonly string[];
  convictions?: readonly GiudiziarioCase[];
  convictionsNote?: string;
}) {
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const rail = useAtlasRail();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(initialState);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [invalid, setInvalid] = useState(invalidSelection);
  const [interaction, setInteraction] = useState<"pointer" | "keyboard">("pointer");
  const people = useMemo(() => filteredPeople(map, state), [map, state]);
  const matchingIds = useMemo(() => new Set(people.map((person) => person.id)), [people]);
  const selectedId = state.selection.kind === "person" ? state.selection.id : null;
  const selectedGroupId = state.selection.kind === "group" ? state.selection.id : null;
  const data = useAtlasData(selectedId, judicialPersonIds);
  const selectionKey = state.selection.kind === "overview" ? "overview" : `${state.selection.kind}:${state.selection.id}`;
  const filterCount = Number(Boolean(state.family)) + Number(state.role !== "tutti") + Number(Boolean(state.query.trim()));
  const scopeLabel = SCOPES.find((item) => item.id === state.scope)!.label;

  const update = useCallback((next: AtlasState, history: "push" | "replace" = "replace") => {
    stateRef.current = next;
    setState(next);
    const url = atlasUrl(window.location.href, next);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url) {
      if (history === "push") window.history.pushState(window.history.state, "", url);
      else window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  useEffect(() => {
    const restore = () => {
      const parsed = readAtlasState(new URLSearchParams(window.location.search), map);
      stateRef.current = parsed.state;
      setState(parsed.state);
      setInvalid(parsed.invalidSelection);
      setDetailsOpen(parsed.state.selection.kind === "person" || parsed.state.selection.kind === "group");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [map]);

  const select = useCallback((selection: GraphSelection) => {
    if (!validSelection(selection, map)) return;
    const current = stateRef.current;
    const scope = scopeForSelection(selection, map, current.scope);
    update({ ...current, scope, selection, query: "", family: null, role: "tutti" }, "push");
    setDetailsOpen(true);
    setInvalid(false);
  }, [map, update]);

  const changeScope = (scope: AtlasScope) => {
    update({ ...state, scope, selection: defaultSelection(scope), query: "", family: null, role: "tutti" }, "push");
    setDetailsOpen(false);
    setInvalid(false);
  };
  const clearFilters = () => update({ ...state, query: "", family: null, role: "tutti" });
  const closeDetails = useCallback(() => setDetailsOpen(false), []);

  return <div
    className={`${styles.explorer} ${rail.resizing ? extra.resizing : ""}`}
    data-politici-atlas
    data-atlas-ready={ready ? "true" : "false"}
    data-resizing={rail.resizing ? "true" : undefined}
    style={rail.style}
    data-mode={state.mode}
    data-scope={state.scope}
    data-interaction={interaction}
    onPointerDownCapture={() => setInteraction("pointer")}
    onKeyDownCapture={() => setInteraction("keyboard")}>
    <AtlasInspector open={detailsOpen} onClose={closeDetails} selectionKey={selectionKey}>
      <RepubblicaPanel
        key={selectionKey}
        map={map}
        selection={state.selection}
        profiles={data.profiles}
        news={data.news}
        judicial={data.judicial}
        onSelect={select}
        onRetryProfiles={data.retryProfiles}
        onRetryNews={data.retryNews} />
    </AtlasInspector>
    <AtlasRailResizer rail={rail} />
    <section className={`${styles.workspace} ${extra.workspace}`} aria-label="Esplora la politica italiana">
      <div className={styles.topBar}>
        <nav className={styles.scopeSwitch} aria-label="Istituzione">
          {SCOPES.map((scope) => <button
            key={scope.id}
            type="button"
            aria-current={state.scope === scope.id ? "page" : undefined}
            data-scope-button={scope.id}
            onClick={() => changeScope(scope.id)}>
            {scope.label}
          </button>)}
        </nav>
        <div className={`${styles.workspaceTools} ${extra.tools}`}>
          <AtlasSearch
            map={map}
            query={state.query}
            onQuery={(query) => update({ ...state, query })}
            onSelect={select}
            onResults={() => update({ ...state, mode: "elenco" })} />
          <button
            type="button"
            className={styles.filterButton}
            aria-expanded={filtersOpen}
            aria-controls="politici-filters"
            onClick={() => setFiltersOpen((value) => !value)}>
            <Icon name="filter" size={18} />
            <span>Filtri</span>
            {filterCount ? <span className={styles.filterCount}>
              {filterCount}
            </span> : null}
          </button>
          <div className={styles.modeSwitch} role="group" aria-label="Vista mappa o elenco">
            <button type="button" aria-pressed={state.mode === "mappa"} onClick={() => update({ ...state, mode: "mappa" })}>
              <Icon name="map" size={18} />
              <span>Mappa</span>
            </button>
            <button type="button" aria-pressed={state.mode === "elenco"} onClick={() => update({ ...state, mode: "elenco" })}>
              <Icon name="list" size={18} />
              <span>Elenco</span>
            </button>
          </div>
        </div>
        <div className={styles.filters} id="politici-filters" hidden={!filtersOpen}>
          <div>
            <label htmlFor="politici-family">Famiglia politica</label>
            <select id="politici-family" value={state.family ?? ""} onChange={(event) => update({ ...state, family: event.target.value || null })}>
              <option value="">Tutte le famiglie</option>
              {map.partyFamilies.map((family) => <option key={family.id} value={family.id}>
                {family.shortLabel}
              </option>)}
            </select>
          </div>
          <div>
            <label htmlFor="politici-role">Incarico</label>
            <select id="politici-role" value={state.role} onChange={(event) => update({ ...state, role: ROLES.find((role) => role.id === event.target.value)?.id ?? "tutti" })}>
              {ROLES.map((role) => <option key={role.id} value={role.id}>
                {role.label}
              </option>)}
            </select>
          </div>
          <button type="button" className={styles.textButton} disabled={!filterCount} onClick={clearFilters}>Azzera filtri</button>
        </div>
      </div>
      <div className={styles.workspaceScroll}>
        {invalid ? <div className={styles.notice} role="status">La selezione nel link non è presente nei dati disponibili. Stai vedendo {scopeLabel}.<button
          type="button"
          className={styles.iconButton}
          aria-label="Chiudi avviso"
          onClick={() => setInvalid(false)}>
          <Icon name="close" size={16} />
        </button></div> : null}
        {filterCount ? <div className={styles.filterSummary} role="status">
          <span>{people.length} {people.length === 1 ? "persona trovata" : "persone trovate"} · {scopeLabel}</span>
          <button type="button" className={styles.textButton} onClick={clearFilters}>Azzera filtri <Icon name="close" size={14} /></button>
        </div> : null}
        <button type="button" className={styles.mobileDetailsButton} onClick={() => setDetailsOpen(true)}>
          <span>
            {state.selection.kind === "person" ? map.people.find((person) => person.id === selectedId)?.name : state.selection.kind === "group" ? map.groups.find((group) => group.id === selectedGroupId)?.shortLabel : `Conosci ${scopeLabel}`}
          </span>
          <span>Apri scheda <Icon name="arrow" size={16} /></span>
        </button>
        {!people.length && state.scope !== "condanne" ? <Status title="Nessuna persona corrisponde ai filtri">Cambia ricerca, famiglia politica o incarico.<button type="button" className={styles.secondaryButton} onClick={clearFilters}>Mostra tutte le persone</button></Status>
          : state.scope === "condanne" ? <ConvictionsDirectory
            cases={convictions}
            coverageNote={convictionsNote}
            map={map}
            query={state.query}
            selectedId={selectedId}
            onSelect={select} />
            : state.mode === "elenco" ? <MemberDirectory
            key={`${state.scope}:${state.query}:${state.family}:${state.role}`}
            people={people}
            map={map}
            selectedId={selectedId}
            onSelect={select}
            title={`Persone · ${scopeLabel}`} />
            : state.scope === "camera" || state.scope === "senato" ? <Hemicycle
              key={state.scope}
              map={map}
              chamberId={state.scope}
              selection={state.selection}
              matchingIds={matchingIds}
              judicialIds={data.judicialIds}
              onSelect={select}
              news={data.news} />
              : state.scope === "governo" ? <GovernmentView people={people} onSelect={select} />
                : state.scope === "grafo" ? <InstitutionalGraph
                  map={map}
                  selection={state.selection}
                  matchingIds={matchingIds}
                  onSelect={select} />
                  : <RepublicOverview map={map} people={people} onSelect={select} filtered={filterCount > 0} />}
        <div className={styles.workspaceFootnote}>
          <span><span className={styles.liveDot} aria-hidden="true" /> Dati da fonti ufficiali</span>
          <span>Rilevazione più recente: {longDate(map.updatedAt)}</span>
        </div>
      </div>
    </section>
  </div>;
}

function MemberDirectory({ people, map, selectedId, onSelect, title }: { people: RepublicMapPerson[]; map: RepublicMap; selectedId: string | null; onSelect: (selection: GraphSelection) => void; title: string; }) {
  const [limit, setLimit] = useState(40);
  const groups = new Map(map.groups.map((group) => [group.id, group]));
  return <section className={styles.directory} aria-label={title}>
    <div className={styles.chamberHeading}>
      <div>
        <p className={styles.eyebrow}>Ordine alfabetico</p>
        <h2>
          {title}
        </h2>
      </div>
      <span className={styles.tag}>
        {people.length}
      </span>
    </div>
    <ul className={`${styles.directoryList} ${extra.directory}`}>
      {people.slice(0, limit).map((person) => <li key={person.id}>
        <PersonRow
          person={person}
          selected={selectedId === person.id}
          detail={[person.roleLabel, groups.get(person.groupId ?? "")?.shortLabel].filter(Boolean).join(" · ")}
          onSelect={(id) => onSelect({ kind: "person", id })} />
      </li>)}
    </ul>
    {limit < people.length ? <button type="button" className={styles.loadMore} onClick={() => setLimit((value) => value + 40)}>Mostra altre {Math.min(40, people.length - limit)} persone <span>{limit} di {people.length}</span><Icon name="plus" size={18} /></button> : null}
  </section>;
}

function GovernmentView({ people, onSelect }: { people: RepublicMapPerson[]; onSelect: (selection: GraphSelection) => void; }) {
  const leaders = people.filter((person) => person.roleKind === "presidente-del-consiglio" || person.roleKind === "vice-presidente-consiglio");
  const other = people.filter((person) => !leaders.some((leader) => leader.id === person.id));
  return <section className={styles.governmentView} aria-label="Componenti del Governo">
    <div className={styles.chamberHeading}>
      <div>
        <p className={styles.eyebrow}>Potere esecutivo</p>
        <h2>Il Governo</h2>
      </div>
      <span className={styles.tag}>{people.length} persone</span>
    </div>
    <p className={styles.sectionLead}>Incarichi, ministeri e deleghe. Una scheda per ogni componente censito.</p>
    {leaders.length ? <div className={styles.governmentLeaders}>
      {leaders.map((person) => <button type="button" key={person.id} onClick={() => onSelect({ kind: "person", id: person.id })}>
        <Portrait person={person} size={72} />
        <span>
          <small>
            {person.roleLabel}
          </small>
          <strong>
            {person.name}
          </strong>
        </span>
        <Icon name="arrow" />
      </button>)}
    </div> : null}
    <ul className={styles.cabinetGrid}>
      {other.map((person) => <li key={person.id}>
        <button type="button" onClick={() => onSelect({ kind: "person", id: person.id })}>
          <Portrait person={person} size={48} />
          <strong>
            {person.name}
          </strong>
          <span>
            {person.roleLabel}
          </span>
          <Icon name="arrow" size={16} />
        </button>
      </li>)}
    </ul>
  </section>;
}

function RepublicOverview({ map, people, onSelect, filtered }: { map: RepublicMap; people: RepublicMapPerson[]; onSelect: (selection: GraphSelection) => void; filtered: boolean; }) {
  const miniatures = useMemo(() => ({ camera: buildChamberScene(map, "camera"), senato: buildChamberScene(map, "senato") }), [map]);
  return <section className={styles.republicView} aria-label="Panoramica della Repubblica">
    <div className={styles.chamberHeading}>
      <div>
        <p className={styles.eyebrow}>Un atlante delle istituzioni</p>
        <h2>La Repubblica italiana</h2>
      </div>
      <span className={styles.tag}>{map.coverage.people} persone uniche</span>
    </div>
    <p className={styles.sectionLead}>Esplora chi rappresenta i cittadini e chi ricopre gli incarichi. Senza graduatorie di potere.</p>
    {filtered ? <MemberDirectory
      key={people.map((person) => person.id).join(":")}
      people={people}
      map={map}
      selectedId={null}
      onSelect={onSelect}
      title="Risultati in tutte le istituzioni" /> : <div className={styles.institutionGrid}>
      {map.institutions.map((institution) => {
        const leader = map.people.find((person) => person.id === institution.leaderPersonId);
        const chamber = institution.id === "camera" || institution.id === "senato" ? miniatures[institution.id] : null;
        return <button
          key={institution.id}
          type="button"
          className={styles.institutionCard}
          onClick={() => onSelect({ kind: "institution", id: institution.id })}>
          <span className={styles.eyebrow}>
            {institution.role}
          </span>
          <strong>
            {institution.label}
          </strong>
          {chamber ? <svg className={styles.miniature} viewBox={`0 0 ${CHAMBER.width} 435`} aria-hidden="true">
            {chamber.seats.map((seat) => <circle
              key={seat.id}
              cx={seat.x}
              cy={seat.y}
              r="5"
              className={styles.miniSeat}
              data-family={seat.family ?? undefined} />)}
          </svg> : <span className={styles.institutionLeader}>
            {leader ? <>
              <Portrait person={leader} size={64} />
              <span>
                {leader.name}
                <small>
                  {institution.leaderRoleLabel}
                </small>
              </span>
            </> : <Icon name="map" size={64} />}
          </span>}
          <span className={styles.institutionCardFooter}>{institution.memberCount} {institution.memberCount === 1 ? "persona" : "componenti"}<Icon name="arrow" size={18} /></span>
        </button>;
      })}
    </div>}
    <InstitutionalRelations map={map} onSelect={onSelect} />
    <div className={styles.europeLink}>
      <span className={styles.europeMark} aria-hidden="true">EU</span>
      <div>
        <strong>La rappresentanza in Europa</strong>
        <p>Le schede degli eurodeputati non sono ancora integrate in questo atlante (follow-up #566).</p>
        <SourceLink href="https://www.europarl.europa.eu/meps/it/home">Consulta l’elenco ufficiale del Parlamento europeo</SourceLink>
      </div>
    </div>
  </section>;
}

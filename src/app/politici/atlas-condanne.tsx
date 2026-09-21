"use client";

import { useMemo } from "react";
import type { GiudiziarioCase } from "@/lib/data/parlamento-giudiziario-contract";
import { formatSentenceMonths, graphPersonId, OUTCOME_LABELS } from "@/lib/parlamento-giudiziario";
import type { RepublicMap } from "@/lib/politici-repubblica";
import { normalizeSearch, type GraphSelection } from "./atlas-model";
import { Icon, Portrait } from "./atlas-primitives";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

export function ConvictionsDirectory({
  cases,
  coverageNote,
  map,
  query,
  selectedId,
  onSelect,
}: {
  cases: readonly GiudiziarioCase[];
  coverageNote: string;
  map: RepublicMap;
  query: string;
  selectedId: string | null;
  onSelect: (selection: GraphSelection) => void;
}) {
  const peopleByGraphId = useMemo(() => new Map(map.people.map((person) => [person.id, person])), [map.people]);
  const tokens = useMemo(() => normalizeSearch(query).split(" ").filter(Boolean), [query]);
  const visible = useMemo(() => {
    if (!tokens.length) return cases;
    return cases.filter((item) => {
      const haystack = normalizeSearch(`${item.displayName} ${item.title} ${item.offence} ${item.statusLabel} ${item.group}`);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [cases, tokens]);
  const penal = visible.filter((item) => item.outcomeBucket === "condannato").length;
  const accounting = visible.filter((item) => item.outcomeBucket === "contabile").length;

  return <section className={styles.convictionsView} aria-label="Condanne documentate">
    <div className={styles.chamberHeading}>
      <div>
        <p className={styles.eyebrow}>Procedimenti con esito di condanna</p>
        <h2>Condanne documentate</h2>
      </div>
      <span className={styles.tag}>{visible.length}</span>
    </div>
    <p className={styles.sectionLead}>
      Elenco delle condanne penali e della Corte dei conti presenti nello snapshot curato. Una condanna non definitiva
      non è una colpevolezza accertata (art. 27 della Costituzione). Non compare chi non ha una condanna documentata:
      l’assenza da questa lista non certifica un casellario vuoto.
    </p>
    <p className={styles.note}>
      {penal} penali · {accounting} contabili · {coverageNote}
    </p>
    {!visible.length ? <p className={styles.note}>Nessuna condanna corrisponde alla ricerca.</p> : <ul className={`${styles.convictionList} ${extra.directory}`}>
      {visible.map((item) => {
        const personId = graphPersonId(item.memberId);
        const person = personId ? peopleByGraphId.get(personId) : null;
        const sentence = item.outcomeBucket === "condannato" ? formatSentenceMonths(item.latestSentenceMonths) : null;
        const selectable = Boolean(personId && person);
        return <li key={item.caseId}>
          <button
            type="button"
            className={styles.convictionRow}
            data-selected={selectedId && personId === selectedId ? "true" : undefined}
            disabled={!selectable}
            onClick={() => { if (personId) onSelect({ kind: "person", id: personId }); }}>
            {person ? <Portrait person={person} size={44} /> : <span className={styles.convictionInitials} aria-hidden="true">
              {item.displayName.slice(0, 2).toLocaleUpperCase("it-IT")}
            </span>}
            <span className={styles.convictionBody}>
              <span className={styles.convictionName}>
                <strong>{item.displayName}</strong>
                <span className={styles.judicialStatus} data-outcome={item.outcomeBucket}>{item.statusLabel}</span>
                {item.recheck === "da-riverificare" ? (
                  <span className={styles.judicialRecheck}>da riverificare</span>
                ) : null}
              </span>
              <span className={styles.convictionMeta}>
                {item.chamber === "camera" ? "Camera" : "Senato"} · {OUTCOME_LABELS[item.outcomeBucket]} · stato al {item.statusAsOf} · verificato il {item.verifiedAt}
                {sentence ? ` · pena nell'ultima sentenza: ${sentence}` : ""}
              </span>
              <span className={styles.convictionTitle}>{item.title}</span>
              <span className={styles.convictionOffence}>{item.offence}</span>
            </span>
            {selectable ? <Icon name="arrow" size={18} /> : null}
          </button>
        </li>;
      })}
    </ul>}
  </section>;
}

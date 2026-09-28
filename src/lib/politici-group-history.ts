/**
 * Parliamentary group memberships in the XIX legislature (#556), read from the
 * dated adhesions already published in the Camera and Senato snapshots.
 * Pure functions: the graph passes the segments, labels and dates it owns.
 */

export type GroupSegment = { groupId: string; startDate: string; endDate: string | null; };

export type GroupHistoryEntry = {
  groupId: string;
  /** Official name of the group at the start of the segment. */
  label: string;
  /** Official names the group took later while the person was still a member. */
  laterLabels: string[];
  startDate: string;
  /** As published: exclusive at the Camera, inclusive at the Senato; `null` while open. */
  endDate: string | null;
  /** Moved from the Mixed group on the day the new group was formed. */
  joinedAtFormation: boolean;
};

export type GroupHistoryContext = {
  mixedGroupId: string;
  /** First published adhesion to each group in the legislature. */
  formationDateByGroup: ReadonlyMap<string, string>;
  labelsDuring: (groupId: string, startDate: string, endDate: string | null) => string[];
};

/** First adhesion per group across every published membership, current members or not. */
export function formationDates(rows: ReadonlyArray<{ groupId: string; startDate: string; }>): Map<string, string> {
  const dates = new Map<string, string>();
  for (const row of rows) {
    const known = dates.get(row.groupId);
    if (known === undefined || row.startDate < known) dates.set(row.groupId, row.startDate);
  }
  return dates;
}

export function groupHistoryEntries(segments: readonly GroupSegment[], context: GroupHistoryContext): GroupHistoryEntry[] {
  return segments.map((segment, index) => {
    const labels = context.labelsDuring(segment.groupId, segment.startDate, segment.endDate);
    if (labels.length === 0) throw new Error(`denominazione del gruppo ${segment.groupId} assente al ${segment.startDate}`);
    const previous = segments[index - 1];
    return {
      groupId: segment.groupId,
      label: labels[0]!,
      laterLabels: labels.slice(1),
      startDate: segment.startDate,
      endDate: segment.endDate,
      joinedAtFormation: previous !== undefined
        && previous.groupId === context.mixedGroupId
        && context.formationDateByGroup.get(segment.groupId) === segment.startDate,
    };
  });
}

/** A change is leaving a group for another; joining a new group at its formation from the Mixed group is not. */
export function groupChangeCount(entries: readonly GroupHistoryEntry[]): number {
  return entries.filter((entry, index) => index > 0
    && entry.groupId !== entries[index - 1]!.groupId
    && !entry.joinedAtFormation).length;
}

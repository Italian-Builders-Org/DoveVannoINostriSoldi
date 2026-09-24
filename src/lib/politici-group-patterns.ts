type Chamber = "camera" | "senato";

type VoteEvent = {
  voteId: string;
  chamber: Chamber;
  date: string;
  groupVotes: ReadonlyArray<{
    groupId: string | null;
    favorevoli: number;
    contrari: number;
    astenuti: number;
  }>;
};

export type GroupChoice = "F" | "C" | "A" | "pareggio" | "non-determinato";

export type GroupPatternEvent = {
  voteId: string;
  choiceA: GroupChoice;
  choiceB: GroupChoice;
  agreement: boolean | null;
};

function expressedChoice(group: VoteEvent["groupVotes"][number] | undefined): GroupChoice {
  if (!group) return "non-determinato";
  const counts = [group.favorevoli, group.contrari, group.astenuti];
  const max = Math.max(...counts);
  if (max === 0) return "non-determinato";
  if (counts.filter((count) => count === max).length !== 1) return "pareggio";
  return (["F", "C", "A"] as const)[counts.indexOf(max)]!;
}

function isExpressed(choice: GroupChoice): choice is "F" | "C" | "A" {
  return choice === "F" || choice === "C" || choice === "A";
}

export function compareGroupVoteEvents(
  events: readonly VoteEvent[],
  chamber: Chamber,
  groupAId: string,
  groupBId: string,
  year: string | null,
) {
  const chamberEvents = events.filter((event) => event.chamber === chamber);
  if (groupAId === groupBId || (year !== null && !/^\d{4}$/u.test(year))
    || ![groupAId, groupBId].every((id) => chamberEvents.some((event) =>
      event.groupVotes.some((group) => group.groupId === id)))) return null;

  const filtered = chamberEvents.filter((event) => year === null || event.date.startsWith(year));
  const rows: GroupPatternEvent[] = filtered.map((event) => {
    const choiceA = expressedChoice(event.groupVotes.find((group) => group.groupId === groupAId));
    const choiceB = expressedChoice(event.groupVotes.find((group) => group.groupId === groupBId));
    return {
      voteId: event.voteId,
      choiceA,
      choiceB,
      agreement: isExpressed(choiceA) && isExpressed(choiceB) ? choiceA === choiceB : null,
    };
  });
  return {
    chamber,
    groupAId,
    groupBId,
    year,
    events: rows,
    comparableEvents: rows.filter((row) => row.agreement !== null).length,
    commonChoiceEvents: rows.filter((row) => row.agreement === true).length,
    periodStart: filtered.length ? filtered.reduce((date, event) => event.date < date ? event.date : date, filtered[0]!.date) : null,
    periodEnd: filtered.length ? filtered.reduce((date, event) => event.date > date ? event.date : date, filtered[0]!.date) : null,
  };
}

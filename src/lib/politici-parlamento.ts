import cameraJson from "@/data/generated/politici-camera-xix.json";
import senateJson from "@/data/generated/politici-senato-xix.json";
import { parsePoliticiCameraSnapshot } from "@/lib/data/politici-camera-contract";
import {
  parsePoliticiParlamentoSnapshot,
  type ChamberId,
  type PoliticiParlamentoSnapshot,
} from "@/lib/data/politici-parlamento-contract";
import { parsePoliticiSenatoSnapshot } from "@/lib/data/politici-senato-contract";

const camera = parsePoliticiCameraSnapshot(cameraJson);
const senate = parsePoliticiSenatoSnapshot(senateJson);

const GROUP_ALIASES: Array<{ test: RegExp; family: string; short: string }> = [
  { test: /fratelli d['’]italia/iu, family: "fratelli-italia", short: "Fratelli d’Italia" },
  { test: /partito democratico/iu, family: "partito-democratico", short: "Partito Democratico" },
  { test: /lega/iu, family: "lega", short: "Lega" },
  { test: /forza italia/iu, family: "forza-italia", short: "Forza Italia" },
  { test: /movimento 5 stelle/iu, family: "movimento-5-stelle", short: "Movimento 5 Stelle" },
  { test: /alleanza verdi e sinistra/iu, family: "alleanza-verdi-sinistra", short: "Alleanza Verdi e Sinistra" },
  { test: /italia viva/iu, family: "italia-viva", short: "Italia Viva" },
  { test: /azione/iu, family: "azione", short: "Azione" },
  { test: /noi moderati|civici d['’]italia/iu, family: "noi-moderati", short: "Noi Moderati / Civici d’Italia" },
  { test: /^misto$/iu, family: "misto", short: "Misto" },
  { test: /autonomie/iu, family: "autonomie", short: "Per le Autonomie" },
];

function groupIdentity(label: string): { family: string; short: string } {
  return GROUP_ALIASES.find(({ test }) => test.test(label))
    ?? { family: `other-${label.toLocaleLowerCase("it-IT").replaceAll(/[^a-z0-9]+/gu, "-")}`, short: label };
}

function cameraPhotoUrl(sourceId: string): string {
  const numericId = sourceId.replace(/^d/u, "").replace(/_19$/u, "");
  return `https://documenti.camera.it/_dati/leg19/schededeputatinuovosito/fotoDefinitivo/big/d${numericId}.jpg`;
}

function groupId(chamber: ChamberId, sourceId: string): string {
  return `${chamber}:${sourceId}`;
}

function personId(chamber: ChamberId, sourceId: string): string {
  return `${chamber}:${sourceId}`;
}

let cached: PoliticiParlamentoSnapshot | null = null;

export function getPoliticiParlamentoSnapshot(): PoliticiParlamentoSnapshot {
  if (cached) return cached;

  const rawGroups = [
    ...camera.groups.map((group) => {
      const identity = groupIdentity(group.label);
      return {
        id: groupId("camera", group.id),
        sourceId: group.id,
        chamber: "camera" as const,
        uri: group.uri,
        label: group.label,
        shortLabel: identity.short,
        partyFamily: identity.family,
        memberCount: group.memberCount,
        relatedGroupIds: [] as string[],
      };
    }),
    ...senate.groups.map((group) => {
      const identity = groupIdentity(group.label);
      return {
        id: groupId("senato", group.id),
        sourceId: group.id,
        chamber: "senato" as const,
        uri: group.uri,
        label: group.label,
        shortLabel: identity.short,
        partyFamily: identity.family,
        memberCount: group.memberCount,
        relatedGroupIds: [] as string[],
      };
    }),
  ];

  for (const group of rawGroups) {
    group.relatedGroupIds = rawGroups
      .filter((candidate) => candidate.chamber !== group.chamber && candidate.partyFamily === group.partyFamily)
      .map((candidate) => candidate.id);
  }

  const people = [
    ...camera.deputies.map((deputy) => ({
      id: personId("camera", deputy.id),
      sourceId: deputy.id,
      chamber: "camera" as const,
      uri: deputy.uri,
      firstName: deputy.firstName,
      lastName: deputy.lastName,
      displayName: deputy.displayName,
      roleLabel: "Deputato/a",
      gender: deputy.gender ?? null,
      officialPage: (deputy.officialPage ?? deputy.uri).replace(/^http:/u, "https:"),
      photoUrl: cameraPhotoUrl(deputy.id),
      groupId: groupId("camera", deputy.groupId!),
      groupLabel: deputy.groupLabel!,
      biography: `Deputato/a della XIX Legislatura. Aderisce al gruppo ${deputy.groupLabel}. La scheda ufficiale Camera documenta attività, incarichi e atti parlamentari.`,
      birthDate: null,
      birthPlace: null,
    })),
    ...senate.senators.map((senator) => ({
      id: personId("senato", senator.id),
      sourceId: senator.id,
      chamber: "senato" as const,
      uri: senator.uri,
      firstName: senator.firstName,
      lastName: senator.lastName,
      displayName: senator.displayName,
      roleLabel: senator.isLifeSenator ? "Senatore/trice a vita" : "Senatore/trice",
      gender: senator.gender,
      officialPage: senator.officialPage,
      photoUrl: senator.photoUrl,
      groupId: groupId("senato", senator.groupId),
      groupLabel: senator.groupLabel,
      biography: senator.biography,
      birthDate: senator.birthDate,
      birthPlace: senator.birthPlace,
    })),
  ];

  const crossChamberGroupLinks = rawGroups
    .reduce((sum, group) => sum + group.relatedGroupIds.length, 0) / 2;

  cached = parsePoliticiParlamentoSnapshot({
    schemaVersion: 1,
    legislature: { id: "19", label: "XIX Legislatura", startDate: "2022-10-13" },
    coverage: {
      people: people.length,
      cameraMembers: camera.deputies.length,
      senateMembers: senate.senators.length,
      groups: rawGroups.length,
      crossChamberGroupLinks,
    },
    chambers: [
      {
        id: "camera",
        label: "Camera dei deputati",
        memberCount: camera.deputies.length,
        seatCapacity: camera.coverage.seatCapacity,
        vacantSeats: camera.coverage.vacantSeats,
        observedDate: camera.source.acquiredAt.slice(0, 10),
        sourceTitle: camera.source.title,
        sourceUrl: camera.source.landingUrl,
        license: camera.source.license,
      },
      {
        id: "senato",
        label: "Senato della Repubblica",
        memberCount: senate.senators.length,
        seatCapacity: senate.coverage.electedSeatCapacity + senate.coverage.lifeSenators,
        vacantSeats: senate.coverage.vacantElectedSeats,
        observedDate: senate.source.observedDate,
        sourceTitle: senate.source.title,
        sourceUrl: senate.source.landingUrl,
        license: senate.source.license,
      },
    ],
    caveats: [
      ...camera.caveats,
      ...senate.caveats,
      "I collegamenti tra gruppi dei due rami indicano una famiglia politica omologa ricavata dalle denominazioni ufficiali; non implicano identità giuridica, influenza o coordinamento.",
      "Le persone mantengono identificativi distinti per ramo. Nessuna identità è fusa sulla sola somiglianza del nome.",
    ],
    groups: rawGroups,
    people,
  });
  return cached;
}

export function findParliamentPerson(id: string) {
  return getPoliticiParlamentoSnapshot().people.find((person) => person.id === id) ?? null;
}

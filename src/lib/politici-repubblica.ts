import attendanceJson from "@/data/generated/camera-partecipazione-voto.json";
import attiVotiJson from "@/data/generated/camera-atti-voti-xix.json";
import senatoAttiVotiJson from "@/data/generated/senato-atti-voti-xix.json";
import cameraJson from "@/data/generated/politici-camera-xix.json";
import governmentJson from "@/data/generated/governo-meloni.json";
import presidentJson from "@/data/generated/presidente-repubblica.json";
import portraitsJson from "@/data/generated/ritratti-liberi.json";
import senateJson from "@/data/generated/politici-senato-xix.json";
import {
  parseCameraAttiVotiSnapshot,
  type CameraAct,
} from "@/lib/data/camera-atti-voti-contract";
import {
  parseSenatoAttiVotiSnapshot,
  type SenatoAct,
} from "@/lib/data/senato-atti-voti-contract";
import {
  parseCameraPartecipazioneVotoSnapshot,
  type CameraPartecipazioneDeputy,
} from "@/lib/data/camera-partecipazione-voto-contract";
import { parseGovernoSnapshot, type GovernoPerson } from "@/lib/data/governo-meloni-contract";
import { parsePoliticiCameraSnapshot, type CameraDeputy } from "@/lib/data/politici-camera-contract";
import {
  parsePoliticiRepubblicaGraph,
  type ChamberId,
  type PoliticiRepubblicaGraph,
  type RepublicPerson,
  type RoleKind,
} from "@/lib/data/politici-repubblica-contract";
import { parsePoliticiSenatoSnapshot, type SenatoSenator } from "@/lib/data/politici-senato-contract";
import { parsePresidenteRepubblicaSnapshot } from "@/lib/data/presidente-repubblica-contract";
import { parseRitrattiLiberiSnapshot } from "@/lib/data/ritratti-liberi-contract";
import {
  buildEducationDistribution,
  classifyEducation,
  type EducationClassification,
  type EducationDistribution,
} from "@/lib/politici-education";

const camera = parsePoliticiCameraSnapshot(cameraJson);
const senate = parsePoliticiSenatoSnapshot(senateJson);
const government = parseGovernoSnapshot(governmentJson);
const president = parsePresidenteRepubblicaSnapshot(presidentJson);
const freePortraits = parseRitrattiLiberiSnapshot(portraitsJson);
const cameraAttendance = parseCameraPartecipazioneVotoSnapshot(attendanceJson);
const cameraAttiVoti = parseCameraAttiVotiSnapshot(attiVotiJson);
const senatoAttiVoti = parseSenatoAttiVotiSnapshot(senatoAttiVotiJson);

const attendanceByNumericId = new Map(
  cameraAttendance.deputies
    .filter((row): row is CameraPartecipazioneDeputy & { numericId: string } => row.numericId !== null)
    .map((row) => [row.numericId, row]),
);

/**
 * Portraits of the government members who never sat in Parliament: the
 * institutional archives publish none, so a free-licensed file takes their place
 * and carries its own attribution.
 */
const freePortraitByPersona = new Map(
  freePortraits.portraits.map((portrait) => [portrait.personaId, portrait]),
);

/** A published dataset cannot be joined on a guess: an unresolved join must stop the build. */
class GraphError extends Error {}

function require(condition: boolean, message: string): void {
  if (!condition) throw new GraphError(message);
}

// --------------------------------------------------------------------------- //
// Party families: the only bridge between the two chambers
// --------------------------------------------------------------------------- //

const PARTY_FAMILIES: Array<{ test: RegExp; id: string; label: string; shortLabel: string; badge: string }> = [
  { test: /fratelli d['’]italia/iu, id: "fratelli-italia", label: "Fratelli d’Italia", shortLabel: "Fratelli d’Italia", badge: "FdI" },
  { test: /partito democratico/iu, id: "partito-democratico", label: "Partito Democratico", shortLabel: "PD", badge: "PD" },
  { test: /lega/iu, id: "lega", label: "Lega", shortLabel: "Lega", badge: "Lega" },
  { test: /forza italia/iu, id: "forza-italia", label: "Forza Italia", shortLabel: "Forza Italia", badge: "FI" },
  { test: /movimento 5 stelle/iu, id: "movimento-5-stelle", label: "MoVimento 5 Stelle", shortLabel: "M5S", badge: "M5S" },
  { test: /alleanza verdi e sinistra/iu, id: "alleanza-verdi-sinistra", label: "Alleanza Verdi e Sinistra", shortLabel: "AVS", badge: "AVS" },
  { test: /italia viva/iu, id: "italia-viva", label: "Italia Viva — Casa Riformista", shortLabel: "Italia Viva", badge: "IV" },
  { test: /azione/iu, id: "azione", label: "Azione — Popolari europeisti riformatori", shortLabel: "Azione", badge: "Az" },
  { test: /noi moderati|civici d['’]italia/iu, id: "noi-moderati", label: "Noi Moderati / Civici d’Italia", shortLabel: "Noi Moderati", badge: "NM" },
  { test: /autonomie/iu, id: "autonomie", label: "Per le Autonomie", shortLabel: "Autonomie", badge: "Aut" },
  { test: /^misto$/iu, id: "misto", label: "Misto", shortLabel: "Misto", badge: "Misto" },
];

function partyFamily(label: string): { id: string; label: string; shortLabel: string; badge: string } {
  const match = PARTY_FAMILIES.find(({ test }) => test.test(label));
  require(match !== undefined, `famiglia politica non classificata: ${label}`);
  return match!;
}

// --------------------------------------------------------------------------- //
// Institutional weight: one ordered scale drives label, tier and node size
// --------------------------------------------------------------------------- //

const ROLE_ORDER: RoleKind[] = [
  "capo-stato",
  "presidente-del-consiglio",
  "presidente-assemblea",
  "vice-presidente-consiglio",
  "ministro",
  "ministro-senza-portafoglio",
  "vicepresidente-assemblea",
  "vice-ministro",
  "sottosegretario",
  "questore",
  "segretario-presidenza",
  "incarico-gruppo",
  "senatore-a-vita",
  "senatore",
  "deputato",
];

const ROLE_RANK = new Map<RoleKind, number>(ROLE_ORDER.map((kind, index) => [kind, index]));

const TIER_BY_ROLE: Record<RoleKind, number> = {
  "capo-stato": 0,
  "presidente-del-consiglio": 1,
  "presidente-assemblea": 1,
  "vice-presidente-consiglio": 2,
  ministro: 2,
  "ministro-senza-portafoglio": 2,
  "vicepresidente-assemblea": 2,
  "vice-ministro": 2,
  sottosegretario: 2,
  questore: 2,
  "segretario-presidenza": 2,
  "incarico-gruppo": 2,
  "senatore-a-vita": 3,
  senatore: 3,
  deputato: 3,
};

/** Node size in the graph: a single decreasing scale, never a per-case tweak. */
function weightOf(kind: RoleKind): number {
  const rank = ROLE_RANK.get(kind) ?? ROLE_ORDER.length - 1;
  return Math.round((1 - rank / (ROLE_ORDER.length - 1)) * 100) / 100;
}

const CAMERA_ROLE_KINDS: Record<string, RoleKind> = {
  PRESIDENTE: "presidente-assemblea",
  VICEPRESIDENTE: "vicepresidente-assemblea",
  QUESTORE: "questore",
  SEGRETARIO: "segretario-presidenza",
};

const SENATE_ROLE_KINDS: Record<string, RoleKind> = {
  "Presidente del Senato": "presidente-assemblea",
  "Vice Presidente del Senato": "vicepresidente-assemblea",
  "Questore del Senato": "questore",
  "Segretario della Presidenza del Senato": "segretario-presidenza",
};

const GOVERNMENT_ROLE_KINDS: Record<string, RoleKind> = {
  "presidente-del-consiglio": "presidente-del-consiglio",
  "vice-presidente": "vice-presidente-consiglio",
  ministro: "ministro",
  "ministro-senza-portafoglio": "ministro-senza-portafoglio",
  "vice-ministro": "vice-ministro",
  sottosegretario: "sottosegretario",
};

// --------------------------------------------------------------------------- //
// Text normalisation shared with the identity join
// --------------------------------------------------------------------------- //

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("it-IT");
}

/** Camera publishes names and birthplaces in capitals: restore readable casing. */
function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("it-IT")
    .split(/([\s\-’'])/u)
    .map((token) => (/^\p{Ll}/u.test(token) ? token[0]!.toLocaleUpperCase("it-IT") + token.slice(1) : token))
    .join("");
}

/** Function words stay lowercase in a title, unless they open it. */
const LOWERCASE_WORDS = new Set([
  "a", "ad", "al", "alla", "alle", "agli", "ai", "anche", "che", "coi", "col", "come", "con", "contro",
  "da", "dai", "dal", "dalla", "dalle", "degli", "dei", "del", "della", "delle", "di", "e", "ed", "fra",
  "gli", "i", "il", "in", "la", "le", "lo", "nei", "nel", "nella", "nelle", "non", "nonché", "o", "per",
  "presso", "su", "sugli", "sui", "sul", "sulla", "sulle", "tra", "un", "una", "uno",
]);

/** Ordinals of the standing committees and of the legislatures. */
const ROMAN_NUMERAL = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,3}|xiv|xv|xvi{1,3}|xix|xx)$/u;
/** Articles that elide: they stay lowercase and hand the capital to the noun. */
const ELIDED_ARTICLES = new Set(["l", "d", "dell", "sull", "all", "nell", "dall", "quell", "coll", "un"]);
/** Acronyms the official labels write like ordinary words. */
const ACRONYMS = new Set([
  "sars-cov-2", "ap-upm", "pam", "ince", "pnrr", "rai", "nato", "osce", "ue",
  "udc", "maie", "ppe", "svp", "patt", "svp-patt", "psi", "pri", "usei",
]);
/** A vowel closed by an apostrophe is an accent the official label dropped. */
const APOSTROPHE_ACCENT: Record<string, string> = { a: "à", e: "è", i: "ì", o: "ò", u: "ù" };

/**
 * Official labels of organs and offices arrive in capitals with the accents
 * written as apostrophes. Title case keeps the proper nouns they contain
 * ("David Rossi", "Moby Prince") readable, which sentence case would flatten.
 */
function humanizeOrgan(value: string): string {
  const restored = value.replaceAll(/([AEIOU])'(?=\s|$|[,.;:)»"])/gu, (_, vowel: string) =>
    APOSTROPHE_ACCENT[vowel.toLocaleLowerCase("it-IT")]!.toLocaleUpperCase("it-IT"),
  );
  let first = true;
  return restored
    .toLocaleLowerCase("it-IT")
    .split(/(\s+|[(«"])/u)
    .map((token) => {
      if (!/\p{L}/u.test(token)) return token;
      const bare = token.replaceAll(/[^\p{L}\p{N}\-]/gu, "");
      const opening = first;
      first = false;
      if (ACRONYMS.has(bare)) return token.toLocaleUpperCase("it-IT");
      if (!LOWERCASE_WORDS.has(bare) && ROMAN_NUMERAL.test(bare)) return token.toLocaleUpperCase("it-IT");
      if (!opening && LOWERCASE_WORDS.has(bare)) return token;
      // Compound names travel hyphenated ("noi moderati-maie-centro popolare"):
      // every part is a name of its own.
      return token
        .split("-")
        .map((part, index) => humanizeWord(part, opening && index === 0))
        .join("-");
    })
    .join("");
}

function humanizeWord(token: string, opening: boolean): string {
  const bare = token.replaceAll(/[^\p{L}\p{N}]/gu, "");
  if (bare.length === 0) return token;
  if (ACRONYMS.has(bare)) return token.toLocaleUpperCase("it-IT");
  if (!opening && LOWERCASE_WORDS.has(bare)) return token;
  const elision = /^(\p{Ll}+)(['’])(.*)$/u.exec(token);
  if (elision && ELIDED_ARTICLES.has(elision[1]) && !opening) {
    return `${elision[1]}${elision[2]}${capitalize(elision[3])}`;
  }
  return capitalize(token);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toLocaleUpperCase("it-IT") + value.slice(1);
}

function sortKeyOf(lastName: string, firstName: string): string {
  return `${normalizeName(lastName)} ${normalizeName(firstName)}`;
}

// --------------------------------------------------------------------------- //
// Identity join: Camera persona ids for deputies, verified names for senators
// --------------------------------------------------------------------------- //

type Draft = Omit<RepublicPerson, "tier" | "primaryRoleKind" | "primaryRoleLabel" | "weight" | "isGovernmentMember" | "isInstitutionalLeader">;

function governmentJoin(): {
  byDeputyNumericId: Map<string, GovernoPerson>;
  bySenatorId: Map<string, GovernoPerson>;
  unmatched: GovernoPerson[];
} {
  const deputyByNumericId = new Map(camera.deputies.map((deputy) => [deputy.numericId, deputy]));
  const senatorsByName = new Map<string, SenatoSenator[]>();
  for (const senator of senate.senators) {
    const key = normalizeName(senator.displayName);
    senatorsByName.set(key, [...(senatorsByName.get(key) ?? []), senator]);
  }

  const byDeputyNumericId = new Map<string, GovernoPerson>();
  const bySenatorId = new Map<string, GovernoPerson>();
  const unmatched: GovernoPerson[] = [];

  for (const member of government.people) {
    const deputy = deputyByNumericId.get(member.personaId);
    if (deputy) {
      require(
        normalizeName(deputy.displayName) === normalizeName(member.displayName),
        `identità persona incoerente tra Camera e Governo: ${member.displayName} / ${deputy.displayName}`,
      );
      byDeputyNumericId.set(deputy.numericId, member);
      continue;
    }

    const exact = senatorsByName.get(normalizeName(member.displayName)) ?? [];
    require(exact.length <= 1, `omonimia in Senato per un membro del Governo: ${member.displayName}`);
    let senator = exact[0] ?? null;
    if (!senator) {
      // governo.it and the Camera register the legal name; the Senate may publish a
      // longer surname. Accept it only with an identical first name and a unique hit.
      const prefixed = senate.senators.filter(
        (candidate) =>
          normalizeName(candidate.firstName) === normalizeName(member.firstName)
          && normalizeName(candidate.lastName).startsWith(`${normalizeName(member.lastName)} `),
      );
      require(prefixed.length <= 1, `cognome esteso ambiguo in Senato: ${member.displayName}`);
      senator = prefixed[0] ?? null;
    }
    if (senator) {
      require(!bySenatorId.has(senator.id), `senatore già associato a un altro incarico di governo: ${senator.displayName}`);
      bySenatorId.set(senator.id, member);
      continue;
    }
    unmatched.push(member);
  }
  return { byDeputyNumericId, bySenatorId, unmatched };
}

// --------------------------------------------------------------------------- //
// Roles
// --------------------------------------------------------------------------- //

const departmentById = new Map(government.departments.map((department) => [department.id, department]));
const appointmentById = new Map(government.appointments.map((appointment) => [appointment.id, appointment]));

function governmentRoles(member: GovernoPerson): RepublicPerson["roles"] {
  return member.appointmentIds.map((appointmentId) => {
    const appointment = appointmentById.get(appointmentId);
    require(appointment !== undefined, `incarico di governo sconosciuto: ${appointmentId}`);
    const department = departmentById.get(appointment!.departmentId);
    require(department !== undefined, `dicastero sconosciuto: ${appointment!.departmentId}`);
    const kind = GOVERNMENT_ROLE_KINDS[appointment!.roleKind];
    require(kind !== undefined, `ruolo di governo non mappato: ${appointment!.roleKind}`);
    return {
      kind: kind!,
      label: appointment!.interim ? `${appointment!.roleLabel} (ad interim)` : appointment!.roleLabel,
      institutionId: "governo" as const,
      organLabel: department!.displayLabel,
      since: appointment!.since,
    };
  });
}

function chamberRoleLabel(chamber: ChamberId, senator: SenatoSenator | null, deputy: CameraDeputy | null): { kind: RoleKind; label: string } {
  if (chamber === "camera") {
    return { kind: "deputato", label: deputy?.gender === "female" ? "Deputata" : "Deputato" };
  }
  if (senator?.isLifeSenator) {
    return { kind: "senatore-a-vita", label: senator.gender === "F" ? "Senatrice a vita" : "Senatore a vita" };
  }
  return { kind: "senatore", label: senator?.gender === "F" ? "Senatrice" : "Senatore" };
}

// --------------------------------------------------------------------------- //
// Graph assembly
// --------------------------------------------------------------------------- //

let cached: PoliticiRepubblicaGraph | null = null;

export function getRepubblicaGraph(): PoliticiRepubblicaGraph {
  if (cached) return cached;

  const cameraSource = {
    label: camera.source.title,
    url: camera.source.landingUrl,
    license: camera.source.license,
    observedDate: camera.source.acquiredAt.slice(0, 10),
    provenance: "official-sparql-and-official-profiles" as const,
    gap: null,
  };
  const senateSource = {
    label: senate.source.title,
    url: senate.source.landingUrl,
    license: senate.source.license,
    observedDate: senate.source.observedDate,
    provenance: "official-json-exports-and-official-sparql" as const,
    gap: null,
  };
  const governmentSource = {
    label: government.source.title,
    url: government.source.landingUrl,
    license: government.source.license,
    observedDate: government.source.acquiredAt.slice(0, 10),
    provenance: "official-sparql-and-official-roster" as const,
    gap: "governo.it non pubblica i ritratti dei componenti: chi non ha mai avuto un mandato alla Camera resta senza fotografia ufficiale.",
  };
  const presidentSource = {
    label: "Presidenza della Repubblica (carica) e Open Data Camera (identità e ritratto)",
    url: president.source.landingUrl,
    license: president.source.license,
    observedDate: president.source.observedDate,
    provenance: "official-sparql-identity-with-declared-office" as const,
    gap: president.provenance.gap,
  };
  const portraitsSource = {
    label: freePortraits.source.title,
    url: freePortraits.source.landingUrl,
    license: freePortraits.source.license,
    observedDate: freePortraits.source.observedDate,
    provenance: "free-licensed-third-party-media" as const,
    gap: freePortraits.provenance.gap,
  };

  const join = governmentJoin();
  const groups: PoliticiRepubblicaGraph["groups"] = [];

  for (const group of camera.groups) {
    const family = partyFamily(group.displayLabel);
    // A couple of Camera groups have no mixed-case name on the official page:
    // their label arrives in capitals and would shout in every card.
    const label = group.displayLabel === group.displayLabel.toLocaleUpperCase("it-IT")
      ? humanizeOrgan(group.displayLabel)
      : group.displayLabel;
    groups.push({
      id: `camera-${group.id}`,
      sourceId: group.id,
      chamberId: "camera",
      uri: group.uri,
      label,
      shortLabel: family.badge,
      partyFamily: family.id,
      officialPage: group.officialPage,
      memberCount: group.memberCount,
      presidentPersonId: null,
      componentLabels: group.componentLabels ?? [],
      relatedGroupIds: [],
    });
  }
  for (const group of senate.groups) {
    const family = partyFamily(group.label);
    groups.push({
      id: `senato-${group.id}`,
      sourceId: group.id,
      chamberId: "senato",
      uri: group.uri,
      label: group.label,
      shortLabel: family.badge,
      partyFamily: family.id,
      officialPage: senate.source.groupsLandingUrl,
      memberCount: group.memberCount,
      presidentPersonId: null,
      componentLabels: [],
      relatedGroupIds: [],
    });
  }
  for (const group of groups) {
    group.relatedGroupIds = groups
      .filter((candidate) => candidate.chamberId !== group.chamberId && candidate.partyFamily === group.partyFamily)
      .map((candidate) => candidate.id)
      .sort();
  }

  const drafts: Draft[] = [];

  // ----- Capo dello Stato ------------------------------------------------- //
  drafts.push({
    id: `pdr-${president.holder.personaId}`,
    displayName: president.holder.displayName,
    firstName: president.holder.firstName,
    lastName: president.holder.lastName,
    sortKey: sortKeyOf(president.holder.lastName, president.holder.firstName),
    gender: "male",
    photoUrl: president.holder.photoUrl,
    photoCredit: president.holder.photoCredit,
    officialPages: [
      { label: "Presidenza della Repubblica", url: president.office.officialPage },
    ],
    primaryInstitutionId: "presidenza-repubblica",
    chamberId: null,
    groupId: null,
    groupLabel: null,
    groupShortLabel: null,
    partyFamily: null,
    componentLabel: null,
    groupRoleLabel: null,
    roles: [
      {
        kind: "capo-stato",
        label: president.office.role,
        institutionId: "presidenza-repubblica",
        organLabel: president.office.institutionLabel,
        since: president.office.secondTermSince ?? president.office.since,
      },
    ],
    departmentIds: [],
    organLabels: [],
    constituency: null,
    college: null,
    profession: null,
    birthDate: null,
    birthPlace: null,
    socialLinks: null,
    biography: president.holder.biography,
    isGroupLeader: false,
  });

  // ----- Camera ----------------------------------------------------------- //
  const organById = new Map(camera.organs.map((organ) => [organ.id, organ]));
  for (const deputy of camera.deputies) {
    const group = groups.find((candidate) => candidate.id === `camera-${deputy.groupId}`);
    require(group !== undefined, `gruppo Camera sconosciuto: ${deputy.groupId}`);
    const member = join.byDeputyNumericId.get(deputy.numericId) ?? null;
    const base = chamberRoleLabel("camera", null, deputy);
    const roles: RepublicPerson["roles"] = [
      { kind: base.kind, label: base.label, institutionId: "camera", organLabel: null, since: null },
    ];
    if (deputy.institutionalRole) {
      const kind = CAMERA_ROLE_KINDS[deputy.institutionalRole.role];
      require(kind !== undefined, `carica Camera non mappata: ${deputy.institutionalRole.role}`);
      roles.push({
        kind: kind!,
        label: deputy.institutionalRole.label,
        institutionId: "camera",
        organLabel: humanizeOrgan(deputy.institutionalRole.organ),
        since: deputy.institutionalRole.since,
      });
    }
    if (deputy.groupRoleLabel) {
      roles.push({
        kind: "incarico-gruppo",
        label: deputy.groupRoleLabel,
        institutionId: "camera",
        organLabel: group!.label,
        since: deputy.groupSince,
      });
    }
    if (member) roles.push(...governmentRoles(member));

    drafts.push({
      id: `dep-${deputy.numericId}`,
      displayName: deputy.displayName,
      firstName: titleCase(deputy.firstName),
      lastName: titleCase(deputy.lastName),
      sortKey: sortKeyOf(deputy.lastName, deputy.firstName),
      gender: deputy.gender,
      photoUrl: deputy.photoUrl,
      photoCredit: "Camera dei deputati — ritratto ufficiale XIX legislatura",
      officialPages: [
        { label: "Scheda Camera", url: deputy.officialPage },
        ...(member?.officialPage ? [{ label: "Scheda governo.it", url: member.officialPage }] : []),
      ],
      primaryInstitutionId: member ? "governo" : "camera",
      chamberId: "camera",
      groupId: group!.id,
      groupLabel: group!.label,
      groupShortLabel: group!.shortLabel,
      partyFamily: group!.partyFamily,
      componentLabel: deputy.componentLabel,
      groupRoleLabel: deputy.groupRoleLabel,
      roles,
      departmentIds: member ? [...new Set(member.appointmentIds.map((id) => appointmentById.get(id)!.departmentId))] : [],
      organLabels: deputy.organIds.map((organId) => humanizeOrgan(organById.get(organId)!.label)),
      constituency: deputy.constituency,
      college: deputy.college,
      profession: deputy.professionNote,
      birthDate: deputy.birthDate,
      birthPlace: deputy.birthPlace ? titleCase(deputy.birthPlace) : null,
      socialLinks: deputy.socialLinks,
      biography: member ? `${deputy.biography} ${member.biography}` : deputy.biography,
      isGroupLeader: deputy.groupRole === "PRESIDENTE",
    });
  }

  // ----- Senato ----------------------------------------------------------- //
  for (const senator of senate.senators) {
    const group = groups.find((candidate) => candidate.id === `senato-${senator.groupId}`);
    require(group !== undefined, `gruppo Senato sconosciuto: ${senator.groupId}`);
    const member = join.bySenatorId.get(senator.id) ?? null;
    const base = chamberRoleLabel("senato", senator, null);
    const roles: RepublicPerson["roles"] = [
      { kind: base.kind, label: base.label, institutionId: "senato", organLabel: null, since: null },
    ];
    if (senator.institutionalRole) {
      const kind = SENATE_ROLE_KINDS[senator.institutionalRole.role];
      require(kind !== undefined, `carica Senato non mappata: ${senator.institutionalRole.role}`);
      roles.push({
        kind: kind!,
        label: senator.institutionalRole.label,
        institutionId: "senato",
        organLabel: "Consiglio di Presidenza del Senato",
        since: senator.institutionalRole.since,
      });
    }
    if (senator.groupRoleLabel) {
      roles.push({
        kind: "incarico-gruppo",
        label: senator.groupRoleLabel,
        institutionId: "senato",
        organLabel: group!.label,
        since: null,
      });
    }
    if (member) roles.push(...governmentRoles(member));

    drafts.push({
      id: `sen-${senator.id}`,
      displayName: senator.displayName,
      firstName: senator.firstName,
      lastName: senator.lastName,
      sortKey: sortKeyOf(senator.lastName, senator.firstName),
      gender: senator.gender === "F" ? "female" : "male",
      photoUrl: senator.photoUrl,
      photoCredit: "Senato della Repubblica — ritratto ufficiale XIX legislatura",
      officialPages: [
        { label: "Scheda Senato", url: senator.officialPage },
        ...(member?.officialPage ? [{ label: "Scheda governo.it", url: member.officialPage }] : []),
      ],
      primaryInstitutionId: member ? "governo" : "senato",
      chamberId: "senato",
      groupId: group!.id,
      groupLabel: group!.label,
      groupShortLabel: group!.shortLabel,
      partyFamily: group!.partyFamily,
      componentLabel: null,
      groupRoleLabel: senator.groupRoleLabel,
      roles,
      departmentIds: member ? [...new Set(member.appointmentIds.map((id) => appointmentById.get(id)!.departmentId))] : [],
      organLabels: [],
      constituency: senator.region,
      college: senator.college,
      profession: senator.profession,
      birthDate: senator.birthDate,
      birthPlace: senator.birthPlace,
      socialLinks: null,
      biography: member ? `${senator.biography} ${member.biography}` : senator.biography,
      isGroupLeader: senator.groupRole === "Presidente",
    });
  }

  // ----- Governo non parlamentare ----------------------------------------- //
  for (const member of join.unmatched) {
    const freePortrait = freePortraitByPersona.get(member.personaId) ?? null;
    drafts.push({
      id: `gov-${member.personaId}`,
      displayName: member.displayName,
      firstName: member.firstName,
      lastName: member.lastName,
      sortKey: sortKeyOf(member.lastName, member.firstName),
      gender: null,
      photoUrl: member.photoUrl ?? freePortrait?.photoUrl ?? null,
      photoCredit: member.photoUrl
        ? `Camera dei deputati — archivio ritratti ${member.cameraLegislature}ª legislatura`
        : freePortrait?.credit ?? null,
      officialPages: member.officialPage
        ? [{ label: "Scheda governo.it", url: member.officialPage }]
        : [{ label: "Elenco ministri e sottosegretari", url: government.source.rosterUrl }],
      primaryInstitutionId: "governo",
      chamberId: null,
      groupId: null,
      groupLabel: null,
      groupShortLabel: null,
      partyFamily: null,
      componentLabel: null,
      groupRoleLabel: null,
      roles: governmentRoles(member),
      departmentIds: [...new Set(member.appointmentIds.map((id) => appointmentById.get(id)!.departmentId))],
      organLabels: [],
      constituency: null,
      college: null,
      profession: member.professionNote,
      birthDate: null,
      birthPlace: null,
      socialLinks: null,
      biography: member.biography,
      isGroupLeader: false,
    });
  }

  // ----- Derived facets --------------------------------------------------- //
  const people: RepublicPerson[] = drafts
    .map((draft) => {
      const sorted = [...draft.roles].sort(
        (a, b) => (ROLE_RANK.get(a.kind) ?? 99) - (ROLE_RANK.get(b.kind) ?? 99),
      );
      const primary = sorted[0]!;
      return {
        ...draft,
        roles: sorted,
        tier: TIER_BY_ROLE[primary.kind],
        primaryRoleKind: primary.kind,
        primaryRoleLabel: primary.label,
        weight: weightOf(primary.kind),
        isGovernmentMember: draft.departmentIds.length > 0,
        isInstitutionalLeader: sorted.some(
          (role) =>
            role.kind === "capo-stato"
            || role.kind === "presidente-del-consiglio"
            || role.kind === "presidente-assemblea",
        ),
      };
    })
    .sort((a, b) => a.tier - b.tier || b.weight - a.weight || a.sortKey.localeCompare(b.sortKey, "it"));

  for (const group of groups) {
    const leader = people.find((person) => person.groupId === group.id && person.isGroupLeader);
    group.presidentPersonId = leader?.id ?? null;
  }

  const leaderOf = (kind: RoleKind, institutionId: string) =>
    people.find((person) => person.roles.some((role) => role.kind === kind && role.institutionId === institutionId)) ?? null;

  const headOfState = leaderOf("capo-stato", "presidenza-repubblica");
  const primeMinister = leaderOf("presidente-del-consiglio", "governo");
  const cameraPresident = leaderOf("presidente-assemblea", "camera");
  const senatePresident = leaderOf("presidente-assemblea", "senato");
  require(headOfState !== null, "capo dello Stato assente");
  require(primeMinister !== null, "Presidente del Consiglio assente");
  require(cameraPresident !== null, "Presidente della Camera assente");
  require(senatePresident !== null, "Presidente del Senato assente");

  const institutions: PoliticiRepubblicaGraph["institutions"] = [
    {
      id: "presidenza-repubblica",
      kind: "capo-stato",
      tier: 0,
      label: "Presidenza della Repubblica",
      shortLabel: "Quirinale",
      role: "Capo dello Stato",
      description:
        "Rappresenta l’unità nazionale, nomina il Presidente del Consiglio e i ministri, promulga le leggi e presiede il Consiglio superiore della magistratura.",
      officialPage: president.office.officialPage,
      memberCount: 1,
      seatCapacity: 1,
      vacantSeats: 0,
      leaderPersonId: headOfState!.id,
      leaderRoleLabel: president.office.role,
      source: presidentSource,
    },
    {
      id: "governo",
      kind: "governo",
      tier: 1,
      label: government.government.label,
      shortLabel: "Governo",
      role: "Potere esecutivo",
      description:
        "Il Consiglio dei ministri dirige la politica generale, esercita il potere esecutivo e risponde alla fiducia delle due Camere.",
      officialPage: government.government.landingUrl,
      memberCount: government.coverage.people,
      seatCapacity: null,
      vacantSeats: null,
      leaderPersonId: primeMinister!.id,
      leaderRoleLabel: "Presidente del Consiglio dei ministri",
      source: governmentSource,
    },
    {
      id: "camera",
      kind: "assemblea",
      tier: 2,
      label: "Camera dei deputati",
      shortLabel: "Camera",
      role: "Ramo del Parlamento",
      description:
        "400 deputati eletti a suffragio universale: vota la fiducia, approva le leggi in prima o seconda lettura e controlla l’operato del Governo.",
      officialPage: "https://www.camera.it/",
      memberCount: camera.coverage.deputies,
      seatCapacity: camera.coverage.seatCapacity,
      vacantSeats: camera.coverage.vacantSeats,
      leaderPersonId: cameraPresident!.id,
      leaderRoleLabel: "Presidente della Camera dei deputati",
      source: cameraSource,
    },
    {
      id: "senato",
      kind: "assemblea",
      tier: 2,
      label: "Senato della Repubblica",
      shortLabel: "Senato",
      role: "Ramo del Parlamento",
      description:
        "200 senatori elettivi più i senatori a vita: esercita la stessa funzione legislativa della Camera in un bicameralismo perfetto.",
      officialPage: "https://www.senato.it/",
      memberCount: senate.coverage.senators,
      seatCapacity: senate.coverage.electedSeatCapacity + senate.coverage.lifeSenators,
      vacantSeats: senate.coverage.vacantElectedSeats,
      leaderPersonId: senatePresident!.id,
      leaderRoleLabel: "Presidente del Senato della Repubblica",
      source: senateSource,
    },
  ];

  // ----- Relations -------------------------------------------------------- //
  const edges: PoliticiRepubblicaGraph["edges"] = [
    {
      id: "gerarchia-quirinale-governo",
      kind: "gerarchia",
      source: "presidenza-repubblica",
      target: "governo",
      label: "Nomina il Presidente del Consiglio e i ministri",
      weight: 3,
    },
    {
      id: "gerarchia-quirinale-camera",
      kind: "gerarchia",
      source: "presidenza-repubblica",
      target: "camera",
      label: "Promulga le leggi e può sciogliere la Camera",
      weight: 2,
    },
    {
      id: "gerarchia-quirinale-senato",
      kind: "gerarchia",
      source: "presidenza-repubblica",
      target: "senato",
      label: "Promulga le leggi e può sciogliere il Senato",
      weight: 2,
    },
    {
      id: "gerarchia-governo-camera",
      kind: "gerarchia",
      source: "governo",
      target: "camera",
      label: "Rapporto di fiducia",
      weight: 3,
    },
    {
      id: "gerarchia-governo-senato",
      kind: "gerarchia",
      source: "governo",
      target: "senato",
      label: "Rapporto di fiducia",
      weight: 3,
    },
  ];

  for (const institution of institutions) {
    if (!institution.leaderPersonId || !institution.leaderRoleLabel) continue;
    edges.push({
      id: `vertice-${institution.id}`,
      kind: "vertice-istituzionale",
      source: institution.id,
      target: institution.leaderPersonId,
      label: institution.leaderRoleLabel,
      weight: 3,
    });
  }

  for (const group of groups) {
    edges.push({
      id: `gruppo-${group.id}`,
      kind: "gruppo-assemblea",
      source: group.chamberId,
      target: group.id,
      label: `${group.memberCount} component${group.memberCount === 1 ? "e" : "i"}`,
      weight: 1,
    });
  }

  const familyPairs = new Set<string>();
  for (const group of groups) {
    for (const relatedId of group.relatedGroupIds) {
      const pair = [group.id, relatedId].sort().join("|");
      if (familyPairs.has(pair)) continue;
      familyPairs.add(pair);
      const [source, target] = pair.split("|") as [string, string];
      edges.push({
        id: `famiglia-${pair}`,
        kind: "famiglia-politica",
        source,
        target,
        label: "Stessa famiglia politica nei due rami",
        weight: 2,
      });
    }
  }

  for (const person of people) {
    if (!person.isGovernmentMember) continue;
    edges.push({
      id: `governo-${person.id}`,
      kind: "incarico-governo",
      source: "governo",
      target: person.id,
      label: person.primaryRoleLabel,
      weight: 2,
    });
  }

  const familyCounts = new Map<string, { members: number; chambers: Set<ChamberId> }>();
  for (const person of people) {
    if (!person.partyFamily || !person.chamberId) continue;
    const entry = familyCounts.get(person.partyFamily) ?? { members: 0, chambers: new Set<ChamberId>() };
    entry.members += 1;
    entry.chambers.add(person.chamberId);
    familyCounts.set(person.partyFamily, entry);
  }

  const partyFamilies = [...familyCounts.entries()]
    .map(([id, entry]) => {
      const family = PARTY_FAMILIES.find((candidate) => candidate.id === id)!;
      return {
        id,
        label: family.label,
        shortLabel: family.shortLabel,
        memberCount: entry.members,
        chamberIds: [...entry.chambers].sort(),
      };
    })
    .sort((a, b) => b.memberCount - a.memberCount || a.label.localeCompare(b.label, "it"));

  const withoutPhoto = people.filter((person) => person.photoUrl === null);

  cached = parsePoliticiRepubblicaGraph({
    schemaVersion: 1,
    legislature: { id: "19", label: "XIX Legislatura", startDate: "2022-10-13" },
    updatedAt: [cameraSource, senateSource, governmentSource, presidentSource, portraitsSource]
      .map((source) => source.observedDate)
      .sort()
      .at(-1)!,
    coverage: {
      people: people.length,
      deputies: camera.coverage.deputies,
      senators: senate.coverage.senators,
      governmentMembers: government.coverage.people,
      nonParliamentaryGovernmentMembers: join.unmatched.length,
      groups: groups.length,
      departments: government.coverage.departments,
      institutionalLeaders: people.filter((person) => person.isInstitutionalLeader).length,
      peopleWithPhoto: people.length - withoutPhoto.length,
      peopleWithBiography: people.filter((person) => person.biography.length > 0).length,
      crossChamberFamilyLinks: familyPairs.size,
    },
    institutions,
    groups,
    departments: government.departments.map((department) => ({
      id: department.id,
      kind: department.kind,
      label: department.displayLabel,
      memberCount: department.memberCount,
    })),
    people,
    edges,
    partyFamilies,
    caveats: [
      ...camera.caveats,
      ...senate.caveats,
      ...government.caveats,
      ...president.caveats,
      ...freePortraits.caveats,
      "Le persone sono unificate sull’identità persona pubblicata dalla Camera per i deputati e sul nome verificato per i senatori con incarico di governo: nessuna fusione avviene su semplice somiglianza.",
      withoutPhoto.length === 0
        ? "Ogni persona della mappa ha un ritratto: dagli archivi ufficiali di Camera e Senato o, per i membri del Governo mai eletti, da un file a licenza libera con autore citato."
        : `Restano senza ritratto ${withoutPhoto.length} component${withoutPhoto.length === 1 ? "e" : "i"} del Governo mai eletti in Parlamento: ${withoutPhoto
            .map((person) => person.displayName)
            .join(", ")}. Al loro posto compare un monogramma, non una fotografia dedotta.`,
      "I collegamenti tra gruppi dei due rami indicano una famiglia politica omologa ricavata dalle denominazioni ufficiali: non implicano identità giuridica né coordinamento.",
      "La gerarchia istituzionale rappresentata è quella costituzionale (nomina, fiducia, promulgazione) e non misura influenza politica.",
      "La guida dei partiti come organizzazioni (segretari, presidenti, portavoce) non è pubblicata in forma verificabile da fonti istituzionali: la mappa mostra invece la leadership dei gruppi parlamentari, che è di fonte ufficiale.",
    ],
    sources: [cameraSource, senateSource, governmentSource, presidentSource, portraitsSource],
  });

  return cached;
}

export function findRepublicPerson(id: string): RepublicPerson | null {
  return getRepubblicaGraph().people.find((person) => person.id === id) ?? null;
}

// --------------------------------------------------------------------------- //
// Reading models for the client: a compact map plus profiles fetched on demand
// --------------------------------------------------------------------------- //

export type RepublicMapPerson = {
  id: string;
  name: string;
  tier: number;
  roleKind: RoleKind;
  roleLabel: string;
  chamberId: ChamberId | null;
  groupId: string | null;
  family: string | null;
  weight: number;
  government: boolean;
  leader: boolean;
  groupLeader: boolean;
  photo: boolean;
};

export type RepublicMap = {
  legislature: PoliticiRepubblicaGraph["legislature"];
  updatedAt: string;
  coverage: PoliticiRepubblicaGraph["coverage"];
  institutions: Array<Pick<PoliticiRepubblicaGraph["institutions"][number],
    "id" | "kind" | "tier" | "label" | "shortLabel" | "role" | "description" | "officialPage" | "memberCount" | "seatCapacity" | "vacantSeats" | "leaderPersonId" | "leaderRoleLabel">>;
  groups: Array<Pick<PoliticiRepubblicaGraph["groups"][number],
    "id" | "chamberId" | "label" | "shortLabel" | "partyFamily" | "officialPage" | "memberCount" | "presidentPersonId" | "componentLabels" | "relatedGroupIds">>;
  departments: PoliticiRepubblicaGraph["departments"];
  partyFamilies: PoliticiRepubblicaGraph["partyFamilies"];
  edges: PoliticiRepubblicaGraph["edges"];
  people: RepublicMapPerson[];
  /** Formation areas from official profession notes (#549). */
  education: {
    all: EducationDistribution;
    camera: EducationDistribution;
    senato: EducationDistribution;
    governo: EducationDistribution;
  };
};

export type RepublicVoteAttendance = {
  chamber: "camera";
  periodLabel: string;
  observedDate: string;
  votesCast: number;
  votesCastPercent: string;
  missions: number;
  missionsPercent: string;
  presenceTotal: number;
  presencePercent: string;
  absences: number;
  absencesPercent: string;
  justifiedAbsences: number;
  justifiedAbsencesPercent: string;
  sourceUrl: string;
  sourceLabel: string;
};

/** Nominal vote position. N/V only exist at the Camera, P/M only at the Senato;
 * "non-rilevato" = the person is absent from every official list of that vote. */
export type RepublicActVote = "F" | "C" | "A" | "N" | "V" | "P" | "M" | "non-rilevato";

export type RepublicActSummary = {
  id: string;
  chamber: "camera" | "senato";
  number: string;
  title: string | null;
  natureId: CameraAct["natureId"] | SenatoAct["natureId"];
  presentedDate: string | null;
  role: "primo-firmatario" | "cofirmatario" | "votante";
  initiative: { kind: "parliamentary" | "government"; label: string } | null;
  proposer:
    | { kind: "deputy"; id: string; label: string }
    | { kind: "senator"; id: string; label: string }
    | { kind: "government"; label: string }
    | null;
  responsibleGovernment: { id: string; label: string; uri: string } | { label: string } | null;
  currentState: string | null;
  currentStateDate: string | null;
  /** Senato only: branch (S/C) of the current phase, so the UI can say "alla Camera". */
  currentStateRamo?: "S" | "C";
  outcomeClass: string | null;
  coSignerCount: number;
  officialPage: string;
  /** Senato only: the bill's phases ordered by progressivoIter. */
  phases?: Array<{
    fase: string;
    ramo: "S" | "C";
    kind: "presentato" | "trasmesso";
    presentedDate: string;
    state: string;
    stateDate: string;
  }>;
  finalVotes: Array<{
    id: string;
    date: string;
    approved: boolean;
    confidenceVote: boolean;
    favorevoli: number;
    contrari: number;
    astenuti: number;
    /** Senato only: official vote kind (e.g. "elettronica", "segreta"). */
    voteType?: string;
    ownVote: RepublicActVote;
  }>;
};

export type RepublicLegislativeSource = {
  chamber: "camera" | "senato";
  periodLabel: string;
  observedDate: string;
  sourceUrl: string;
  sourceLabel: string;
  licenseLabel: string;
  coverage: {
    acts: number;
    finalVotesIncluded: number;
    finalVotesExcluded: number;
  };
  outcomeClasses: Array<{ id: string; label: string }>;
  caveats: string[];
};

export type RepublicLegislativeActivity = {
  chamber: "camera" | "senato";
  counts: {
    firstSigned: number;
    coSigned: number;
    total: number;
    becameLaw: number;
    withFinalVote: number;
    byOutcome: Array<{ outcomeClass: string; firstSigned: number; coSigned: number }>;
  };
  comparison: {
    chamberSize: number;
    chamberMedianFirstSigned: number;
    chamberMedianCoSigned: number;
    groupLabel: string | null;
    groupSize: number | null;
    groupMedianFirstSigned: number | null;
    groupMedianCoSigned: number | null;
  };
  recentFirstSigned: RepublicActSummary[];
};

export type RepublicProfile = {
  firstName: string;
  lastName: string;
  gender: RepublicPerson["gender"];
  photoCredit: string | null;
  officialPages: RepublicPerson["officialPages"];
  institutionId: RepublicPerson["primaryInstitutionId"];
  groupLabel: string | null;
  componentLabel: string | null;
  groupRoleLabel: string | null;
  roles: RepublicPerson["roles"];
  departmentIds: string[];
  organLabels: string[];
  constituency: string | null;
  college: string | null;
  profession: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  socialLinks: RepublicPerson["socialLinks"];
  biography: string;
  /** Deterministic area from official profession/biography notes (#549). */
  education: EducationClassification;
  /** Official Camera participation-to-vote row, only when a unique match exists. */
  voteAttendance: RepublicVoteAttendance | null;
  /** Signed acts, iter and final votes; only for members of Camera or Senato. */
  legislativeActivity: RepublicLegislativeActivity | null;
};

function profileAttendanceFor(person: RepublicPerson): RepublicVoteAttendance | null {
  if (person.chamberId !== "camera" || !person.id.startsWith("dep-")) return null;
  const numericId = person.id.slice("dep-".length);
  const row = attendanceByNumericId.get(numericId);
  if (!row) return null;
  return {
    chamber: "camera",
    periodLabel: cameraAttendance.period.label,
    observedDate: cameraAttendance.period.observedDate,
    votesCast: row.votesCast,
    votesCastPercent: row.votesCastPercent,
    missions: row.missions,
    missionsPercent: row.missionsPercent,
    presenceTotal: row.presenceTotal,
    presencePercent: row.presencePercent,
    absences: row.absences,
    absencesPercent: row.absencesPercent,
    justifiedAbsences: row.justifiedAbsences,
    justifiedAbsencesPercent: row.justifiedAbsencesPercent,
    sourceUrl: cameraAttendance.source.pageUrl,
    sourceLabel: "Camera dei deputati — partecipazione al voto",
  };
}

// --------------------------------------------------------------------------- //
// Signed acts and final votes: per-member statistics inside each chamber's
// roster (Camera and Senato are never mixed in the same comparison)
// --------------------------------------------------------------------------- //

const cameraVoteById = new Map(cameraAttiVoti.finalVotes.map((vote) => [vote.id, vote]));
const senatoVoteById = new Map(senatoAttiVoti.finalVotes.map((vote) => [vote.id, vote]));
const deputyByNumericId = new Map(camera.deputies.map((deputy) => [deputy.numericId, deputy]));
const senatorByNumericId = new Map(
  senate.senators.map((senator) => [senator.uri.split("/").pop()!, senator]),
);

function deputyNumericId(signerId: string): string {
  return signerId.replace(/^d/u, "").replace(/_19$/u, "");
}

function medianOf(values: number[]): number {
  require(values.length > 0, "mediana su elenco vuoto");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(median * 10) / 10;
}

type LegislativeIndex<A> = {
  firstActsByNumericId: Map<string, A[]>;
  coActsByNumericId: Map<string, A[]>;
  groupStats: Map<string, { size: number; medianFirst: number; medianCo: number }>;
  chamberMedianFirst: number;
  chamberMedianCo: number;
};

function buildLegislativeIndex<A extends { coSignerIds: string[]; presentedDate: string | null; number: string }>(
  acts: A[],
  roster: Array<{ numericId: string; groupId: string }>,
  firstSignerId: (act: A) => string | null,
  signerNumericId: (signerId: string) => string,
  sortNumber: (act: A) => number,
): LegislativeIndex<A> {
  const compare = (left: A, right: A): number => {
    const dateOrder = (right.presentedDate ?? "").localeCompare(left.presentedDate ?? "");
    if (dateOrder !== 0) return dateOrder;
    const numberOrder = sortNumber(right) - sortNumber(left);
    if (numberOrder !== 0) return numberOrder;
    return right.number.localeCompare(left.number);
  };
  const firstActsByNumericId = new Map<string, A[]>();
  const coActsByNumericId = new Map<string, A[]>();
  const appendAct = (index: Map<string, A[]>, key: string, act: A): void => {
    const list = index.get(key);
    if (list) list.push(act);
    else index.set(key, [act]);
  };
  for (const act of acts) {
    const firstSigner = firstSignerId(act);
    if (firstSigner !== null) {
      appendAct(firstActsByNumericId, signerNumericId(firstSigner), act);
    }
    for (const signerId of act.coSignerIds) {
      appendAct(coActsByNumericId, signerNumericId(signerId), act);
    }
  }
  for (const list of firstActsByNumericId.values()) list.sort(compare);
  for (const list of coActsByNumericId.values()) list.sort(compare);

  const firstCounts: number[] = [];
  const coCounts: number[] = [];
  const byGroup = new Map<string, { first: number[]; co: number[] }>();
  for (const member of roster) {
    const first = firstActsByNumericId.get(member.numericId)?.length ?? 0;
    const co = coActsByNumericId.get(member.numericId)?.length ?? 0;
    firstCounts.push(first);
    coCounts.push(co);
    const bucket = byGroup.get(member.groupId) ?? { first: [], co: [] };
    bucket.first.push(first);
    bucket.co.push(co);
    byGroup.set(member.groupId, bucket);
  }
  const groupStats = new Map<string, { size: number; medianFirst: number; medianCo: number }>();
  for (const [groupId, bucket] of byGroup) {
    groupStats.set(groupId, {
      size: bucket.first.length,
      medianFirst: medianOf(bucket.first),
      medianCo: medianOf(bucket.co),
    });
  }
  return {
    firstActsByNumericId,
    coActsByNumericId,
    groupStats,
    chamberMedianFirst: medianOf(firstCounts),
    chamberMedianCo: medianOf(coCounts),
  };
}

const senateRoster = senate.senators.map((senator) => ({
  numericId: senator.uri.split("/").pop()!,
  groupId: senator.groupId,
}));

let cameraLegislativeIndex: LegislativeIndex<CameraAct> | null = null;
let senatoLegislativeIndex: LegislativeIndex<SenatoAct> | null = null;
let cameraVotedActsByNumericId: Map<string, CameraAct[]> | null = null;
let senatoVotedActsByNumericId: Map<string, SenatoAct[]> | null = null;

function getCameraLegislativeIndex(): LegislativeIndex<CameraAct> {
  cameraLegislativeIndex ??= buildLegislativeIndex(
    cameraAttiVoti.acts,
    camera.deputies.map((deputy) => ({ numericId: deputy.numericId, groupId: deputy.groupId })),
    (act) => act.proposer.kind === "deputy" ? act.proposer.deputyId : null,
    deputyNumericId,
    (act) => act.baseNumber,
  );
  return cameraLegislativeIndex;
}

function getCameraVotedActsByNumericId(): Map<string, CameraAct[]> {
  cameraVotedActsByNumericId ??= buildVotedActsByNumericId(
    cameraAttiVoti.acts,
    cameraVoteById,
    (act) => act.baseNumber,
  );
  return cameraVotedActsByNumericId;
}

function buildVotedActsByNumericId<
  A extends { id: string; finalVoteIds: string[]; number: string },
  V extends { date: string; votes: Record<string, unknown> },
>(acts: A[], voteById: Map<string, V>, sortNumber: (act: A) => number): Map<string, A[]> {
  const index = new Map<string, Map<string, A>>();
  const latestVoteDateByActId = new Map<string, string>();
  for (const act of acts) {
    let latestVoteDate = "";
    for (const voteId of act.finalVoteIds) {
      const vote = voteById.get(voteId);
      require(vote !== undefined, `votazione finale non risolta: ${voteId}`);
      if (vote!.date > latestVoteDate) latestVoteDate = vote!.date;
      for (const numericId of Object.keys(vote!.votes)) {
        const memberActs = index.get(numericId) ?? new Map<string, A>();
        memberActs.set(act.id, act);
        index.set(numericId, memberActs);
      }
    }
    if (act.finalVoteIds.length > 0) latestVoteDateByActId.set(act.id, latestVoteDate);
  }
  return new Map(
    [...index].map(([numericId, memberActs]) => [
      numericId,
      [...memberActs.values()].sort((left, right) =>
        latestVoteDateByActId.get(right.id)!.localeCompare(latestVoteDateByActId.get(left.id)!) ||
        sortNumber(right) - sortNumber(left) ||
        right.number.localeCompare(left.number),
      ),
    ]),
  );
}

function getSenatoLegislativeIndex(): LegislativeIndex<SenatoAct> {
  senatoLegislativeIndex ??= buildLegislativeIndex(
    senatoAttiVoti.acts,
    senateRoster,
    (act) => act.firstSignerId,
    (signerId) => signerId,
    (act) => Number.parseInt(act.number.slice(2), 10),
  );
  return senatoLegislativeIndex;
}

function getSenatoVotedActsByNumericId(): Map<string, SenatoAct[]> {
  senatoVotedActsByNumericId ??= buildVotedActsByNumericId(
    senatoAttiVoti.acts,
    senatoVoteById,
    (act) => Number.parseInt(act.number.slice(2), 10),
  );
  return senatoVotedActsByNumericId;
}

function cameraActSummary(
  act: CameraAct,
  role: "primo-firmatario" | "cofirmatario" | "votante",
  numericId: string,
): RepublicActSummary {
  const proposer = act.proposer.kind === "government"
    ? { kind: "government" as const, label: act.proposer.label }
    : (() => {
        const numericId = deputyNumericId(act.proposer.deputyId);
        const deputy = deputyByNumericId.get(numericId);
        return {
          kind: "deputy" as const,
          id: act.proposer.deputyId,
          label: deputy ? titleCase(deputy.displayName) : `Deputato ${numericId}`,
        };
      })();
  return {
    id: act.id,
    chamber: "camera",
    number: act.number,
    title: act.title,
    natureId: act.natureId,
    presentedDate: act.presentedDate,
    role,
    initiative: act.initiative,
    proposer,
    responsibleGovernment: act.responsibleGovernment,
    currentState: act.currentState?.state ?? null,
    currentStateDate: act.currentState?.date ?? null,
    outcomeClass: act.outcomeClass,
    coSignerCount: act.coSignerIds.length,
    officialPage: act.officialPage,
    finalVotes: act.finalVoteIds.flatMap((voteId) => {
      const vote = cameraVoteById.get(voteId);
      require(vote !== undefined, `votazione finale non risolta: ${voteId}`);
      if (role === "votante" && !Object.hasOwn(vote!.votes, numericId)) return [];
      return [{
        id: vote!.id,
        date: vote!.date,
        approved: vote!.approved,
        confidenceVote: vote!.confidenceVote,
        favorevoli: vote!.favorevoli,
        contrari: vote!.contrari,
        astenuti: vote!.astenuti,
        ownVote: (vote!.votes[numericId] ?? "non-rilevato") as RepublicActVote,
      }];
    }),
  };
}

function senatoActSummary(
  act: SenatoAct,
  role: "primo-firmatario" | "cofirmatario" | "votante",
  numericId: string,
): RepublicActSummary {
  const firstSigner = act.firstSignerId ? senatorByNumericId.get(act.firstSignerId) : null;
  const government = act.initiativeKind === "government";
  return {
    id: act.id,
    chamber: "senato",
    number: act.number,
    title: act.title,
    natureId: act.natureId,
    presentedDate: act.presentedDate,
    role,
    initiative: government
      ? { kind: "government", label: "Governativa" }
      : { kind: "parliamentary", label: "Parlamentare" },
    proposer: government
      ? { kind: "government", label: act.formalProposers.join("; ") }
      : {
          kind: "senator", id: `sen-s${act.firstSignerId}`,
          label: firstSigner?.displayName ?? `Parlamentare del Senato ${act.firstSignerId}`,
        },
    responsibleGovernment: government ? { label: act.governmentLabels.join(", ") } : null,
    currentState: act.currentPhase.state,
    currentStateDate: act.currentPhase.stateDate,
    currentStateRamo: act.currentPhase.ramo,
    outcomeClass: act.outcomeClass,
    coSignerCount: act.coSignerIds.length,
    officialPage: act.officialPage,
    phases: act.phases.map((phase) => ({
      fase: phase.fase,
      ramo: phase.ramo,
      kind: phase.kind,
      presentedDate: phase.presentedDate,
      state: phase.state,
      stateDate: phase.stateDate,
    })),
    finalVotes: act.finalVoteIds.flatMap((voteId) => {
      const vote = senatoVoteById.get(voteId);
      require(vote !== undefined, `votazione finale non risolta: ${voteId}`);
      if (role === "votante" && !Object.hasOwn(vote!.votes, numericId)) return [];
      return [{
        id: vote!.id,
        date: vote!.date,
        approved: vote!.approved,
        confidenceVote: false,
        favorevoli: vote!.favorevoli,
        contrari: vote!.contrari,
        astenuti: vote!.astenuti,
        voteType: vote!.voteType,
        ownVote: (vote!.votes[numericId] ?? "non-rilevato") as RepublicActVote,
      }];
    }),
  };
}

export function getRepubblicaLegislativeActs(
  personId: string,
): {
  firstSigned: RepublicActSummary[];
  coSigned: RepublicActSummary[];
  voted: RepublicActSummary[];
} | null {
  const person = findRepublicPerson(personId);
  if (!person) return null;
  if (person.chamberId === "camera" && person.id.startsWith("dep-")) {
    const numericId = person.id.slice("dep-".length);
    const index = getCameraLegislativeIndex();
    return {
      firstSigned: (index.firstActsByNumericId.get(numericId) ?? []).map((act) =>
        cameraActSummary(act, "primo-firmatario", numericId),
      ),
      coSigned: (index.coActsByNumericId.get(numericId) ?? []).map((act) =>
        cameraActSummary(act, "cofirmatario", numericId),
      ),
      voted: (getCameraVotedActsByNumericId().get(numericId) ?? []).map((act) =>
        cameraActSummary(act, "votante", numericId),
      ),
    };
  }
  if (person.chamberId === "senato" && person.id.startsWith("sen-s")) {
    const numericId = person.id.slice("sen-s".length);
    const index = getSenatoLegislativeIndex();
    return {
      firstSigned: (index.firstActsByNumericId.get(numericId) ?? []).map((act) =>
        senatoActSummary(act, "primo-firmatario", numericId),
      ),
      coSigned: (index.coActsByNumericId.get(numericId) ?? []).map((act) =>
        senatoActSummary(act, "cofirmatario", numericId),
      ),
      voted: (getSenatoVotedActsByNumericId().get(numericId) ?? []).map((act) =>
        senatoActSummary(act, "votante", numericId),
      ),
    };
  }
  return null;
}

export function getRepubblicaLegislativeSources(): {
  camera: RepublicLegislativeSource;
  senato: RepublicLegislativeSource;
} {
  return {
    camera: {
      chamber: "camera",
      periodLabel: cameraAttiVoti.period.label,
      observedDate: cameraAttiVoti.period.observedDate,
      sourceUrl: cameraAttiVoti.provenance.landingUrl,
      sourceLabel: cameraAttiVoti.provenance.title,
      licenseLabel: cameraAttiVoti.provenance.license,
      coverage: {
        acts: cameraAttiVoti.coverage.acts,
        finalVotesIncluded: cameraAttiVoti.coverage.finalVotes,
        finalVotesExcluded: cameraAttiVoti.coverage.finalVotesExcluded,
      },
      outcomeClasses: cameraAttiVoti.outcomeClasses.map(({ id, label }) => ({ id, label })),
      caveats: cameraAttiVoti.caveats,
    },
    senato: {
      chamber: "senato",
      periodLabel: senatoAttiVoti.period.label,
      observedDate: senatoAttiVoti.period.observedDate,
      sourceUrl: senatoAttiVoti.provenance.landingUrl,
      sourceLabel: senatoAttiVoti.provenance.title,
      licenseLabel: senatoAttiVoti.provenance.license,
      coverage: {
        acts: senatoAttiVoti.coverage.acts,
        finalVotesIncluded: senatoAttiVoti.coverage.finalVotes,
        finalVotesExcluded: senatoAttiVoti.coverage.finalVotesOnOtherActs,
      },
      outcomeClasses: senatoAttiVoti.outcomeClasses.map(({ id, label }) => ({ id, label })),
      caveats: senatoAttiVoti.caveats,
    },
  };
}

function profileLegislativeActivity(person: RepublicPerson): RepublicLegislativeActivity | null {
  if (person.chamberId !== "camera" && person.chamberId !== "senato") return null;
  const chamber = person.chamberId;
  if (!person.id.startsWith(chamber === "camera" ? "dep-" : "sen-s")) return null;
  const numericId =
    chamber === "camera" ? person.id.slice("dep-".length) : person.id.slice("sen-s".length);
  const index =
    chamber === "camera" ? getCameraLegislativeIndex() : getSenatoLegislativeIndex();
  const firstSigned = index.firstActsByNumericId.get(numericId) ?? [];
  const coSigned = index.coActsByNumericId.get(numericId) ?? [];
  const rosterGroupId =
    chamber === "camera"
      ? deputyByNumericId.get(numericId)?.groupId
      : senatorByNumericId.get(numericId)?.groupId;
  require(rosterGroupId !== undefined, `${chamber}: persona assente dal roster: ${numericId}`);
  const outcomeClasses =
    chamber === "camera" ? cameraAttiVoti.outcomeClasses : senatoAttiVoti.outcomeClasses;
  const chamberSize = chamber === "camera" ? camera.deputies.length : senate.senators.length;

  const byOutcome = new Map<string, { firstSigned: number; coSigned: number }>();
  let becameLaw = 0;
  let withFinalVote = 0;
  for (const [role, items] of [["firstSigned", firstSigned], ["coSigned", coSigned]] as const) {
    for (const act of items) {
      if (act.outcomeClass === "legge") becameLaw += 1;
      if (act.finalVoteIds.length > 0) withFinalVote += 1;
      if (!act.outcomeClass) continue;
      const bucket = byOutcome.get(act.outcomeClass) ?? { firstSigned: 0, coSigned: 0 };
      bucket[role] += 1;
      byOutcome.set(act.outcomeClass, bucket);
    }
  }
  const group = index.groupStats.get(rosterGroupId!) ?? null;
  return {
    chamber,
    counts: {
      firstSigned: firstSigned.length,
      coSigned: coSigned.length,
      total: firstSigned.length + coSigned.length,
      becameLaw,
      withFinalVote,
      byOutcome: outcomeClasses
        .map((outcomeClass) => ({
          outcomeClass: outcomeClass.id,
          firstSigned: byOutcome.get(outcomeClass.id)?.firstSigned ?? 0,
          coSigned: byOutcome.get(outcomeClass.id)?.coSigned ?? 0,
        }))
        .filter((row) => row.firstSigned + row.coSigned > 0),
    },
    comparison: {
      chamberSize,
      chamberMedianFirstSigned: index.chamberMedianFirst,
      chamberMedianCoSigned: index.chamberMedianCo,
      groupLabel: person.groupLabel,
      groupSize: group?.size ?? null,
      groupMedianFirstSigned: group?.medianFirst ?? null,
      groupMedianCoSigned: group?.medianCo ?? null,
    },
    // Phases stay on the /atti route payload; the profile only shows the
    // current state and its branch for the recent acts.
    recentFirstSigned: (chamber === "camera"
      ? (getCameraLegislativeIndex().firstActsByNumericId.get(numericId) ?? [])
        .slice(0, 3).map((act) => cameraActSummary(act, "primo-firmatario", numericId))
      : (getSenatoLegislativeIndex().firstActsByNumericId.get(numericId) ?? [])
        .slice(0, 3).map((act) => senatoActSummary(act, "primo-firmatario", numericId)))
      .map((summary) => ({ ...summary, phases: undefined })),
  };
}

export function getRepubblicaMap(): RepublicMap {
  const graph = getRepubblicaGraph();
  const educationPeople = graph.people.map((person) => ({
    profession: person.profession,
    biography: person.biography,
    chamberId: person.chamberId,
    government: person.isGovernmentMember,
  }));
  return {
    legislature: graph.legislature,
    updatedAt: graph.updatedAt,
    coverage: graph.coverage,
    institutions: graph.institutions.map((institution) => ({
      id: institution.id,
      kind: institution.kind,
      tier: institution.tier,
      label: institution.label,
      shortLabel: institution.shortLabel,
      role: institution.role,
      description: institution.description,
      officialPage: institution.officialPage,
      memberCount: institution.memberCount,
      seatCapacity: institution.seatCapacity,
      vacantSeats: institution.vacantSeats,
      leaderPersonId: institution.leaderPersonId,
      leaderRoleLabel: institution.leaderRoleLabel,
    })),
    groups: graph.groups.map((group) => ({
      id: group.id,
      chamberId: group.chamberId,
      label: group.label,
      shortLabel: group.shortLabel,
      partyFamily: group.partyFamily,
      officialPage: group.officialPage,
      memberCount: group.memberCount,
      presidentPersonId: group.presidentPersonId,
      componentLabels: group.componentLabels,
      relatedGroupIds: group.relatedGroupIds,
    })),
    departments: graph.departments,
    partyFamilies: graph.partyFamilies,
    edges: graph.edges,
    people: graph.people.map((person) => ({
      id: person.id,
      name: person.displayName,
      tier: person.tier,
      roleKind: person.primaryRoleKind,
      roleLabel: person.primaryRoleLabel,
      chamberId: person.chamberId,
      groupId: person.groupId,
      family: person.partyFamily,
      weight: person.weight,
      government: person.isGovernmentMember,
      leader: person.isInstitutionalLeader,
      groupLeader: person.isGroupLeader,
      photo: person.photoUrl !== null,
    })),
    education: {
      all: buildEducationDistribution(educationPeople),
      camera: buildEducationDistribution(educationPeople.filter((person) => person.chamberId === "camera")),
      senato: buildEducationDistribution(educationPeople.filter((person) => person.chamberId === "senato")),
      governo: buildEducationDistribution(educationPeople.filter((person) => person.government)),
    },
  };
}

export function getRepubblicaProfiles(): Record<string, RepublicProfile> {
  const graph = getRepubblicaGraph();
  const entries = graph.people.map((person) => [
    person.id,
    {
      firstName: person.firstName,
      lastName: person.lastName,
      gender: person.gender,
      photoCredit: person.photoCredit,
      officialPages: person.officialPages,
      institutionId: person.primaryInstitutionId,
      groupLabel: person.groupLabel,
      componentLabel: person.componentLabel,
      groupRoleLabel: person.groupRoleLabel,
      roles: person.roles,
      departmentIds: person.departmentIds,
      organLabels: person.organLabels,
      constituency: person.constituency,
      college: person.college,
      profession: person.profession,
      birthDate: person.birthDate,
      birthPlace: person.birthPlace,
      socialLinks: person.socialLinks,
      biography: person.biography,
      education: classifyEducation(person.profession, person.biography),
      voteAttendance: profileAttendanceFor(person),
      legislativeActivity: profileLegislativeActivity(person),
    } satisfies RepublicProfile,
  ]);
  return Object.fromEntries(entries);
}

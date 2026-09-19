/** Synthetic fixtures for tests only. Never imported by application code. */
export function makeMap({ cameraCount = 398, senateCount = 205, vacancies = 2 } = {}) {
  const familyLabels = [
    ["alleanza-verdi-sinistra", "AVS"], ["azione", "Azione"], ["forza-italia", "Forza Italia"],
    ["fratelli-italia", "Fratelli d’Italia"], ["italia-viva", "Italia Viva"], ["lega", "Lega"],
    ["misto", "Misto"], ["movimento-5-stelle", "M5S"], ["noi-moderati", "Noi Moderati"], ["partito-democratico", "PD"],
  ];
  const people = [], groups = [];
  for (const [chamberId, total] of [["camera", cameraCount], ["senato", senateCount]]) {
    let assigned = 0;
    const weights = [10, 10, 52, 118, 7, 56, 21, 48, 8, 68];
    for (let index = 0; index < familyLabels.length && assigned < total; index++) {
      const [family, label] = familyLabels[index];
      const size = index === familyLabels.length - 1 ? total - assigned : Math.min(total - assigned, Math.floor(total * weights[index] / 398));
      if (!size) continue;
      const groupId = `${chamberId}-${family}`;
      for (let member = 0; member < size; member++) {
        const serial = assigned + member;
        const id = `${chamberId === "camera" ? "dep" : "sen"}-${serial}`;
        const named = ["Ada Ricci", "Marta Serra", "Luca D’Angelo", "Anna Della Valle"];
        people.push({ id, name: serial < named.length ? `${named[serial]}${chamberId === "senato" ? " (Senato)" : ""}` : `Persona ${chamberId} ${String(serial + 1).padStart(3, "0")}`,
          tier: serial === 0 ? 1 : 3, roleKind: serial === 0 ? "presidente-assemblea" : chamberId === "camera" ? "deputato" : "senatore",
          roleLabel: serial === 0 ? `Presidente ${chamberId === "camera" ? "della Camera" : "del Senato"}` : chamberId === "camera" ? "Deputato" : "Senatore",
          chamberId, groupId, family, weight: serial === 0 ? .9 : .1,
          government: serial > 2 && serial < 9, leader: serial === 0, groupLeader: member === 0, photo: false });
      }
      groups.push({ id: groupId, chamberId, label: `${label} — Gruppo parlamentare di prova`, shortLabel: label, partyFamily: family, officialPage: "https://www.camera.it/",
        memberCount: size, presidentPersonId: `${chamberId === "camera" ? "dep" : "sen"}-${assigned}`, componentLabels: [], relatedGroupIds: [] });
      assigned += size;
    }
  }
  people.push({ id: "gov-1", name: "Elena Verdi", tier: 1, roleKind: "presidente-del-consiglio", roleLabel: "Presidente del Consiglio", chamberId: null, groupId: null, family: null, weight: 1, government: true, leader: true, groupLeader: false, photo: false });
  people.push({ id: "pres-1", name: "Andrea Bianchi", tier: 0, roleKind: "capo-stato", roleLabel: "Presidente della Repubblica", chamberId: null, groupId: null, family: null, weight: 1, government: false, leader: true, groupLeader: false, photo: false });
  for (const group of groups) group.relatedGroupIds = groups.filter((other) => other.partyFamily === group.partyFamily && other.chamberId !== group.chamberId).map((other) => other.id);
  const governmentMembers = people.filter((person) => person.government).length;
  const institutions = [
    { id: "presidenza-repubblica", kind: "capo-stato", tier: 0, label: "Presidenza della Repubblica", shortLabel: "Presidenza", role: "Capo dello Stato", description: "Il Presidente della Repubblica è il capo dello Stato e rappresenta l’unità nazionale.", memberCount: 1, seatCapacity: null, vacantSeats: null, leaderPersonId: "pres-1", leaderRoleLabel: "Presidente della Repubblica", officialPage: "https://www.quirinale.it/" },
    { id: "governo", kind: "governo", tier: 1, label: "Governo della Repubblica", shortLabel: "Governo", role: "Potere esecutivo", description: "La Presidenza del Consiglio e i componenti del Governo, con incarichi, ministeri e deleghe.", memberCount: governmentMembers, seatCapacity: null, vacantSeats: null, leaderPersonId: "gov-1", leaderRoleLabel: "Presidente del Consiglio", officialPage: "https://www.governo.it/" },
    { id: "camera", kind: "assemblea", tier: 2, label: "Camera dei deputati", shortLabel: "Camera", role: "Potere legislativo", description: "Uno dei due rami del Parlamento. Rappresenta i cittadini, approva le leggi ed esercita il controllo sull’attività del Governo.", memberCount: cameraCount, seatCapacity: cameraCount + vacancies, vacantSeats: vacancies, leaderPersonId: "dep-0", leaderRoleLabel: "Presidenza della Camera", officialPage: "https://www.camera.it/" },
    { id: "senato", kind: "assemblea", tier: 2, label: "Senato della Repubblica", shortLabel: "Senato", role: "Potere legislativo", description: "Il Senato esercita la funzione legislativa insieme alla Camera. Comprende i senatori elettivi e i senatori a vita.", memberCount: senateCount, seatCapacity: null, vacantSeats: null, leaderPersonId: "sen-0", leaderRoleLabel: "Presidenza del Senato", officialPage: "https://www.senato.it/" },
  ];
  const education = (total) => ({ total, declared: Math.floor(total * .8), undeclared: total - Math.floor(total * .8), stemCount: Math.floor(total * .1), stemShareOfTotal: total ? Math.floor(total * .1) / total : 0, stemShareOfDeclared: total ? Math.floor(total * .1) / Math.floor(total * .8) : null, caveat: "Fixture: classificazione deterministica da note di studi e professione; non misura competenze.", areas: [
    { area: "stem", label: "STEM", count: Math.floor(total * .1), shareOfTotal: total ? Math.floor(total * .1) / total : 0, shareOfDeclared: .125 },
    { area: "other", label: "Altre aree", count: Math.floor(total * .8) - Math.floor(total * .1), shareOfTotal: total ? (Math.floor(total * .8) - Math.floor(total * .1)) / total : 0, shareOfDeclared: .875 },
    { area: "undeclared", label: "Non dichiarata", count: total - Math.floor(total * .8), shareOfTotal: total ? (total - Math.floor(total * .8)) / total : 0, shareOfDeclared: null },
  ] });
  const ranking = people.filter((person) => person.chamberId === "camera").map((person, index) => ({ rank: index + 1, personId: person.id, name: person.name, groupLabel: "Gruppo di prova", presencePercent: `${99 - index % 70},0%`, presenceTotal: 990, absences: 10, absencesPercent: "1,0%" }));
  return { legislature: { id: "19", label: "XIX Legislatura", startDate: "2022-10-13" }, updatedAt: "2026-09-17", people, groups, institutions,
    departments: [{ id: "presidenza", kind: "presidenza", label: "Presidenza del Consiglio", memberCount: 1 }],
    partyFamilies: familyLabels.map(([id, label]) => ({ id, label, shortLabel: label, memberCount: people.filter((person) => person.family === id).length, chamberIds: ["camera", "senato"] })), edges: [{ id: "test-nomina", kind: "gerarchia", source: "presidenza-repubblica", target: "governo", label: "Relazione di nomina (fixture)", weight: 1 }, { id: "test-fiducia", kind: "gerarchia", source: "governo", target: "camera", label: "Rapporto di fiducia (fixture)", weight: 1 }],
    coverage: { people: people.length, deputies: cameraCount, senators: senateCount, governmentMembers, nonParliamentaryGovernmentMembers: 1, groups: groups.length, departments: 1, institutionalLeaders: 4, peopleWithPhoto: 0, peopleWithBiography: people.length, crossChamberFamilyLinks: familyLabels.length },
    cameraAttendanceRanking: { chamber: "camera", periodLabel: "Fixture · 2022–2026", observedDate: "2026-02-01", sourceUrl: "https://www.camera.it/", sourceLabel: "Camera dei deputati", matchedCount: ranking.length, unmatchedRows: 0, rosterWithoutRow: 0, caveat: "Voti e missioni in Aula, non presenza fisica né attività in commissione.", rows: ranking },
    education: { all: education(people.length), camera: education(cameraCount), senato: education(senateCount), governo: education(governmentMembers) },
  };
}

export function makeProfiles(map) {
  return Object.fromEntries(map.people.map((person) => [person.id, {
    firstName: person.name.split(" ")[0], lastName: person.name.split(" ").slice(1).join(" "), gender: null, photoCredit: null,
    officialPages: [{ label: "Scheda ufficiale", url: "https://www.camera.it/" }], institutionId: person.chamberId ?? (person.government ? "governo" : "presidenza-repubblica"), groupLabel: "Gruppo di prova", componentLabel: null, groupRoleLabel: null,
    roles: [{ kind: person.roleKind, label: person.roleLabel, institutionId: person.chamberId ?? "governo", organLabel: null, since: "2022-10-13" }], departmentIds: [], organLabels: ["Commissione di prova"], constituency: "Territorio di prova", college: null, profession: "Laurea in ingegneria", birthDate: "1980-01-15", birthPlace: "Luogo di prova", socialLinks: null, biography: "Dati sintetici esclusivamente per i test dell’interfaccia. Non è una scheda biografica reale.", education: { area: "stem", label: "STEM", evidence: "Laurea in ingegneria", matchedRule: "stem-degree", sourceField: "profession" },
    voteAttendance: person.chamberId === "camera" ? { chamber: "camera", periodLabel: "Fixture · 2022–2026", observedDate: "2026-02-01", votesCast: 900, votesCastPercent: "90,0%", missions: 90, missionsPercent: "9,0%", presenceTotal: 990, presencePercent: "99,0%", absences: 10, absencesPercent: "1,0%", justifiedAbsences: 5, justifiedAbsencesPercent: "0,5%", sourceUrl: "https://www.camera.it/", sourceLabel: "Camera dei deputati", rank: 1, rankedAmong: map.coverage.deputies } : null,
  }]));
}

export const emptyNews = { ok: true, articles: [], connections: [], observedAt: "2026-09-18T10:00:00Z", provider: { id: "fixture", name: "Indice di prova", url: "https://example.org/", note: "Dati sintetici per i test" } };
export const sampleNews = { ...emptyNews, articles: [{ title: "Articolo sintetico per verificare notizie e co-citazioni", url: "https://example.org/article", source: "Fonte di prova", publishedAt: "2026-09-17T09:00:00Z" }], connections: [{ person: { id: "dep-1", name: "Marta Serra", chamber: "camera", groupId: "camera-alleanza-verdi-sinistra", groupLabel: "AVS" }, articleCount: 1, articleUrls: ["https://example.org/article"] }] };

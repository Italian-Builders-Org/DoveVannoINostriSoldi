import assert from "node:assert/strict";
import test from "node:test";
import attendanceJson from "../src/data/generated/camera-partecipazione-voto.json" with { type: "json" };
import "./helpers/register-ts-alias.mjs";

const { parseCameraPartecipazioneVotoSnapshot } = await import(
  "../src/lib/data/camera-partecipazione-voto-contract.ts"
);
const { getRepubblicaProfiles } = await import("../src/lib/politici-repubblica.ts");

test("camera participation snapshot parses and reconciles coverage", () => {
  const snapshot = parseCameraPartecipazioneVotoSnapshot(attendanceJson);
  assert.equal(snapshot.chamber, "camera");
  assert.equal(snapshot.coverage.rows, snapshot.deputies.length);
  assert.ok(snapshot.coverage.matchedDeputies >= 380);
  assert.ok(snapshot.provenance.gap.toLowerCase().includes("senato"));
  assert.equal(snapshot.soldi.present, false);
});

test("deputy profiles expose attendance only when matched; senators never do", () => {
  const profiles = getRepubblicaProfiles();
  const meloni = profiles["dep-302103"];
  assert.ok(meloni);
  assert.ok(meloni.voteAttendance);
  assert.equal(meloni.voteAttendance.chamber, "camera");
  assert.match(meloni.voteAttendance.presencePercent, /%$/);

  const senator = Object.values(profiles).find((profile) =>
    profile.roles.some((role) => role.kind === "senatore" || role.kind === "senatore-a-vita"),
  );
  assert.ok(senator);
  assert.equal(senator.voteAttendance, null);
});

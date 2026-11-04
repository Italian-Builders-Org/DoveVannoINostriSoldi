import assert from "node:assert/strict";
import { closeSync, mkdtempSync, readdirSync, readFileSync, readSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openRegularFile, openRegularFileSync } from "../src/lib/data/safe-open.ts";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "dvns-safe-open-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "file.json");
  const link = join(directory, "link.json");
  writeFileSync(file, "{}");
  symlinkSync(file, link);
  return { directory, file, link };
}

test("regular files open for reading, sync and async", async (t) => {
  const { file } = fixture(t);
  const fd = openRegularFileSync(file);
  try {
    const bytes = Buffer.alloc(2);
    assert.equal(readSync(fd, bytes, 0, 2, 0), 2);
    assert.equal(bytes.toString(), "{}");
  } finally {
    closeSync(fd);
  }
  const handle = await openRegularFile(file);
  try {
    assert.equal((await handle.readFile()).toString(), "{}");
  } finally {
    await handle.close();
  }
});

// Passing 0 as the no-follow flag reproduces Windows, where O_NOFOLLOW does not exist.
for (const noFollow of [undefined, 0]) {
  test(`symlinks are rejected with ELOOP (no-follow flag ${noFollow ?? "default"})`, async (t) => {
    const { link } = fixture(t);
    assert.throws(() => openRegularFileSync(link, noFollow), { code: "ELOOP" });
    await assert.rejects(openRegularFile(link, noFollow), { code: "ELOOP" });
  });
}

test("missing files keep the ENOENT code", async (t) => {
  const { directory } = fixture(t);
  const missing = join(directory, "missing.json");
  assert.throws(() => openRegularFileSync(missing), { code: "ENOENT" });
  await assert.rejects(openRegularFile(missing), { code: "ENOENT" });
});

test("readers in src/ open files only through safe-open", () => {
  const offenders = readdirSync("src", { recursive: true })
    .filter((path) => /\.tsx?$/.test(path) && !path.endsWith("safe-open.ts"))
    .filter((path) => readFileSync(join("src", path), "utf8").includes("O_NOFOLLOW"));
  assert.deepEqual(offenders, [], "usare openRegularFile/openRegularFileSync da @/lib/data/safe-open");
});

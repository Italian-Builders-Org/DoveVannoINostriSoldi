import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  getImmutableObjectStoreDiagnosticsForTests,
  readImmutableLocalObject,
  resetImmutableObjectStoreForTests,
} = await import("../src/lib/integrated-object-store.ts");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(payload) {
  const root = await mkdtemp(join(tmpdir(), "immutable-object-"));
  const digest = sha256(payload);
  await mkdir(join(root, "sha256"));
  await writeFile(join(root, "sha256", digest), payload);
  return {
    root,
    descriptor: { sha256: digest, bytes: payload.length, rawBytes: payload.length, format: "json-v1", key: `sha256/${digest}` },
  };
}

test.afterEach(() => resetImmutableObjectStoreForTests());

test("immutable object descriptors are revalidated even after a cache hit", async () => {
  const { root, descriptor } = await fixture(Buffer.from("verified\n"));
  try {
    assert.equal((await readImmutableLocalObject(root, descriptor)).toString(), "verified\n");
    await assert.rejects(
      readImmutableLocalObject(root, { ...descriptor, rawBytes: descriptor.rawBytes + 1 }),
      /descrittore/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one cancelled consumer does not cancel a shared immutable load", async () => {
  const { root, descriptor } = await fixture(Buffer.alloc(4 * 1024 * 1024, 7));
  try {
    const controller = new AbortController();
    const cancelled = readImmutableLocalObject(root, descriptor, controller.signal);
    const survivor = readImmutableLocalObject(root, descriptor);
    controller.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    assert.equal((await survivor).length, descriptor.rawBytes);
    assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().inFlightKeys, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("immutable objects reject symlinks and altered bytes", async () => {
  const { root, descriptor } = await fixture(Buffer.from("original\n"));
  try {
    await writeFile(join(root, "sha256", descriptor.sha256), "altered!\n");
    await assert.rejects(readImmutableLocalObject(root, descriptor), /Hash|Dimensione/i);

    resetImmutableObjectStoreForTests();
    await rm(join(root, "sha256", descriptor.sha256));
    await writeFile(join(root, "target"), "original\n");
    await symlink(join(root, "target"), join(root, "sha256", descriptor.sha256));
    await assert.rejects(readImmutableLocalObject(root, descriptor));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

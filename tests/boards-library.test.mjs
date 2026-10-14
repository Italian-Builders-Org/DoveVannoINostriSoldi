import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(index) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(String(key));
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
globalThis.window = { localStorage: storage };
globalThis.localStorage = storage;

const {
  createBoard,
  deleteBoard,
  groupBoardsByCategory,
  listBoardMetas,
  loadBoardDocument,
  loadBoardLibrary,
  saveBoardDocument,
  updateBoardMeta,
} = await import("../src/lib/boards/board-library.ts");

const USER = "test-user-boards-library";

function clearUserStorage(userId) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.includes(userId)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

test("board library creates, renames, categorizes and deletes boards", () => {
  clearUserStorage(USER);
  assert.equal(loadBoardLibrary(USER).boards.length, 0);

  const first = createBoard(USER, { title: "Debito", category: "Debito" });
  createBoard(USER, { title: "Comuni", category: "Comuni" });
  assert.equal(listBoardMetas(USER).length, 2);

  const doc = loadBoardDocument(USER, first.id);
  assert.ok(doc);
  assert.equal(doc.title, "Debito");
  saveBoardDocument(USER, first.id, { ...doc, title: "Debito pubblico" });
  assert.equal(loadBoardDocument(USER, first.id)?.title, "Debito pubblico");

  const second = listBoardMetas(USER).find((board) => board.id !== first.id);
  assert.ok(second);
  updateBoardMeta(USER, second.id, { title: "Uscite comunali", category: "Territorio" });
  const groups = groupBoardsByCategory(listBoardMetas(USER));
  assert.ok(groups.some((group) => group.category === "Debito"));
  assert.ok(groups.some((group) => group.category === "Territorio"));

  assert.equal(deleteBoard(USER, first.id), true);
  assert.equal(loadBoardDocument(USER, first.id), null);
  assert.equal(listBoardMetas(USER).length, 1);
  clearUserStorage(USER);
});

test("legacy single-board key migrates into the library", () => {
  clearUserStorage(USER);
  storage.setItem(
    `dvns-boards-doc:v1:${USER}`,
    JSON.stringify({
      schemaVersion: 1,
      title: "Legacy board",
      layout: "free",
      tiles: [],
    }),
  );
  const index = loadBoardLibrary(USER);
  assert.equal(index.boards.length, 1);
  assert.equal(index.boards[0].title, "Legacy board");
  assert.equal(loadBoardDocument(USER, index.boards[0].id)?.title, "Legacy board");
  clearUserStorage(USER);
});

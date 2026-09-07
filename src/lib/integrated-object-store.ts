import "server-only";

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { sha256Hex } from "@/lib/integrated-source-contract";
import { withIntegratedDatasetLoadSlot } from "@/lib/integrated-sources";

const unzip = promisify(gunzip);
const MAX_CACHE_RAW_BYTES = 64 * 1024 * 1024;
const MAX_OBJECT_BYTES = 16 * 1024 * 1024;
const READ_BLOCK_BYTES = 64 * 1024;

export type ImmutableObjectDescriptor = {
  sha256: string;
  bytes: number;
  rawBytes: number;
  format: "json-v1" | "jsonl-gzip-v1";
  key: string;
};

type CachedObject = { bytes: Buffer; touched: number };
const cachedObjects = new Map<string, CachedObject>();
const inFlightObjects = new Map<string, Promise<Buffer>>();
let cachedRawBytes = 0;
let cacheClock = 0;

function abortError(): Error {
  const error = new Error("Lettura oggetto integrato annullata.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readExact(path: string, expectedBytes: number): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== expectedBytes) {
      throw new Error("Dimensione oggetto immutabile divergente.");
    }
    const payload = Buffer.allocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < payload.length) {
      const { bytesRead } = await handle.read(
        payload,
        offset,
        Math.min(READ_BLOCK_BYTES, payload.length - offset),
        offset,
      );
      if (bytesRead <= 0) throw new Error("Oggetto immutabile cambiato durante la lettura.");
      offset += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    const [{ bytesRead }, finalStat] = await Promise.all([
      handle.read(extra, 0, 1, expectedBytes),
      handle.stat(),
    ]);
    if (bytesRead !== 0 || finalStat.size !== expectedBytes) {
      throw new Error("Oggetto immutabile cambiato durante la lettura.");
    }
    return payload;
  } finally {
    await handle?.close();
  }
}

function remember(key: string, bytes: Buffer): void {
  if (bytes.length > MAX_CACHE_RAW_BYTES) return;
  while (cachedRawBytes + bytes.length > MAX_CACHE_RAW_BYTES && cachedObjects.size > 0) {
    let oldestKey: string | undefined;
    let oldestTouched = Number.POSITIVE_INFINITY;
    for (const [candidate, value] of cachedObjects) {
      if (value.touched < oldestTouched) {
        oldestKey = candidate;
        oldestTouched = value.touched;
      }
    }
    if (!oldestKey) break;
    cachedRawBytes -= cachedObjects.get(oldestKey)!.bytes.length;
    cachedObjects.delete(oldestKey);
  }
  cachedObjects.set(key, { bytes, touched: ++cacheClock });
  cachedRawBytes += bytes.length;
}

async function loadObject(
  root: string,
  descriptor: ImmutableObjectDescriptor,
): Promise<Buffer> {
  validateDescriptor(descriptor);
  const payload = await readExact(join(root, descriptor.key), descriptor.bytes);
  if (sha256Hex(payload) !== descriptor.sha256) {
    throw new Error("Hash oggetto immutabile divergente.");
  }
  const raw = descriptor.format === "jsonl-gzip-v1"
    ? await unzip(payload, { maxOutputLength: descriptor.rawBytes })
    : payload;
  if (raw.length !== descriptor.rawBytes) {
    throw new Error("Dimensione raw oggetto immutabile divergente.");
  }
  return raw;
}

function validateDescriptor(descriptor: ImmutableObjectDescriptor): void {
  if (
    !/^[0-9a-f]{64}$/.test(descriptor.sha256) ||
    descriptor.key !== `sha256/${descriptor.sha256}` ||
    !Number.isSafeInteger(descriptor.bytes) ||
    descriptor.bytes <= 0 ||
    descriptor.bytes > MAX_OBJECT_BYTES ||
    !Number.isSafeInteger(descriptor.rawBytes) ||
    descriptor.rawBytes <= 0 ||
    descriptor.rawBytes > MAX_OBJECT_BYTES ||
    !["json-v1", "jsonl-gzip-v1"].includes(descriptor.format) ||
    (descriptor.format === "json-v1" && descriptor.rawBytes !== descriptor.bytes)
  ) {
    throw new Error("Descrittore oggetto immutabile non valido.");
  }
}

/** Local, content-addressed reader. A remote provider remains gated by ADR G2. */
export async function readImmutableLocalObject(
  root: string,
  descriptor: ImmutableObjectDescriptor,
  signal?: AbortSignal,
): Promise<Buffer> {
  validateDescriptor(descriptor);
  const key = `${root}\0${descriptor.sha256}\0${descriptor.bytes}\0${descriptor.rawBytes}\0${descriptor.format}`;
  const cached = cachedObjects.get(key);
  if (cached) {
    cached.touched = ++cacheClock;
    return waitForCaller(Promise.resolve(cached.bytes), signal);
  }
  let promise = inFlightObjects.get(key);
  if (!promise) {
    const sharedLoadSignal = new AbortController().signal;
    promise = withIntegratedDatasetLoadSlot(
      () => loadObject(root, descriptor),
      sharedLoadSignal,
    )
      .then((bytes) => {
        remember(key, bytes);
        return bytes;
      })
      .finally(() => inFlightObjects.delete(key));
    inFlightObjects.set(key, promise);
  }
  return waitForCaller(promise, signal);
}

/** Test-only visibility for the bounded immutable-object cache. */
export function getImmutableObjectStoreDiagnosticsForTests() {
  return {
    cachedRawBytes,
    cacheKeys: [...cachedObjects.keys()],
    inFlightKeys: [...inFlightObjects.keys()],
  } as const;
}

export function resetImmutableObjectStoreForTests(): void {
  if (inFlightObjects.size > 0) {
    throw new Error("Impossibile azzerare la cache durante una lettura immutabile.");
  }
  cachedObjects.clear();
  cachedRawBytes = 0;
  cacheClock = 0;
}

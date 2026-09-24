import { lstatSync } from "node:fs";

/** Fingerprints invalidate validated snapshots after replacement, edits or removal. */
export function artifactFingerprint(paths: readonly string[]): string {
  return JSON.stringify(paths.map((path) => {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile()) throw new Error(`Artifact non regolare: ${path}`);
    return [path, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String);
  }));
}

/** Weight is serialized size, not a promise about JavaScript heap allocation. */
export class ArtifactCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;

  private maxEntries: number;
  private maxBytes: number;

  constructor(maxEntries: number, maxBytes: number) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) return;
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
  }
}

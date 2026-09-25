#!/usr/bin/env node
// Reclaim disposable build-container files before Vercel packages the outputs.
// Local and GitHub builds retain the cache for subsequent compilations.
import { lstat, rm, statfs } from "node:fs/promises";
import { join } from "node:path";

if (process.env.VERCEL !== "1") {
  console.log("Post-build cleanup skipped outside Vercel; build cache preserved.");
  process.exit(0);
}

async function removeIfPresent(relativePath, reason) {
  const absolutePath = join(process.cwd(), relativePath);
  try {
    // A worktree pointer or symlink is not a disposable checkout directory.
    if (!(await lstat(absolutePath)).isDirectory()) return false;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  await rm(absolutePath, { recursive: true, force: true });
  console.log(`Removed ${relativePath} (${reason}).`);
  return true;
}

async function reportDisk(stage) {
  const { bavail, blocks, bsize } = await statfs(process.cwd());
  const gib = (blocks) => ((blocks * bsize) / 1024 ** 3).toFixed(2);
  console.log(`Build disk ${stage}: ${gib(bavail)} GiB available / ${gib(blocks)} GiB total.`);
}

await reportDisk("before cleanup");
const removedCache = await removeIfPresent(
  ".next/cache",
  "Turbopack/Next build cache is unused after compile",
);

const removedGit = await removeIfPresent(".git", "Git pack is unused after source checkout on Vercel");
await reportDisk("after cleanup");

if (!removedCache && !removedGit) {
  console.log("No post-build disk cleanup was needed.");
}

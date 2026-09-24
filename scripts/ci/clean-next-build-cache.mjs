#!/usr/bin/env node
/**
 * Free disk after `next build` succeeds, before Vercel publishes outputs.
 *
 * Production redeploys have failed with ENOSPC while staging large `.nft.json`
 * trees. After the compile finishes, Turbopack SST caches and the Git object
 * pack are no longer needed for packaging serverless outputs and only consume
 * the remaining container disk.
 */
import { access, rm } from "node:fs/promises";
import { join } from "node:path";

async function removeIfPresent(relativePath, reason) {
  const absolutePath = join(process.cwd(), relativePath);
  try {
    await access(absolutePath);
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

const removedCache = await removeIfPresent(
  ".next/cache",
  "Turbopack/Next build cache is unused after compile",
);

const onVercel = process.env.VERCEL === "1";
const removedGit = onVercel
  ? await removeIfPresent(".git", "Git pack is unused after source checkout on Vercel")
  : false;

if (!removedCache && !removedGit) {
  console.log("No post-build disk cleanup was needed.");
}

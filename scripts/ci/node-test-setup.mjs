// Force the suite's offline contract on every shell, including child processes.
process.env.DVNS_OFFLINE_GUARD = "1";
await import("./node-offline-guard.mjs");

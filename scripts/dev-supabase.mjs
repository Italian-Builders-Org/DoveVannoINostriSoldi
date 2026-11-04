import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Worktrees reference the original ignored env file; never copy its credentials.
try {
  process.loadEnvFile(resolve(process.env.DVNS_ENV_FILE ?? '.env.local'));
  if (!process.env.DVNS_DATABASE_URL) throw new Error();
} catch {
  console.error('Impostare DVNS_ENV_FILE al file locale contenente DVNS_DATABASE_URL.');
  process.exit(1);
}
const child = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'), 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, DVNS_DATA_BACKEND: 'supabase' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { mkdir, mkdtemp, open, readFile, unlink, realpath } from 'node:fs/promises';
import { createRuntimeView } from './lib/supabase-runtime-view.mjs';

const repository=await realpath(process.cwd());
const envFile=resolve(process.env.DVNS_ENV_FILE ?? '.env.local');
try {
  process.loadEnvFile(envFile);
  if (!process.env.DVNS_DATABASE_URL) throw new Error();
} catch {
  console.error('Impostare DVNS_ENV_FILE al file locale contenente DVNS_DATABASE_URL.');
  process.exit(1);
}
const runtime=join(repository,'artifacts/supabase-runtime');
const pin=JSON.parse(await readFile(join(repository,'supabase/runtime-release.json'),'utf8'));
if (!/^[0-9a-f]{64}$/.test(pin.inventory_sha256)) throw new Error('Invalid release pin.');
const cache=join(runtime,`release-${pin.inventory_sha256}`);
await mkdir(runtime,{recursive:true});
const lockPath=join(runtime,'server.lock');
try {
  const pid=Number(await readFile(lockPath,'utf8'));
  if (!Number.isSafeInteger(pid) || pid<=0) throw new Error('Invalid runtime lock.');
  try { process.kill(pid,0); throw new Error('Supabase runtime already running.'); }
  catch(error) { if(error.code!=='ESRCH') throw error; await unlink(lockPath); }
} catch(error) { if(error.code!=='ENOENT') throw error; }
const lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));await lock.close();
let child;
let interrupted=false;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{interrupted=true;child?.kill(signal);});
async function execute(command,args,options={}) {
  child=spawn(command,args,{stdio:'inherit',...options});
  return await new Promise((resolve,reject)=>{
    child.once('error',reject);child.once('exit',(code)=>resolve(code??1));
  });
}
let code=1;
try {
  // Storage secret is read only by the restore process, never loaded into Next.
  code=await execute(process.env.DVNS_PYTHON ?? join(repository,'.venv/bin/python'),[
    '-u',join(repository,'scripts/etl/supabase_runtime_restore.py'),
    '--env-file',envFile,'--storage-env-file',resolve(process.env.DVNS_STORAGE_ENV_FILE ?? join(dirname(envFile),'.env.storage.local')),
    '--cache',cache,
  ]);
  if(code===0&&!interrupted){
    const site=await mkdtemp(join(runtime,'site-'));await createRuntimeView(repository,site,cache);
    console.log('Snapshot Supabase verificati. Avvio sito locale dalla cache di release.');
    code=await execute(process.execPath,[createRequire(import.meta.url).resolve('next/dist/bin/next'),'dev',site,...process.argv.slice(2)],{
      cwd:site,env:{...process.env,DVNS_DATA_BACKEND:'supabase',DVNS_RUNTIME_PROJECT_ROOT:repository},
    });
  }
} finally { await unlink(lockPath); }
process.exitCode=code;

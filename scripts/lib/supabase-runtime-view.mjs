import { cp, mkdir, lstat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/** A separate Next root keeps synchronous snapshot readers on verified cloud bytes. */
export async function createRuntimeView(repository, site, cache) {
  repository=resolve(repository);site=resolve(site);cache=resolve(cache);
  if (!site.startsWith(repository+'/artifacts/') || !cache.startsWith(repository+'/artifacts/')) throw new Error('Runtime paths must stay in repository artifacts.');
  await mkdir(site,{recursive:true});
  for (const directory of ['src','data']) {
    const excluded=join(repository,directory==='src'?'src/data/generated':'data/source-ledger');
    await cp(join(repository,directory),join(site,directory),{
      recursive:true,filter:(source)=>source!==excluded,
    });
  }
  for (const path of ['package.json','package-lock.json','tsconfig.json','next.config.ts','next-env.d.ts','postcss.config.mjs']) {
    if (await exists(join(repository,path))) await cp(join(repository,path),join(site,path));
  }
  for (const [name,target] of [
    ['src/data/generated',join(cache,'src/data/generated')],
    ['data/source-ledger',join(cache,'data/source-ledger')],
    ['node_modules',join(repository,'node_modules')],['public',join(repository,'public')],
    ['scripts',join(repository,'scripts')],
    // Legacy source manifests imported by application code live outside generated.
    ['docs',join(repository,'docs')],
  ]) {
    const path=join(site,name);
    if (!await exists(path)) await symlink(target,path,'dir');
    else if (!(await lstat(path)).isSymbolicLink()) throw new Error('Unexpected runtime path.');
  }
}

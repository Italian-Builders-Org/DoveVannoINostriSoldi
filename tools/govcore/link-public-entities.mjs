import '../../tests/helpers/register-ts-alias.mjs';
import { GovCoreClient } from '@gov-core/client';
import { enrichDvnsIdentityLinks } from './links.ts';
const { getMunicipalitySearchEntities }=await import('../../src/lib/siope-municipality-detail.ts');

const help='Usage: npm run link -- --ipa c_d150 [--ipa c_f023] [--concurrency 4]\nSet GOVCORE_URL to the configured public API. At most 50 explicit IPA codes; only public identifiers leave DVNS.\n';
const args=process.argv.slice(2),codes=[];let concurrency=4;
try {
  if(args.length===1&&args[0]==='--help'){process.stdout.write(help);process.exit(0);}
  for(let i=0;i<args.length;i++){
    if(args[i]==='--ipa'&&typeof args[i+1]==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(args[i+1]))codes.push(args[++i]);
    else if(args[i]==='--concurrency'&&/^\d{1,2}$/.test(args[i+1]??''))concurrency=Number(args[++i]);
    else throw Error('arguments');
  }
  if(!codes.length||codes.length>50||concurrency<1||concurrency>16)throw Error('arguments');
  const known=new Map(getMunicipalitySearchEntities().map(entity=>[entity.codiceIpa.toLowerCase(),entity]));
  const records=codes.map(code=>{
    const entity=known.get(code.toLowerCase());
    return {codiceIpa:entity?.codiceIpa??code,codiceFiscale:entity?.codiceFiscale??null};
  });
  const output=await enrichDvnsIdentityLinks(new GovCoreClient({baseUrl:process.env.GOVCORE_URL??''}),records,{concurrency,maxRows:50});
  process.stdout.write(JSON.stringify({mode:'public-identity-overlay',dvnsData:'committed SIOPE snapshot; no financial rows exported',observedAt:new Date().toISOString(),...output},null,2)+'\n');
  if(output.links.some(row=>!row.link.ok))process.exitCode=1;
} catch(error) {
  process.stderr.write(error?.message==='arguments'?help:'GovCore public identity linking unavailable; inspect local configuration.\n');
  process.exitCode=2;
}

import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {root,exec,serverArguments,environment} from './local-runtime.mjs';

export function strataPaths(config){
  const directory=config.StrataDirectory??path.join(root,'runtime/strata/terminal-0.1.48.1');
  return {directory,python:path.join(directory,'python/python.exe'),entry:path.join(directory,'strata.py'),install:config.StrataInstallDirectory??path.resolve(root,'../.strata')};
}
export function validateStrataContext(config){
  if(config.ContextSize!==65536)throw Error('qwen-flash currently supports only the tested 65536-token context.');
}
export async function ensureStrata(config){
  validateStrataContext(config);
  const paths=strataPaths(config),env=environment({STRATA_INSTALL_DIR:paths.install,STRATA_DATA_DIR:path.join(root,'.state/strata-data')});
  for(const file of [paths.python,paths.entry,config.ModelFile,config.ModelFile.replace('00001-of-00002','00002-of-00002')])if(!fs.existsSync(file))throw Error('Flash requires the existing Strata installation and both model shards. Missing: '+file);
  for(const port of [48763,48764]){let active=false;try{await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)});active=true;}catch{}if(active)throw Error(`Model server already running on port ${port}; close its owning launcher first.`);}
  const args=serverArguments(config);
  const plan=JSON.parse((await exec(paths.python,[paths.entry,...args.filter(a=>a!=='--yes'), '--plan'],{env,windowsHide:true,timeout:60000})).stdout.trim());
  if(!plan.ok||plan.plan?.download?.gb!==0||plan.plan.download.engine_missing||!plan.plan.download.engine_usable)throw Error('Flash launch needs installation/downloads; complete Strata setup first. No downloads started.');
  const logPath=config.LogPath??path.join(root,'.state/strata-launcher.log');fs.mkdirSync(path.dirname(logPath),{recursive:true});const fd=fs.openSync(logPath,'a');
  const child=spawn(paths.python,[paths.entry,...args],{env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);let spawnError;child.once('error',e=>spawnError=e);
  let stopping;const stop=()=>stopping??=exec(paths.python,[paths.entry,'launch','--stop'],{env,windowsHide:true,timeout:60000});
  try{const deadline=Date.now()+600000;while(Date.now()<deadline){if(spawnError)throw spawnError;if(child.exitCode!==null&&child.exitCode!==0)throw Error('Strata launch failed; see '+logPath);let health;try{health=await fetch(config.RouterUrl+'/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json())}catch{}if(health?.loaded){if(health.max_context!==65536||health.images||health.model!=='qwen3.8-flash-next-coder-iq1_m')throw Error('Strata loaded an unexpected model/context/vision configuration');return {owned:true,pid:child.pid,stop};}await new Promise(r=>setTimeout(r,1000));}throw Error('Strata did not load within ten minutes; see '+logPath);}catch(e){await stop().catch(()=>{});throw e;}
}

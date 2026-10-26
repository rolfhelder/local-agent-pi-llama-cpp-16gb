import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {root,machine,requireModelFiles,modelSelectionError,prepareProfile,acquireInferenceLock,ensureServer,exec} from './local-runtime.mjs';
import {consoleUI} from './console-ui.mjs';
import {activity} from './terminal-activity.mjs';
import {contextAppearance} from './pi-app-appearance.mjs';

// Separate desktop launcher: one loaded model, the same request-budget hooks,
// and a pinned SDK without modifying Pi App's executable or packaged source.
const args=process.argv.slice(2);
const value=(key,fallback)=>{const at=args.indexOf(key);if(at<0)return fallback;const result=args[at+1];if(!result||result.startsWith('--'))throw key==='--model'?modelSelectionError(key+' needs a value'):Error(key+' needs a value');args.splice(at,2);return result;};
const flag=key=>{const at=args.indexOf(key);if(at<0)return false;args.splice(at,1);return true;};
const noColor=flag('--no-color'),ascii=flag('--ascii');
const ui=consoleUI([...(noColor?['--no-color']:[]),...(ascii?['--ascii']:[])]);
let busy;
const start=text=>{busy?.stop();busy=activity({message:text,color:!noColor&&process.stderr.isTTY&&!process.env.NO_COLOR,ascii});};
const done=text=>{busy?.stop();busy=undefined;ui.status(true,text);};
ui.title('PI APP','One local model · llama.cpp · desktop workspace');
try {
const selected=value('--model','qwen38'),requestedCwd=value('--cwd',undefined);
const configureOnly=flag('--configure-only'),attach=flag('--attach'),debug=value('--debug-port',undefined);
const dryRun=flag('--dry-run');
if(args.length)throw Error('Unknown arguments: '+args.join(' '));
const config=await machine(selected);
if(config.Runtime==='strata'&&attach)throw Error('Flash uses Strata. Close its owning launcher and start without --attach.');
if(dryRun){const {serverArguments}=await import('./local-runtime.mjs');ui.row('Model',config.ModelId);ui.row('Runtime',config.Runtime??'llama.cpp');ui.row('Context',config.ContextSize+' tokens');ui.line(JSON.stringify(serverArguments(config)));ui.finish('Preview only; no settings changed or model started.');process.exit(0);}
await requireModelFiles(config);
start('Checking desktop and installation');
if(!configureOnly){
 const existing=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process -Filter \"Name='pi Desktop.exe'\" | Where-Object {$_.CommandLine -notmatch '--type='} | Select-Object -ExpandProperty ProcessId"],{windowsHide:true});
 if(existing.stdout.trim())throw Error('Pi App is already running. Use its existing window, or Quit it from the tray before launching a different model.');
}
const manifest=JSON.parse(await readFile(path.join(root,'manifests/pi-app.json'),'utf8'));
const executable=path.join(root,'runtime/pi-app',manifest.asset);
const hash=createHash('sha256').update(await readFile(executable)).digest('hex');
if(hash!==manifest.sha256)throw Error('Pi App checksum mismatch');
done('Pi App installation verified');
start('Preparing local model, effort settings and desktop SDK');
const userData=path.join(process.env.APPDATA,'pi-desktop');
const previousAppSettings=JSON.parse(await readFile(path.join(userData,'pi-desktop.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
const cwd=path.resolve(requestedCwd??config.WorkingDirectory??previousAppSettings.currentProject??path.dirname(root));
const prepared=await prepareProfile('pi-app',config,cwd);
const preferences=JSON.parse(await readFile(prepared.env.PI_EFFORT_PREFERENCES,'utf8').catch(error=>{if(error.code==='ENOENT')return '{}';throw error;}));
const thinking=config.Reasoning===false?'off':preferences[selected]??config.ThinkingLevel??'medium';
if(!['off','low','medium','high'].includes(thinking))throw Error('ThinkingLevel must be off, low, medium or high');
const settings={...prepared.settings,defaultProvider:'local-llama',defaultModel:config.ModelId,defaultThinkingLevel:thinking,enabledModels:['local-llama/'+config.ModelId]};
await writeFile(path.join(prepared.agentDir,'settings.json'),JSON.stringify(settings,null,2)+'\n');
await mkdir(userData,{recursive:true});
const backupDir=path.join(root,'.state/pi-app-backups',new Date().toISOString().replace(/[:.]/g,'-'));
const backup=async(file)=>{try{const data=await readFile(file);await mkdir(backupDir,{recursive:true});await writeFile(path.join(backupDir,path.basename(file)),data);return JSON.parse(data);}catch(e){if(e.code==='ENOENT')return {};throw e;}};
const appSettingsPath=path.join(userData,'pi-desktop.json');
const appSettings=await backup(appSettingsPath);
Object.assign(appSettings,{maxSessionWorkers:1,sessionWorkerIdleTimeoutMinutes:5,autoCheckRegistryUpdates:false,autoOpenLastProject:true,currentProject:cwd,recentProjects:[cwd,...(appSettings.recentProjects||[]).filter(p=>p!==cwd)]});
appSettings.rightPanelPrefs={...appSettings.rightPanelPrefs,run:true,context:true,browser:true,files:true};
appSettings.customCssOverride=contextAppearance(appSettings.customCssOverride);
await writeFile(appSettingsPath,JSON.stringify(appSettings,null,2)+'\n');
// Supported user-SDK selection, with a small pinned metadata compatibility
// entry. Imports resolve against the lab's complete locked dependency tree.
const target=path.join(root,'node_modules');
const sdkDir=path.join(userData,'sdk','pi-local-lab-compat','node_modules','@earendil-works','pi-coding-agent');await mkdir(sdkDir,{recursive:true});
const sdkVersion=JSON.parse(await readFile(path.join(target,'@earendil-works/pi-coding-agent/package.json'),'utf8')).version;
await writeFile(path.join(sdkDir,'package.json'),JSON.stringify({name:'@earendil-works/pi-coding-agent',version:sdkVersion,type:'module',exports:'./index.mjs',private:true},null,2)+'\n');
await writeFile(path.join(sdkDir,'index.mjs'),'export * from '+JSON.stringify(pathToFileURL(path.join(root,'extensions/pi-app-sdk-compat.mjs')).href)+';\n');
const selection=path.join(userData,'sdk/current.json');await backup(selection);
await writeFile(selection,JSON.stringify({active:'user',userDir:'pi-local-lab-compat'},null,2)+'\n');
const env={...prepared.env,PI_LOCAL_DESKTOP_UI:'1'};
// No PI_LOCAL_RESTART_REQUEST: the desktop model picker cannot swap weights.
// Only the actually loaded alias is exposed. Restart this launcher to switch.
delete env.PI_LOCAL_RESTART_REQUEST;
await writeFile(path.join(root,'.state/pi-app-launch.json'),JSON.stringify({model:config.ModelId,agentDir:prepared.agentDir,cwd,endpoint:config.RouterUrl,sdkVersion:JSON.parse(await readFile(path.join(target,'@earendil-works/pi-coding-agent/package.json'),'utf8')).version},null,2)+'\n');
done('Model, effort settings and desktop SDK configured');
ui.row('Model',config.ModelId);
ui.row('Context',config.ContextSize.toLocaleString('en-US')+' tokens');
ui.row('Reasoning',config.Reasoning===false?'off':thinking+(config.Runtime==='strata'?' (native effort)':config.ModelId==='qwen38-local'?' (native effort + budget; high maps to xhigh)':' (request budget presets)'));
ui.row('Response cap',config.MaxTokens.toLocaleString('en-US')+' tokens');
ui.row('Pi settings',prepared.agentDir);
ui.row('Workspace',cwd);
ui.row('Endpoint',config.RouterUrl);
if(configureOnly){ui.finish('Configuration saved. Run local-ai-app to open the desktop.');} else {
let release,server;
try{
 start(attach?'Checking the existing llama.cpp server':config.Runtime==='strata'?'Loading Flash with Strata; checking installed engine and model shards':'Loading model into GPU memory; waiting for llama.cpp health');
 if(attach){
  // Explicit opt-in for an existing pia-owned server. Never stop that server.
  const props=await (await fetch(config.RouterUrl+'/props')).json();
  const models=await (await fetch(config.RouterUrl+'/v1/models')).json();
  if(!models.data?.some(m=>m.id===config.ModelId)||props.default_generation_settings?.n_ctx!==config.ContextSize||props.total_slots!==1||path.resolve(props.model_path||'')!==path.resolve(config.ModelFile))throw Error('Existing llama.cpp configuration does not match the selected desktop model');
  console.log('Using the existing server; keep its owning pia session open and submit only one turn at a time.');
 }else{release=await acquireInferenceLock();server=await ensureServer(config);}
 done('Local model server is ready');
 start('Opening Pi App');
 const logPath=path.join(root,'.state/pi-app-launcher.log');
 const {openSync,closeSync}=await import('node:fs');const log=openSync(logPath,'a');
 const child=spawn(executable,debug?['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debug]:[],{cwd,env,windowsHide:true,stdio:['ignore',log,log]});closeSync(log);
 child.once('spawn',()=>{done('Pi App started; its window is opening');ui.finish('Keep this terminal open while using Pi App. Quit Pi App to release the model.');});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code?reject(Error('Pi App exited '+code+'; see '+logPath)):resolve());});
}finally{busy?.stop();busy=undefined;if(server)start('Closing the owned model server');try{await server?.stop();await release?.();}finally{busy?.stop();busy=undefined;}if(server)ui.status(true,'Model stopped; GPU memory released');}
}
}catch(e){busy?.stop();ui.status(false,e.message);ui.line('  Details: '+path.join(root,'.state/pi-app-launcher.log'));process.exitCode=1;}

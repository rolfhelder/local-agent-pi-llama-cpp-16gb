import {readFile,stat,mkdir,copyFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {machine,root,localModels,acquireInferenceLock} from './local-runtime.mjs';
import {hashFile} from './doctor.mjs';
import {consoleUI} from './console-ui.mjs';
import {activity} from './terminal-activity.mjs';

export async function verifyQwenFile(file,expected,onProgress){
 const info=await stat(file).catch(()=>{throw Error('Model not found. Download the pinned IQ4_XS file, then use --model-file PATH. See docs/QWEN38.md.');});
 if(!info.isFile()||info.size!==expected.Size)throw Error('Model size differs from the pinned IQ4_XS file; configuration was not changed.');
 const digest=await hashFile(file,bytes=>onProgress?.(bytes,info.size));
 if(digest!==expected.SHA256)throw Error('Model SHA256 differs from the pinned IQ4_XS file; configuration was not changed.');
 return digest;
}
export function optimizedQwenConfig(previous,file){
 return {...previous,ModelFile:file,ModelId:'qwen38-local',
  ModelFiles:{...previous.ModelFiles,qwen38:file},
  ModelContextSizes:{...previous.ModelContextSizes,qwen38:localModels.qwen38.defaultContext},
  Reasoning:true,ReasoningBudget:2048,MaxTokens:8192};
}
export async function saveQwenConfig(configFile,file,backupDirectory){
 const previous=await readFile(configFile,'utf8'),config=JSON.parse(previous.replace(/^\uFEFF/,''));
 const next=optimizedQwenConfig(config,file);
 await mkdir(backupDirectory,{recursive:true});
 const backup=path.join(backupDirectory,Date.now()+'-qwen38-'+randomUUID()+'.json');
 await copyFile(configFile,backup);
 // Write completely before replacing the configuration; preserve the original backup.
 const temporary=configFile+'.'+randomUUID()+'.tmp';
 await writeFile(temporary,JSON.stringify(next,null,2)+'\n',{flag:'wx'});
 await rename(temporary,configFile);
 return {backup,config:next};
}
export async function applyQwenProfile({configFile,modelFile,backupDirectory,expected,onProgress}){
 const sha256=await verifyQwenFile(modelFile,expected,onProgress);
 return {...await saveQwenConfig(configFile,modelFile,backupDirectory),sha256};
}
export async function main(args=process.argv.slice(2)){
 const ui=consoleUI(args);let busy,release;
 try{
  if(args.includes('--help')){
   ui.title('OPTIMIZE QWEN','Apply the measured 96k profile; no automatic benchmark or download');
   ui.line('  local-ai optimize qwen38 [--model-file PATH] [--json] [--no-color] [--ascii]');
   ui.line('  Verifies the pinned IQ4_XS SHA256, backs up machine.local.json and saves');
   ui.line('  the model path, 98,304 context and enabled medium reasoning.');
   ui.finish('Both launchers use the shared CPU placement, 24 threads, q4 KV and microbatch 64.');return;
  }
  const flags=new Set(['--json','--no-color','--ascii']);let modelFile;
  const rest=[...args];if(rest.shift()!=='qwen38')throw Error('Use local-ai optimize qwen38 [--model-file PATH].');
  for(let i=0;i<rest.length;i++){
   if(rest[i]==='--model-file'){if(modelFile||!rest[i+1]||rest[i+1].startsWith('--'))throw Error('--model-file requires one file path.');modelFile=path.resolve(rest[++i]);}
   else if(!flags.has(rest[i]))throw Error('Unknown option: '+rest[i]);
  }
  const json=args.includes('--json');
  if(!json)ui.title('OPTIMIZE QWEN','Measured settings for 16 GB VRAM / 32 GB RAM / native Windows');
  release=await acquireInferenceLock();
  const config=await machine('qwen38'),file=modelFile??config.ModelFile;
  const [expected]=JSON.parse(await readFile(path.join(root,'manifests/qwen38-download.json'),'utf8'));
  if(!json)busy=activity({stream:process.stderr,ascii:args.includes('--ascii'),color:process.stderr.isTTY&&!args.includes('--no-color')&&!process.env.NO_COLOR,message:'Verifying the 14.25 GB IQ4_XS model; configuration is unchanged until verification passes'});
  const saved=await applyQwenProfile({configFile:path.join(root,'machine.local.json'),modelFile:file,backupDirectory:path.join(root,'.state/config-backups'),expected,onProgress:(bytes,total)=>busy?.update(`Checking SHA256 · ${(bytes/1e9).toFixed(1)} / ${(total/1e9).toFixed(2)} GB · ${Math.floor(bytes/total*100)}%`,bytes/total)});
  busy?.stop();busy=undefined;
  const profile=localModels.qwen38;
  const report={applied:true,profile:'qwen38-96k',modelFile:file,sha256:saved.sha256,context:profile.defaultContext,cpuTensorLayers:profile.cpuTensorLayers,threads:profile.threads,microbatch:profile.microbatch,kv:'q4_0',reasoning:'enabled / 2048-token starting budget',backup:saved.backup,modelStarted:false};
  if(json)console.log(JSON.stringify(report,null,2));else{
   ui.status(true,'Pinned Q4 model verified; local configuration saved');
   ui.row('Model',file);ui.row('Context','98,304 tokens');ui.row('CPU FFN groups',profile.cpuTensorLayers.join(', '));
   ui.row('Threads / microbatch',`${profile.threads} / ${profile.microbatch}`);ui.row('KV / reasoning','q4_0 / enabled, 2048-token starting budget');
   ui.row('Saved effort','Preserved; select medium to reproduce the measured condition');
   ui.row('Configuration backup',saved.backup);
   ui.finish('Ready: local-ai or local-ai-app. Measured ~19 TPS on our machine; this applies a profile, not an automatic speed guarantee.');
  }
 }catch(e){busy?.stop();if(args.includes('--json'))console.log(JSON.stringify({applied:false,error:e.message}));else ui.status(false,e.message);process.exitCode=1;}
 finally{await release?.();}
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { generationLimits, serverArguments, machine, localModels,exec,nodeExe,root,prepareProfile } from '../scripts/local-runtime.mjs';
import {profileLocation,setWorkingFolder} from '../scripts/working-folder.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

test('Qwen27B defaults use the selected CPU offload profile and deleted Q3 is not selectable',async()=>{
 const c=await machine('qwen38');assert.equal(c.ContextSize,localModels.qwen38.defaultContext);assert.equal(c.NativeContext,262144);
 const args=serverArguments(c);assert.equal(args.includes('--n-cpu-ffn'),false);assert.equal(args[args.indexOf('--override-tensor')+1],'^blk\\.(58|59|63)\\.ffn_(gate|up|down)\\.weight$=CPU');assert.equal(args[args.indexOf('--cache-type-k')+1],'q4_0');assert.equal(args[args.indexOf('--cache-type-v')+1],'q4_0');
 assert.equal(Object.hasOwn(localModels,'qwen38-q3'),false);await assert.rejects(machine('qwen38-q3'),/Unknown --model/);
});

test('selected FFN tensor placement excludes other layers and uses explicit thread/microbatch settings',async()=>{
 const original=localModels.qwen38;
 try{
  localModels.qwen38={...original,cpuFfn:undefined,cpuTensorLayers:[58,59,63],microbatch:64,threads:24};
  const args=serverArguments(await machine('qwen38'));
  assert.equal(args.includes('--n-cpu-ffn'),false);
  const rule=args[args.indexOf('--override-tensor')+1],pattern=new RegExp(rule.slice(0,-4));
  for(const layer of [58,59,63])for(const part of ['gate','up','down'])assert.ok(pattern.test(`blk.${layer}.ffn_${part}.weight`));
  for(const name of ['blk.64.ffn_up.weight','blk.57.ffn_up.weight','blk.58.attn_q.weight','prefix.blk.58.ffn_up.weight'])assert.equal(pattern.test(name),false);
  assert.equal(args[args.indexOf('--ubatch-size')+1],'64');
  assert.equal(args[args.indexOf('--threads')+1],'24');
  assert.equal(args[args.indexOf('--threads-batch')+1],'24');
 }finally{localModels.qwen38=original;}
});

test('Flash selector uses Strata at64k and exposes native effort in isolated profiles',async()=>{
 const config=await machine('qwen-flash');assert.equal(config.Runtime,'strata');assert.equal(config.ContextSize,65536);assert.equal(config.Port,48764);
 assert.equal(generationLimits(config).maxTokens,32768);
 const args=serverArguments(config);assert.equal(args[0],'launch');assert.equal(args[args.indexOf('--mtp')+1],'off');assert.equal(args[args.indexOf('--vision')+1],'off');
 const directory=await fs.mkdtemp(path.join(root,'.state/flash-profile-test-'));
 const prepared=await prepareProfile('native',config,directory,{agentDirectory:path.join(directory,'agent')});
 const models=JSON.parse(await fs.readFile(path.join(prepared.agentDir,'models.json'),'utf8'));
 assert.equal(models.providers['local-llama'].models[0].thinkingLevelMap.high,'xhigh');
 assert.equal(prepared.settings.compaction.reserveTokens,8192);
 const preview=JSON.parse((await exec(nodeExe,['scripts/pia.mjs','--model','qwen-flash','--dry-run'],{cwd:root})).stdout);
 assert.match(preview.server,/python\.exe$/);assert.match(preview.arguments[0],/strata\.py$/);
 await assert.rejects(exec(nodeExe,['scripts/pia.mjs','--model','qwen-flash','--context','131072','--dry-run'],{cwd:root}),/65536-token context/);
});

test('working-folder configuration preserves model/reasoning settings and isolates test profiles',async()=>{
 const base=await fs.mkdtemp(path.join(root,'.state/working-folder-test-'));const file=path.join(base,'machine.json');
 await fs.writeFile(file,JSON.stringify({ModelsDirectory:'keep-models',Reasoning:true,ReasoningBudget:4096}));
 await setWorkingFolder(file,base);const config=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(config.ModelsDirectory,'keep-models');assert.equal(config.ReasoningBudget,4096);
 assert.equal(profileLocation(config,'pi-app'),path.join(base,'.pi/local-ai/profiles/pi-app'));
 assert.equal(profileLocation(config,'pi-app',{isolatedDirectory:path.join(base,'isolated')}),path.join(base,'isolated'));
 await assert.rejects(setWorkingFolder(file,'relative/folder'),/absolute/);
});

test('desktop inventory entries also load explicitly once and preserve reasoning metadata',async()=>{
 const base=await fs.mkdtemp(path.join(root,'.state/desktop-profile-test-'));
 const config={...await machine('gemma'),WorkingDirectory:base};
 const prepared=await prepareProfile('pi-app',config,base,{agentDirectory:path.join(base,'isolated')});
 assert.equal(prepared.settings.extensions.length,9);assert.equal(new Set(prepared.settings.extensions).size,9);
 for(const entry of prepared.settings.extensions){assert.equal(path.dirname(path.dirname(entry)),path.join(prepared.agentDir,'extensions'));assert.match(await fs.readFile(entry,'utf8'),/^export \{default\} from "file:\/\//);const pkg=JSON.parse(await fs.readFile(path.join(path.dirname(entry),'package.json'),'utf8'));assert.ok(pkg.description.length>30);assert.equal(pkg.private,true);}
 const models=JSON.parse(await fs.readFile(path.join(prepared.agentDir,'models.json'),'utf8'));
 assert.equal(models.providers['local-llama'].models[0].reasoning,true);
 assert.equal(models.providers['local-llama'].models[0].thinkingLevelMap.high,'high');
 assert.equal(prepared.env.PI_EFFORT_PREFERENCES,path.join(base,'.pi/local-ai/effort-preferences.json'));
 prepared.settings.extensions.push('-extensions/effort.mjs');
 await fs.writeFile(path.join(prepared.agentDir,'settings.json'),JSON.stringify(prepared.settings));
 const again=await prepareProfile('pi-app',config,base,{agentDirectory:prepared.agentDir});
 const effortEntry=path.join(prepared.agentDir,'extensions/effort/index.js');
 assert.ok(again.settings.extensions.includes('-'+effortEntry));
 assert.equal(again.settings.extensions.filter(p=>p.endsWith('effort'+path.sep+'index.js')).length,1);
});
test('candidate registry selects separate coding model files',()=>{assert.match(localModels.omnicoder.file,/Tesslate\/OmniCoder/);assert.match(localModels['gpt-oss'].file,/ggml-org\/gpt-oss/);});
test('GPT-OSS cannot inherit the 200k default window',async()=>{const config=await machine('gpt-oss');assert.ok(config.ContextSize<=131072);assert.equal(config.ModelId,'gpt-oss-local');});
test('explicit launcher context cannot exceed GPT-OSS native window',async()=>{const result=await exec(nodeExe,['scripts/pia.mjs','--model','gpt-oss','--context','204800','--dry-run'],{cwd:root});const command=JSON.parse(result.stdout);assert.equal(command.arguments[command.arguments.indexOf('-c')+1],'131072');});
test('invalid model selection is rejected before loading weights',async()=>{await assert.rejects(machine('not-a-model'),/--model/);});
test('plain pia defaults to the configured Qwen27B profile with reasoning enabled',async()=>{const result=await exec(nodeExe,['scripts/pia.mjs','--dry-run'],{cwd:root});const command=JSON.parse(result.stdout);assert.equal(command.model,'local-llama/qwen38-local');assert.match(command.arguments[command.arguments.indexOf('--model')+1],/Qwen3.8-27B-UD-IQ4_XS.gguf$/);assert.equal(command.arguments[command.arguments.indexOf('-c')+1],String(localModels.qwen38.defaultContext));assert.equal(command.arguments[command.arguments.indexOf('--reasoning')+1],'on');});
test('model selector and legacy alias both select matching server and Pi models',async()=>{for(const flag of ['--model','--local-model']){const result=await exec(nodeExe,['scripts/pia.mjs',flag,'gemma','--dry-run'],{cwd:root});const command=JSON.parse(result.stdout);assert.equal(command.model,'local-llama/gemma-local');assert.equal(command.piArguments.filter(x=>x==='--model').length,1);assert.equal(command.piArguments[command.piArguments.indexOf('--model')+1],'gemma-local');}});
test('coding default reserves room for thinking and answer',()=>assert.deepEqual(generationLimits({ContextSize:32768}),{maxTokens:8192,reasoningBudget:2048}));
test('small context caps generation and leaves answer room',()=>assert.deepEqual(generationLimits({ContextSize:8192}),{maxTokens:2048,reasoningBudget:1024}));
test('explicit reasoning-off control',()=>assert.equal(generationLimits({ContextSize:32768,Reasoning:false}).reasoningBudget,0));
test('reasoning-on server has stable context and port, no silent fit or shifts',()=>{
  const args=serverArguments({ModelFile:'fixture.gguf',ModelId:'fixture',Port:48763,ContextSize:32768,GpuLayers:999});
  assert.equal(args[args.indexOf('--reasoning')+1],'on');assert.equal(args[args.indexOf('--port')+1],'48763');assert.equal(args[args.indexOf('--fit')+1],'off');assert.ok(args.includes('--no-context-shift'));
});

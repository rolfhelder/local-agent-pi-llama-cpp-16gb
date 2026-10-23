import test from 'node:test';
import assert from 'node:assert/strict';
import { generationLimits, serverArguments, machine, localModels,exec,nodeExe,root,prepareProfile } from '../scripts/local-runtime.mjs';
import {profileLocation,setWorkingFolder} from '../scripts/working-folder.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

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
 assert.equal(prepared.settings.extensions.length,7);assert.equal(new Set(prepared.settings.extensions).size,7);
 for(const entry of prepared.settings.extensions){assert.equal(path.dirname(entry),path.join(prepared.agentDir,'extensions'));assert.match(await fs.readFile(entry,'utf8'),/^export \{default\} from "file:\/\//);}
 const models=JSON.parse(await fs.readFile(path.join(prepared.agentDir,'models.json'),'utf8'));
 assert.equal(models.providers['local-llama'].models[0].reasoning,true);
 assert.equal(models.providers['local-llama'].models[0].thinkingLevelMap.high,'high');
 assert.equal(prepared.env.PI_EFFORT_PREFERENCES,path.join(base,'.pi/local-ai/effort-preferences.json'));
 prepared.settings.extensions.push('-extensions/effort.mjs');
 await fs.writeFile(path.join(prepared.agentDir,'settings.json'),JSON.stringify(prepared.settings));
 const again=await prepareProfile('pi-app',config,base,{agentDirectory:prepared.agentDir});
 assert.ok(again.settings.extensions.includes('-extensions/effort.mjs'));
 assert.equal(again.settings.extensions.filter(p=>p.endsWith('effort.mjs')).length,1);
});
test('candidate registry selects separate coding model files',()=>{assert.match(localModels.omnicoder.file,/Tesslate\/OmniCoder/);assert.match(localModels['gpt-oss'].file,/ggml-org\/gpt-oss/);});
test('GPT-OSS cannot inherit the 200k default window',async()=>{const config=await machine('gpt-oss');assert.ok(config.ContextSize<=131072);assert.equal(config.ModelId,'gpt-oss-local');});
test('explicit launcher context cannot exceed GPT-OSS native window',async()=>{const result=await exec(nodeExe,['scripts/pia.mjs','--model','gpt-oss','--context','204800','--dry-run'],{cwd:root});const command=JSON.parse(result.stdout);assert.equal(command.arguments[command.arguments.indexOf('-c')+1],'131072');});
test('invalid model selection is rejected before loading weights',async()=>{await assert.rejects(machine('not-a-model'),/--model/);});
test('plain pia defaults to Gemma at 200k with reasoning enabled',async()=>{const result=await exec(nodeExe,['scripts/pia.mjs','--dry-run'],{cwd:root});const command=JSON.parse(result.stdout);assert.equal(command.model,'local-llama/gemma-local');assert.match(command.arguments[command.arguments.indexOf('--model')+1],/gemma-4-12b-it-Q4_K_M.gguf$/);assert.equal(command.arguments[command.arguments.indexOf('-c')+1],'204800');assert.equal(command.arguments[command.arguments.indexOf('--reasoning')+1],'on');});
test('model selector and legacy alias both select matching server and Pi models',async()=>{for(const flag of ['--model','--local-model']){const result=await exec(nodeExe,['scripts/pia.mjs',flag,'gemma','--dry-run'],{cwd:root});const command=JSON.parse(result.stdout);assert.equal(command.model,'local-llama/gemma-local');assert.equal(command.piArguments.filter(x=>x==='--model').length,1);assert.equal(command.piArguments[command.piArguments.indexOf('--model')+1],'gemma-local');}});
test('coding default reserves room for thinking and answer',()=>assert.deepEqual(generationLimits({ContextSize:32768}),{maxTokens:8192,reasoningBudget:2048}));
test('small context caps generation and leaves answer room',()=>assert.deepEqual(generationLimits({ContextSize:8192}),{maxTokens:2048,reasoningBudget:1024}));
test('explicit reasoning-off control',()=>assert.equal(generationLimits({ContextSize:32768,Reasoning:false}).reasoningBudget,0));
test('reasoning-on server has stable context and port, no silent fit or shifts',()=>{
  const args=serverArguments({ModelFile:'fixture.gguf',ModelId:'fixture',Port:48763,ContextSize:32768,GpuLayers:999});
  assert.equal(args[args.indexOf('--reasoning')+1],'on');assert.equal(args[args.indexOf('--port')+1],'48763');assert.equal(args[args.indexOf('--fit')+1],'off');assert.ok(args.includes('--no-context-shift'));
});

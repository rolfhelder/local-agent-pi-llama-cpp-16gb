import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {applyQwenProfile,optimizedQwenConfig} from '../scripts/optimize.mjs';
import {root,localModels,machine,serverArguments} from '../scripts/local-runtime.mjs';
import {expectedModelHash} from '../scripts/doctor.mjs';

test('Qwen alias pins its checksum in arbitrary folders for acceptance and doctor',async()=>{
 const manifest=JSON.parse(await fs.readFile(path.join(root,'manifests/qwen38-download.json'),'utf8'))[0];
 assert.equal(await expectedModelHash({ModelId:'qwen38-local',ModelFile:path.join(root,'elsewhere','model.gguf')}),manifest.SHA256);
 assert.equal(await expectedModelHash({ModelId:'custom-local',ModelFile:path.join(root,'unknown.gguf')}),undefined);
});

test('optimizer verifies before saving, backs up exact config and retains unrelated model/workspace settings',async()=>{
 const dir=await fs.mkdtemp(path.join(root,'.state/optimize-test-')),configFile=path.join(dir,'machine.local.json'),modelFile=path.join(dir,'fixture.gguf'),backupDirectory=path.join(dir,'backups');
 const old={WorkingDirectory:dir,ModelsDirectory:dir,ContextSize:204800,ModelFiles:{gemma:'existing.gguf'},ModelContextSizes:{gemma:200000},Reasoning:false,Custom:'keep'};
 const source=JSON.stringify(old,null,2)+'\n',bytes=Buffer.from('synthetic optimizer fixture, not real weights');await fs.writeFile(configFile,source);await fs.writeFile(modelFile,bytes);
 const expected={Size:bytes.length,SHA256:'invalid'};
 await assert.rejects(applyQwenProfile({configFile,modelFile,backupDirectory,expected}),/SHA256/);
 assert.equal(await fs.readFile(configFile,'utf8'),source);assert.equal(await fs.stat(backupDirectory).then(()=>true,()=>false),false);
 expected.SHA256=createHash('sha256').update(bytes).digest('hex');let progress=0;
 const result=await applyQwenProfile({configFile,modelFile,backupDirectory,expected,onProgress:n=>progress=n});
 assert.equal(progress,bytes.length);assert.equal(await fs.readFile(result.backup,'utf8'),source);
 const saved=JSON.parse(await fs.readFile(configFile,'utf8'));
 assert.equal(saved.ModelFiles.qwen38,modelFile);assert.equal(saved.ModelFiles.gemma,old.ModelFiles.gemma);
 assert.equal(saved.ModelContextSizes.qwen38,98304);assert.equal(saved.ModelContextSizes.gemma,200000);
 assert.equal(saved.ContextSize,204800);assert.equal(saved.WorkingDirectory,dir);assert.equal(saved.Custom,'keep');assert.equal(saved.Reasoning,true);
 await assert.rejects(applyQwenProfile({configFile,modelFile,backupDirectory,expected:{...expected,Size:1}}),/size/);
 assert.deepEqual(JSON.parse(await fs.readFile(configFile,'utf8')),saved);
});
test('saved model/context overrides feed machine and both launchers without changing other aliases',async()=>{
 const dir=await fs.mkdtemp(path.join(root,'.state/optimize-mapping-')),configFile=path.join(dir,'machine.local.json');
 const base={...await machine(null),ContextSize:32768},q=optimizedQwenConfig(base,path.join(root,'synthetic-qwen.gguf'));
 q.ModelContextSizes.gemma=65536;await fs.writeFile(configFile,JSON.stringify(q));
 assert.equal(q.ModelContextSizes.qwen38,localModels.qwen38.defaultContext);
 const live=await machine('qwen38',{configFile}),args=serverArguments(live);
 assert.equal(live.ModelFile,q.ModelFiles.qwen38);assert.equal(live.ContextSize,98304);
 const other=await machine('gemma',{configFile});assert.equal(other.ContextSize,65536);assert.notEqual(other.ModelFile,live.ModelFile);
 assert.equal(args[args.indexOf('--threads')+1],'24');assert.equal(args[args.indexOf('--ubatch-size')+1],'64');
 for(const argv of [['optimize','--help'],['optimize','unknown'],['optimize','qwen38','--bad']]){
  const r=spawnSync(process.execPath,['scripts/pia.mjs',...argv],{cwd:root,encoding:'utf8',timeout:15000});
  assert.equal(r.status,argv.includes('--help')?0:1);assert.doesNotMatch(r.stdout+r.stderr,/at ModuleJob/);
 }
});

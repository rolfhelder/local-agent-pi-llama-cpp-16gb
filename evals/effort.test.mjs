import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEffort,levels,rewriteSubmit} from '../extensions/effort-core.mjs';
import {addDesktopModelAliases} from '../extensions/pi-app-compat.mjs';
test('desktop metadata aliases preserve canonical SDK fields and cloud models',()=>{
 const local={provider:'local-llama',id:'omnicoder-local',maxTokens:8192};addDesktopModelAliases(local);addDesktopModelAliases(local);
 assert.equal(local.modelId,'omnicoder-local');assert.equal(local.maxOutput,8192);assert.equal(local.id,'omnicoder-local');assert.deepEqual(Object.keys(local),['provider','id','maxTokens']);
 const cloud={provider:'example',id:'other',maxTokens:10};addDesktopModelAliases(cloud);assert.equal(cloud.modelId,undefined);
});
test('budget presets change real request budget without claiming native effort',()=>{const p={messages:[],max_completion_tokens:8192};for(const model of ['qwen','gemma','omnicoder']){assert.equal(applyEffort(p,model,'low').reasoning_budget_tokens,512);assert.equal(applyEffort(p,model,'high').reasoning_budget_tokens,4096);assert.equal(applyEffort(p,model,'high').reasoning_effort,undefined);assert.equal(applyEffort(p,model,'off').chat_template_kwargs.enable_thinking,false);}});
test('GPT-OSS native effort is transmitted, off rejected, answer space retained',()=>{const p={messages:[],max_tokens:2048};assert.deepEqual(levels('gpt-oss'),['low','medium','high']);assert.equal(applyEffort(p,'gpt-oss','high').reasoning_effort,'high');assert.equal(applyEffort(p,'gpt-oss','high').reasoning_budget_tokens,1024);assert.throws(()=>applyEffort(p,'gpt-oss','off'),/not supported/);});
test('model menu dispatch does not alter ordinary input or other commands',()=>{assert.equal(rewriteSubmit('/model'),'/local-model');assert.equal(rewriteSubmit('/model gemma'),'/local-model gemma');assert.equal(rewriteSubmit('/effort high'),'/effort high');assert.equal(rewriteSubmit('explain /model'),'explain /model');});

test('Qwen27B high reaches the native template as xhigh, preserving budgets and other arguments',()=>{
 const input={messages:[],max_tokens:8192,reasoning_effort:'high',chat_template_kwargs:{reasoning_effort:'high',custom:'keep'}};
 for(const [level,native,budget] of [['low','low',512],['medium','medium',2048],['high','xhigh',4096],['xhigh','xhigh',4096]]){
  const p=applyEffort(input,'qwen38',level);assert.equal(p.reasoning_effort,native);assert.equal(p.chat_template_kwargs.reasoning_effort,native);assert.equal(p.reasoning_budget_tokens,budget);assert.equal(p.max_tokens,8192);assert.equal(p.chat_template_kwargs.custom,'keep');assert.equal(p.chat_template_kwargs.enable_thinking,true);assert.equal(p.chat_template_kwargs.preserve_thinking,true);
 }
 const off=applyEffort(input,'qwen38','off');assert.equal(off.chat_template_kwargs.enable_thinking,false);assert.equal(off.reasoning_effort,'none');assert.equal(off.reasoning_budget_tokens,0);assert.equal(input.reasoning_effort,'high');
});

test('Qwen27B SDK metadata agrees with the request hook in CLI and desktop profiles',async()=>{
 const {machine,prepareProfile,root}=await import('../scripts/local-runtime.mjs');const fs=await import('node:fs/promises');const path=await import('node:path');
 const dir=await fs.mkdtemp(path.join(root,'.state/qwen-effort-test-'));
 for(const profile of ['native','pi-app']){const p=await prepareProfile(profile,await machine('qwen38'),dir,{agentDirectory:path.join(dir,profile)});const data=JSON.parse(await fs.readFile(path.join(p.agentDir,'models.json'),'utf8'));const map=data.providers['local-llama'].models[0].thinkingLevelMap;assert.equal(map.high,'xhigh');assert.equal(map.xhigh,'xhigh');assert.equal(map.low,'low');assert.equal(map.medium,'medium');assert.equal(map.off,'none');}
});

test('Pi App built-in thinking selection is observed by the real request hook',async()=>{
 const {default:extension}=await import('../extensions/effort.mjs');let current='medium';const hooks=new Map();const pi={registerCommand(){},on:(name,fn)=>hooks.set(name,fn),getThinkingLevel:()=>current};extension(pi);const ctx={model:{provider:'local-llama',id:'qwen38-local'}};
 const request=hooks.get('before_provider_request');assert.equal(typeof request,'function');
 for(const [level,native]of [['medium','medium'],['high','xhigh'],['low','low']]){current=level;const p=request({payload:{messages:[],max_tokens:8192}},ctx);assert.equal(p.reasoning_effort,native);assert.equal(p.chat_template_kwargs.reasoning_effort,native);assert.equal(p.reasoning_budget_tokens,level==='high'?4096:level==='low'?512:2048);}
});

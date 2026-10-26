import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {englishAdapter,applyEnglishAdapters} from '../scripts/pi-app-i18n.mjs';
const fixture={id:'sample',description:'中文',displayName:'名称',match:{commands:['/sample']},slash:{'/sample':{type:'command'}},config:{enabled:true},i18n:{en:{description:'Meaningful English description',displayName:'Sample'}}};
test('English adapter only changes display text, preserving command behavior and translations',()=>{
 const translated=englishAdapter(fixture);
 assert.equal(translated.description,fixture.i18n.en.description);
 assert.equal(translated.displayName,'Sample');
 for(const key of Object.keys(fixture).filter(k=>!['description','displayName'].includes(k)))assert.deepEqual(translated[key],fixture[key]);
 assert.equal(fixture.description,'中文');
 assert.equal(englishAdapter({...fixture,description:'Already English'}),undefined);
 assert.equal(englishAdapter({...fixture,i18n:{}}),undefined);
});
test('application is idempotent and preflights conflicts before creating any adapters',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pi-app-i18n-')),source=path.join(root,'source'),workspace=path.join(root,'workspace');
 await mkdir(source);await writeFile(path.join(source,'sample.adapter.json'),JSON.stringify(fixture));
 const first=await applyEnglishAdapters({source,workspace});assert.equal(first.created.length,1);
 assert.equal((await applyEnglishAdapters({source,workspace})).unchanged.length,1);
 await writeFile(path.join(first.target,'sample.adapter.json'),JSON.stringify({...fixture,description:'Custom description'}));
 await writeFile(path.join(source,'another.adapter.json'),JSON.stringify({...fixture,id:'another'}));
 await assert.rejects(()=>applyEnglishAdapters({source,workspace}),/customizations require review/);
 assert.equal((await readdir(first.target)).length,1);
 assert.equal(JSON.parse(await readFile(path.join(first.target,'sample.adapter.json'),'utf8')).description,'Custom description');
});

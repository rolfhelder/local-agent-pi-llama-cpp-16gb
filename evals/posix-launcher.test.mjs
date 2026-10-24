import test from 'node:test';
import assert from 'node:assert/strict';
import {root,nodeExe,exec} from '../scripts/local-runtime.mjs';
test('POSIX dry run selects Qwen96k, bash tools and no Windows policy',async()=>{
 const {stdout}=await exec(nodeExe,['scripts/pia-unix.mjs','--dry-run'],{cwd:root});const r=JSON.parse(stdout);
 assert.equal(r.model,'qwen38-local');assert.equal(r.context,98304);assert.ok(r.defaultTools.includes('bash'));assert.ok(!r.defaultTools.includes('powershell'));assert.ok(!r.extensions.some(p=>p.includes('windows')));
 assert.equal(r.serverArguments[r.serverArguments.indexOf('--override-tensor')+1],'^blk\\.(58|59|63)\\.ffn_(gate|up|down)\\.weight$=CPU');
});
test('POSIX launcher rejects context beyond native window before inference',async()=>{
 await assert.rejects(exec(nodeExe,['scripts/pia-unix.mjs','--model','gpt-oss','--context','204800','--dry-run'],{cwd:root}),/Context must fit/);
});

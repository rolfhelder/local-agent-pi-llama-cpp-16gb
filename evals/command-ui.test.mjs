import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {root} from '../scripts/local-runtime.mjs';
import {consoleUI} from '../scripts/console-ui.mjs';
import {activity} from '../scripts/terminal-activity.mjs';
import {contextAppearance} from '../scripts/pi-app-appearance.mjs';
const launch=args=>spawnSync(process.execPath,[path.join(root,'scripts/pia.mjs'),...args],{encoding:'utf8',timeout:15000,cwd:root});

test('desktop context styling preserves active custom CSS and applies only once',()=>{
 const styled=contextAppearance({enabled:true,css:'.personal { color: blue; }'});
 assert.ok(styled.css.includes('.personal { color: blue; }'));
 assert.deepEqual(contextAppearance(styled),styled);
 assert.ok(styled.css.includes('--local-ai-context-fill:100%'));
 assert.ok(styled.css.includes('height:14px'));
 assert.ok(styled.css.includes('content:attr(aria-label)'));
 assert.ok(!contextAppearance({enabled:false,css:'.disabled { display:none; }'}).css.includes('.disabled'));
});

test('desktop startup reports its initial operation and readable errors before model loading',()=>{
 let text='';const busy=activity({message:'Loading model into GPU memory',stream:{write:s=>text+=s,isTTY:false},ascii:true});busy.stop();
 assert.match(text,/Loading model into GPU memory/);assert.doesNotMatch(text,/Inspecting local runtime/);
 const result=spawnSync(process.execPath,[path.join(root,'scripts/pi-app.mjs'),'--unknown','--ascii','--no-color'],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,1);assert.match(result.stdout,/LOCAL AI \/ PI APP/);assert.match(result.stdout,/\[X\] Unknown arguments/);assert.doesNotMatch(result.stderr,/at ModuleJob/);
});
test('human renderer neutralizes terminal control injection and separates labels',()=>{
 let text='';const ui=consoleUI([],{write:s=>text+=s,isTTY:false});ui.row('Existing keys preserved',11);ui.status(false,'bad\x1b[2Jvalue');
 assert.match(text,/preserved\s+11/);assert.doesNotMatch(text,/\x1b/);
});
test('help and invalid flags do not start inference',()=>{
 const help=launch(['help']);assert.equal(help.status,0);assert.match(help.stdout,/local-ai test --run/);assert.doesNotMatch(help.stdout,/local-ai (presets|receipts|eval|progress|config)/);
 for(const args of [['presets'],['receipts'],['eval'],['progress'],['config'],['--preset','coding']]){const invalid=launch(args);assert.equal(invalid.status,1);assert.match(invalid.stderr,/retired/);assert.doesNotMatch(invalid.stderr,/at ModuleJob/);}
});

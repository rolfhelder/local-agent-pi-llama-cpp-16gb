import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Pi App 0.7.6's static command catalog uses adapter defaults rather than
// i18n.en. Supported project adapters let us change display text only.
export function englishAdapter(adapter){
 const english=adapter.i18n?.en;
 if(!english?.description||!/\p{Script=Han}/u.test(adapter.description??''))return undefined;
 return {...adapter,description:english.description,...(english.displayName?{displayName:english.displayName}:{})};
}

export async function applyEnglishAdapters({source,workspace}){
 const target=path.join(path.resolve(workspace),'.pi','desktop','adapters');
 const pending=[],unchanged=[],conflicts=[];
 for(const name of (await readdir(source)).filter(n=>n.endsWith('.adapter.json')).sort()){
  const adapter=JSON.parse(await readFile(path.join(source,name),'utf8'));
  const english=englishAdapter(adapter);if(!english)continue;
  const file=path.join(target,name),content=JSON.stringify(english,null,2)+'\n';
  try{
   const existing=JSON.parse(await readFile(file,'utf8'));
   if(JSON.stringify(existing)===JSON.stringify(english))unchanged.push(name);
   else conflicts.push(name);
  }catch(error){if(error.code==='ENOENT')pending.push({name,file,content});else throw error;}
 }
 // Preflight every destination before any write; never replace customization.
 if(conflicts.length)throw Error('Existing adapter customizations require review: '+conflicts.join(', '));
 await mkdir(target,{recursive:true});
 for(const {file,content} of pending)await writeFile(file,content,{flag:'wx'});
 return {created:pending.map(p=>p.name),unchanged,target};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=flag=>{const at=args.indexOf(flag);if(at<0||!args[at+1]||args[at+1].startsWith('--'))throw Error('Usage: node scripts/pi-app-i18n.mjs --source <Pi-App-source/src/extension-compat/builtin> --workspace <project>');return args.splice(at,2)[1];};
 try{const source=value('--source'),workspace=value('--workspace');if(args.length)throw Error('Unknown arguments: '+args.join(' '));const result=await applyEnglishAdapters({source,workspace});console.log(`English descriptions: ${result.created.length} created, ${result.unchanged.length} already configured.\n${result.target}\nReopen the slash menu to refresh its catalog; restart Pi App if needed.`);}catch(error){console.error(error.message);process.exitCode=1;}
}

import {readFile,writeFile,mkdir,stat,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function profileLocation(config,name,{isolatedDirectory}={}){
 if(isolatedDirectory)return path.resolve(isolatedDirectory);
 return config.WorkingDirectory?path.join(path.resolve(config.WorkingDirectory),'.pi/local-ai/profiles',name):path.join(root,'.state/profiles',name);
}
export async function setWorkingFolder(configFile,folder){
 if(!path.isAbsolute(folder))throw Error('Choose an absolute working-folder path.');
 folder=path.resolve(folder);
 if(!(await stat(folder)).isDirectory())throw Error('Working folder must be an existing directory.');
 const config=JSON.parse((await readFile(configFile,'utf8')).replace(/^\uFEFF/,''));
 const backup=path.join(root,'.state/config-backups',Date.now()+'-working-folder.json');await mkdir(path.dirname(backup),{recursive:true});await copyFile(configFile,backup);
 await mkdir(path.join(folder,'.pi/local-ai'),{recursive:true});
 await writeFile(path.join(folder,'.pi/local-ai/.gitignore'),'*\n',{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 config.WorkingDirectory=folder;
 await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
 return folder;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const folder=await setWorkingFolder(path.join(root,'machine.local.json'),process.argv[2]??'');console.log('Working folder saved: '+folder);console.log('Pi profiles and sessions: '+path.join(folder,'.pi/local-ai'));}catch(error){console.error(error.message);process.exitCode=1;}
}

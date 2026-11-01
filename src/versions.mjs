import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {ROOT} from './config.mjs';
export const VERSION_MATRIX=JSON.parse(fs.readFileSync(path.join(ROOT,'versions.json'),'utf8'));
export const SUPPORTED_VERSIONS=VERSION_MATRIX.versions.map(x=>x.id);
export function versionEntry(id){const found=VERSION_MATRIX.versions.find(x=>x.id===id);if(!found)throw Error('尚不支持 Minecraft '+id+'；请选择1.21系列正式版本。');return found;}
const hashes=new Map();
async function identify(file,matrix){
  try{
    const stat=await fs.promises.stat(file);if(!stat.isFile())return null;
    const key=file+'|'+stat.size+'|'+stat.mtimeMs;
    let hash=hashes.get(key);if(!hash){const h=createHash('sha1');for await(const chunk of fs.createReadStream(file))h.update(chunk);hash=h.digest('hex');hashes.set(key,hash);}
    const entry=matrix.find(x=>x.client.sha1===hash);
    return entry?{version:entry.id,jar:file,home:path.dirname(file),size:stat.size}:null;
  }catch{return null;}
}
export async function findInstalledGames(home='',root=ROOT,matrix=VERSION_MATRIX.versions){
  const candidates=new Map();const add=(p,origin)=>{if(!candidates.has(p))candidates.set(p,origin);};
  const homes=[[home,'selected'],[process.env.FISH_MINECRAFT_HOME,'selected'],[path.join(process.env.APPDATA||os.homedir(),'.minecraft'),'default']].filter(([p])=>p);
  for(const [base,origin] of homes){
    const resolved=path.resolve(base.trim().replace(/^"|"$/g,''));
    if(resolved.endsWith('.jar'))add(resolved,origin);
    for(const id of SUPPORTED_VERSIONS){add(path.join(resolved,'versions',id,id+'.jar'),origin);add(path.join(resolved,id+'.jar'),origin);}
    add(path.join(resolved,'client.jar'),origin);
    try{for(const file of (await fs.promises.readdir(resolved,{withFileTypes:true})).slice(0,250))if(file.isFile()&&file.name.endsWith('.jar'))add(path.join(resolved,file.name),origin);}catch{}
    const versionsDir=path.basename(resolved).toLowerCase()==='versions'?resolved:path.join(resolved,'versions');
    try{for(const dir of (await fs.promises.readdir(versionsDir,{withFileTypes:true})).slice(0,250))if(dir.isDirectory()){
      const folder=path.join(versionsDir,dir.name);let relevant=/1\.21(?:\.\d+)?/.test(dir.name);
      if(!relevant)try{const meta=JSON.parse(await fs.promises.readFile(path.join(folder,dir.name+'.json'),'utf8'));relevant=SUPPORTED_VERSIONS.includes(meta.inheritsFrom)||SUPPORTED_VERSIONS.includes(meta.id);}catch{}
      if(relevant)for(const file of (await fs.promises.readdir(folder)).slice(0,30))if(file.endsWith('.jar'))add(path.join(folder,file),origin);
    }}catch{}
  }
  add(path.join(root,'runtime/client/client.jar'),'cache');
  for(const id of SUPPORTED_VERSIONS)add(path.join(root,'runtime/versions',id,'client.jar'),'cache');
  const games=[];for(const [file,origin] of candidates){const game=await identify(file,matrix);if(game)games.push({...game,origin});}
  return games.sort((a,b)=>SUPPORTED_VERSIONS.indexOf(b.version)-SUPPORTED_VERSIONS.indexOf(a.version));
}
export function chooseGame(games,settings){
  const version=settings.minecraftVersion||'auto';if(version!=='auto')versionEntry(version);
  const matches=games.filter(g=>version==='auto'||g.version===version);
  return matches.find(g=>g.origin==='selected')||matches.find(g=>g.version===settings.resolvedVersion)||matches[0]||null;
}
export function readPrepared(root=ROOT){try{return JSON.parse(fs.readFileSync(path.join(root,'runtime/prepared.json'),'utf8'));}catch{return null;}}
export function gameWorldName(settings){const v=settings.resolvedVersion||'1.21.4';return settings.world+(v==='1.21.4'?'':'-'+v);}

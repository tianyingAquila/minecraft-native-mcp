import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DATA} from './config.mjs';
import {gameWorldName,versionEntry} from './versions.mjs';

const legacyNames={rehearsal:'排练世界',live:'正式世界'};
export function worldInfo(settings,{data=DATA}={}){
 const version=settings.resolvedVersion||'1.21.4',id=settings.world;
 const directory=path.join(data,'worlds',gameWorldName({world:id,resolvedVersion:version}));
 let metadata;
 try{metadata=JSON.parse(fs.readFileSync(path.join(directory,'world-info.json'),'utf8'));}catch{}
 if(metadata&&(metadata.id!==id||metadata.version!==version))throw Error('世界信息与所选版本不一致，请重新选择存档。');
 return {id,version,name:metadata?.name||(fs.existsSync(directory)?legacyNames[id]:'默认新世界')||id,createdAt:metadata?.createdAt||null,deletable:fs.existsSync(directory),
  generated:fs.existsSync(path.join(directory,'world/level.dat')),seed:metadata?.seed||''};
}
export function listWorlds(settings,{data=DATA}={}){
 const worlds=new Map();
 const add=s=>{const row=worldInfo(s,{data});worlds.set(row.id+'@'+row.version,row);};
 const base=path.join(data,'worlds');
 for(const entry of fs.existsSync(base)?fs.readdirSync(base,{withFileTypes:true}):[]){
  if(!entry.isDirectory())continue;
  const legacy=/^(rehearsal|live)(?:-(1\.21(?:\.\d+)?))?$/.exec(entry.name);
  if(legacy){try{versionEntry(legacy[2]||'1.21.4');add({world:legacy[1],resolvedVersion:legacy[2]||'1.21.4'});}catch{}continue;}
  try{const meta=JSON.parse(fs.readFileSync(path.join(data,'worlds',entry.name,'world-info.json'),'utf8'));versionEntry(meta.version);
   if(gameWorldName({world:meta.id,resolvedVersion:meta.version})===entry.name)add({world:meta.id,resolvedVersion:meta.version});
  }catch{}
 }
 add(settings);
 return [...worlds.values()].map(({seed,...publicInfo})=>publicInfo).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
export function createWorld({name,version,seed=''},{data=DATA}={}){
 if(typeof name!=='string'||!name.trim()||name.trim().length>40||/[\x00-\x1f\x7f]/.test(name))throw Error('世界名称请填写1–40个字。');
 versionEntry(version);
 if(typeof seed!=='string'||seed.length>128||/[\r\n\x00]/.test(seed))throw Error('种子请留空，或填写128字以内的数字/文字。');
 const id='world-'+randomUUID(),directory=path.join(data,'worlds',gameWorldName({world:id,resolvedVersion:version}));
 fs.mkdirSync(path.dirname(directory),{recursive:true});fs.mkdirSync(directory);
 fs.writeFileSync(path.join(directory,'world-info.json'),JSON.stringify({id,name:name.trim(),version,seed:seed.trim(),createdAt:Date.now()},null,2)+'\n',{flag:'wx'});
 return worldInfo({world:id,resolvedVersion:version},{data});
}
export function selectWorldInfo(id,version,settings,options){
 versionEntry(version);
 const row=listWorlds(settings,options).find(w=>w.id===id&&w.version===version);
 if(!row)throw Error('找不到这个世界，请刷新列表后重新选择。');
 return row;
}
export function saveWorldSession(settings,state,{data=DATA}={}){
 const directory=path.join(data,'worlds',gameWorldName(settings));
 fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'world-session.json'),JSON.stringify({goal:state.goal,runningMs:state.elapsed(),deaths:state.deaths,usage:state.usage},null,2)+'\n');
}
export function readWorldSession(settings,{data=DATA}={}){
 try{return JSON.parse(fs.readFileSync(path.join(data,'worlds',gameWorldName(settings),'world-session.json'),'utf8'));}catch{return {};}
}
async function recycleDirectory(directory){
 if(process.platform!=='win32')throw Error('当前仅支持Windows回收站删除。');
 await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:FISH_RECYCLE_PATH,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"],{windowsHide:true,timeout:60000,env:{...process.env,FISH_RECYCLE_PATH:directory}});
}
export async function trashWorld(info,{data=DATA,recycle=recycleDirectory}={}){
 const key=gameWorldName({world:info.id,resolvedVersion:info.version}),root=path.resolve(data);
 const relatives=['worlds/'+key,'world-clients/'+key,'agent-'+key+'.json','client-agent-'+key+'.sqlite','client-agent-'+key+'.sqlite-wal','client-agent-'+key+'.sqlite-shm'];
 const owned=relatives.map(relative=>({relative,source:path.resolve(root,relative)}));
 if(owned.some(x=>!x.source.startsWith(root+path.sep)))throw Error('世界删除路径不在当前项目内。');
 const existing=owned.filter(x=>fs.existsSync(x.source));if(!existing.length)throw Error('这个世界已经不存在，请刷新列表。');
 const staging=path.join(root,'deleted-worlds',info.id+'-'+Date.now());fs.mkdirSync(staging,{recursive:true});const moved=[];
 try{
  for(const row of existing){const dest=path.join(staging,row.relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.renameSync(row.source,dest);moved.push({...row,dest});}
  fs.writeFileSync(path.join(staging,'恢复说明.txt'),'世界：'+info.name+'\n版本：'+info.version+'\n从回收站还原本目录后，将其中各文件按相对目录移回 '+root+'。\n现有备份未删除。\n');
  await recycle(staging);
 }catch(error){
  for(const row of moved.reverse())if(fs.existsSync(row.dest)){fs.mkdirSync(path.dirname(row.source),{recursive:true});fs.renameSync(row.dest,row.source);}
  fs.rmSync(staging,{recursive:true,force:true});throw Error('移入回收站失败，已恢复原文件：'+error.message);
 }
 return {name:info.name,files:existing.length};
}

import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {SetupError} from './setup-state.mjs';

export function fabricLibrary(lib){
 const parts=typeof lib?.name==='string'?lib.name.split(':'):[];
 if(parts.length!==3||parts.some(x=>!x||!/^[a-zA-Z0-9_.+\-]+$/.test(x)))throw Error('Fabric库坐标无效');
 const [group,name,version]=parts,relative=group.replaceAll('.','/')+'/'+name+'/'+version+'/'+name+'-'+version+'.jar';
 if(relative.split('/').some(x=>x==='.'||x==='..'))throw Error('Fabric库路径无效');
 const url=new URL(relative,lib.url.replace(/\/?$/,'/'));
 if(url.protocol!=='https:')throw Error('Fabric库地址必须使用HTTPS');
 return {name:lib.name,relative,url:url.href};
}
function validateProfile(profile,version,loader){
 if(profile?.inheritsFrom!==version||profile.id!==`fabric-loader-${loader}-${version}`||profile.mainClass!=='net.fabricmc.loader.impl.launch.knot.KnotClient'||!Array.isArray(profile.libraries)||!profile.libraries.length)throw Error('Fabric启动配置与当前版本不符或格式不完整');
 const libraries=profile.libraries.map(fabricLibrary);
 if(new Set(libraries.map(x=>x.name)).size!==libraries.length||!libraries.some(x=>x.name===`net.fabricmc:fabric-loader:${loader}`))throw Error('Fabric库列表无效或缺少对应加载器');
 return libraries;
}
const digest=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function sealFabricMetadata(data){return {data,sha256:digest(data)};}
export function validateFabricMetadata(envelope,version,loader){
 const data=envelope?.data;
 if(!data||envelope.sha256!==digest(data)||data.schema!==1||data.version!==version||data.loader!==loader)throw Error('Fabric清单不完整或版本不匹配');
 const libraries=validateProfile(data.profile,version,loader).map(lib=>{
  const entry=data.libraries?.find(x=>x.name===lib.name&&x.url===lib.url);
  if(!entry||!/^[0-9a-f]{40}$/i.test(entry.sha1))throw Error('Fabric运行库缺少有效校验值：'+lib.name);
  return {...lib,sha1:entry.sha1.toLowerCase()};
 });
 return {profile:data.profile,libraries};
}
async function requestMetadata(url,parse,{signal,fetchImpl,onProgress,label,code,timeoutMs,retryDelayMs}){
 let last,attempts=0;
 for(let attempt=1;attempt<=3;attempt++){
  signal?.throwIfAborted();attempts=attempt;const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  try{const response=await fetchImpl(url,{signal:combined});
   if(!response.ok){const e=Error('HTTP '+response.status);e.retryable=[408,429].includes(response.status)||response.status>=500;throw e;}
   return parse(await response.text());
  }catch(error){
   if(signal?.aborted)throw signal.reason;last=error;
   if(error.retryable===false||attempt===3)break;
   onProgress({message:`${label}连接暂时失败，正在重试（${attempt+1}/3）`,attempt:attempt+1});
   await delay(retryDelayMs*attempt,undefined,{signal});
  }
 }
 const detail=last?.name==='TimeoutError'?`请求超时（${timeoutMs/1000}秒）`:String(last?.cause?.code||last?.code||last?.message||'网络失败');
 throw new SetupError(code,'mods','无法读取 '+label,new URL(url).host+'：'+detail+`；已尝试${attempts}次`,'优先安装包含内置Fabric清单的完整发布包；缺失时请检查该下载源后重试。');
}
export async function fetchFabricMetadata(version,loader,{signal,fetchImpl=fetch,onProgress=()=>{},timeoutMs=15000,retryDelayMs=500}={}){
 const options={signal,fetchImpl,onProgress,timeoutMs,retryDelayMs};
 const url=`https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/profile/json`;
 const profile=await requestMetadata(url,text=>{const p=JSON.parse(text);validateProfile(p,version,loader);return p;},{...options,label:'Fabric启动配置',code:'FABRIC_PROFILE'});
 const libraries=[];
 for(const lib of validateProfile(profile,version,loader)){
  const sha1=await requestMetadata(lib.url+'.sha1',text=>{const hash=text.trim().split(/\s/)[0];if(!/^[0-9a-f]{40}$/i.test(hash))throw Error('校验值格式无效');return hash.toLowerCase();},{...options,label:'Fabric运行库校验信息 '+lib.name,code:'FABRIC_LIBRARY'});
  libraries.push({name:lib.name,url:lib.url,sha1});
 }
 return sealFabricMetadata({schema:1,version,loader,profile,libraries});
}
export async function resolveFabricMetadata({root,version,loader,signal,onProgress=()=>{},...options}){
 signal?.throwIfAborted();
 try{const bundled=JSON.parse(await fs.promises.readFile(path.join(root,'fabric-lock.json'),'utf8'));const record=validateFabricMetadata(bundled.versions?.[version],version,loader);onProgress({message:'已确认插件内置 Fabric 启动配置和运行库校验信息'});return {...record,source:'bundled'};}catch(error){if(signal?.aborted)throw signal.reason;}
 const file=path.join(root,'runtime/versions',version,'fabric-metadata-'+loader+'.json');
 try{const record=validateFabricMetadata(JSON.parse(await fs.promises.readFile(file,'utf8')),version,loader);onProgress({message:'已确认缓存的 Fabric 启动配置和运行库校验信息'});return {...record,source:'cache'};}catch(error){if(signal?.aborted)throw signal.reason;}
 onProgress({message:'本地 Fabric 清单缺失或不完整，正在补取一次'});
 const envelope=await fetchFabricMetadata(version,loader,{signal,onProgress,...options});signal?.throwIfAborted();
 const temp=file+'.'+randomUUID()+'.tmp';await fs.promises.mkdir(path.dirname(file),{recursive:true});
 try{await fs.promises.writeFile(temp,JSON.stringify(envelope,null,2)+'\n');signal?.throwIfAborted();await fs.promises.rename(temp,file);}finally{await fs.promises.rm(temp,{force:true});}
 return {...validateFabricMetadata(envelope,version,loader),source:'network'};
}

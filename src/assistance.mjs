import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// A request exists only while its caller is waiting; no background poller or port.
export async function assistanceQuery(call,target,{radius=96,structureChunks=32,signal,timeoutMs=12000}={}) {
 const info=await call('fish.assistInfo');
 if(!info.available||!path.isAbsolute(info.directory||''))throw Error('当前游戏未连接同机辅助服务；请更新模组并重新准备游戏。');
 const self=await call('player.getState');
 const id=randomUUID(),base=path.join(info.directory,id),request=base+'.request.json',result=base+'.result.json';
 await fs.mkdir(info.directory,{recursive:true});
 const deadline=Date.now()+timeoutMs;
 await fs.writeFile(base+'.tmp',JSON.stringify({target,radius,structureChunks,dimension:self.dimension,deadline}));
 await fs.rename(base+'.tmp',request);
 let settled=false;
 try {
  while(Date.now()<deadline+500){
   signal?.throwIfAborted();
   try{const value=JSON.parse(await fs.readFile(result,'utf8'));settled=true;if(value.error)throw Error(value.error);return value;}
   catch(error){if(error.code!=='ENOENT')throw error;}
   await delay(75,undefined,{signal});
  }
  throw Error('辅助查询达到时间上限；没有确认结果，不要连续重复相同搜索。');
 }finally{
  await Promise.all([request,result,base+'.tmp'].map(file=>fs.rm(file,{force:true}).catch(()=>{})));
  if(!settled){await fs.writeFile(base+'.cancel','').catch(()=>{});setTimeout(()=>{void fs.rm(base+'.cancel',{force:true});void fs.rm(result,{force:true});},timeoutMs+1000).unref();}
 }
}

export async function locateResource(args,{call,signal}={}) {
 const target=args.target;
 if(!['lava_lake','nether_fortress','village','ruined_portal','stronghold','piglin','blaze','enderman'].includes(target))throw Error('请选择岩浆湖、地狱堡垒、村庄、废弃传送门、末地要塞或猪灵/烈焰人/末影人。');
 const radius=args.radius??96,structureChunks=args.structureChunks??32;
 if(!Number.isInteger(radius)||radius<16||radius>256||!Number.isInteger(structureChunks)||structureChunks<1||structureChunks>64)throw Error('生物/岩浆搜索16–256格，结构搜索1–64个区块。');
 if(['piglin','blaze','enderman'].includes(target)) {
  const result=await assistanceQuery(call,'entities',{radius,signal});
  const entities=result.entities.filter(e=>e.type==='minecraft:'+target&&(e.health??1)>0&&!(target==='piglin'&&e.baby)).slice(0,5);
  return {source:result.source,dimension:result.dimension,target,found:entities.length>0,radius,entities,note:'只查询当前已加载的生物；未找到不代表更远处没有。坐标不是安全路线。'};
 }
 const result=await assistanceQuery(call,target,{radius,structureChunks,signal});
 if(target!=='lava_lake'&&result.position){
  // Vanilla structure locators often return Y=0, which is not an entrance.
  const {x,z}=result.position;result.position={x,z};result.heightKnown=false;delete result.distance;
  result.note='服务端提供结构的水平坐标，高度和入口未知。不要朝Y=0挖掘；选择可通行高度接近，再观察实际建筑。';
 }
 return result;
}

// Owned disposable fixture: real melee pursuit and recovery; never starts a model loop.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {Runtime} from '../src/runtime.mjs';
import {ROOT} from '../src/config.mjs';
import {createWorld,trashWorld} from '../src/worlds.mjs';
import {chatCompletion,fetchBalance,canSpend,reserveFor} from '../src/deepseek.mjs';
import {withCommentary} from '../src/commentary.mjs';
const world=createWorld({name:'战斗烟测（临时）',version:'1.21.4',seed:'10991'}),r=new Runtime();
r.store.persist=false;r.store.settings={...r.store.settings,world:world.id,minecraftVersion:world.version,minecraftHome:path.join(ROOT,'runtime/versions/1.21.4/client.jar'),resolvedVersion:world.version,streamingEnabled:false,nativeHudEnabled:false};
const edgesOnly=process.argv.includes('--edges-only');
const out=path.join(ROOT,'outputs/smoke',edgesOnly?'combat-edges':'combat');fs.mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),version:world.version,modelRequests:0,world:world.id,steps:[],passed:false};
const record=(step,data={})=>{report.steps.push({step,...data});console.log(JSON.stringify({step,...data}));};
const overlay=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"hudEnabled":false}');});
await new Promise(resolve=>overlay.listen(0,'127.0.0.1',resolve));process.env.FISH_OVERLAY_URL='http://127.0.0.1:'+overlay.address().port+'/';
let b;
const waitFor=async(test,message,timeout=15000)=>{const until=Date.now()+timeout;while(!await test()){if(Date.now()>until)throw Error(message);await sleep(100);}};
const commands=list=>{for(const command of list)r.minecraft.command(command);};
async function setupMob(type,x=8,z=0){
 const previousIds=new Set((await b.call('perception.entities',{radius:32,kinds:[]})).entities.map(e=>e.uuid));
 commands(['kill @e[type=!minecraft:player]','clear DeepSeekFish','tp DeepSeekFish 0.5 200 0.5','effect give DeepSeekFish minecraft:instant_health 1 5 true','effect give DeepSeekFish minecraft:saturation 1 5 true','give DeepSeekFish minecraft:stone_sword 1',`summon minecraft:${type} ${x} 200 ${z} {PersistenceRequired:1b}`]);
 await waitFor(async()=>{const i=await b.call('player.getInventory'),p=await b.call('player.getState');return [...i.hotbar,...i.main].some(s=>s.id==='minecraft:stone_sword')&&Math.abs(p.x-.5)<.5&&p.health>=20;},'fixture player did not synchronize');
 let target;await waitFor(async()=>{target=(await b.call('perception.entities',{radius:32,kinds:[]})).entities.find(e=>e.type==='minecraft:'+type&&!previousIds.has(e.uuid));return Boolean(target);},'fixture target did not synchronize');return target;
}
try{
 await r.prepare({requireModel:false});b=r.mcp.bridge;record('prepared',{tools:r.store.tools});r.minecraft.resume();await r.mcp.resume();
 commands(['forceload add -16 -16 16 16']);
 await waitFor(async()=>{r.minecraft.command('execute if loaded 0 199 0 run say fish_combat_chunk_ready');return r.minecraft.lines.some(line=>line.includes('fish_combat_chunk_ready'));},'fixture chunk unavailable',20000);
 commands(['fill -12 199 -12 12 199 12 minecraft:stone','fill -12 200 -12 12 205 12 minecraft:air','fill -12 200 -12 -12 203 12 minecraft:bedrock','fill 12 200 -12 12 203 12 minecraft:bedrock','fill -12 200 -12 12 203 -12 minecraft:bedrock','fill -12 200 12 12 203 12 minecraft:bedrock','time set midnight','weather clear','tp DeepSeekFish 0.5 200 0.5']);
 await waitFor(async()=>JSON.stringify(await b.call('fish.probeBlocks',{positions:[{x:0,y:199,z:0}]})).includes('minecraft:stone'),'fixture floor unavailable');
 for(const type of edgesOnly?[]:['cow','skeleton','skeleton']){
  const mob=await setupMob(type),before=await b.call('player.getState');let args={uuid:mob.uuid,weapon:'stone_sword',seconds:30};
  if(type==='skeleton'&&process.argv.includes('--model')&&report.modelRequests===0){
   const body={model:r.store.settings.model,messages:[{role:'system',content:fs.readFileSync(path.join(ROOT,'prompts/game.md'),'utf8')},{role:'user',content:JSON.stringify(await r.mcp.status())+'\n受控验证：用已有石剑对眼前唯一的骷髅完成一次连续近战任务，不拆成先走近再逐次攻击。'}],tools:r.mcp.tools().filter(t=>['fight_entity','attack_entity','travel_to','equip_item'].includes(t.function.name)).map(t=>withCommentary(t)),tool_choice:'required',thinking:{type:'disabled'},max_tokens:512};
   const balance=await fetchBalance();if(!canSpend(balance,reserveFor(body)))throw Error('model decision skipped: balance floor');
   const response=await chatCompletion(body,{});report.modelRequests++;report.modelUsage=response.usage;const action=response.choices[0].message.tool_calls?.[0];assert.equal(action?.function.name,'fight_entity');
   const {say,reaction,...input}=JSON.parse(action.function.arguments);args=r.mcp.normalizeArgs('fight_entity',input);assert.equal(args.uuid,mob.uuid);record('model-selected-continuous-melee',{tool:action.function.name,say,weapon:args.weapon});
  }
  const result=await r.mcp.execute('fight_entity',args);
  record('melee-'+type,{result,healthBefore:before.health});assert.equal(result.state,'succeeded');assert.equal(result.result.deathObserved,true);assert.ok(result.result.attacks>0);assert.equal(result.evidence.targetDeathObserved,true);
  const frame=await b.call('fish.screenshot');fs.writeFileSync(path.join(out,type+'.png'),Buffer.from(frame.base64,'base64'));
 }
 const distant=await setupMob('cow',10,10),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),450);try{await assert.rejects(r.mcp.execute('fight_entity',{uuid:distant.uuid,seconds:30},{signal:controller.signal}));}finally{clearTimeout(timer);}
 const a=await b.call('player.getState'),nav=await b.call('fish.navigationStatus');await sleep(700);const settled=await b.call('player.getState');await sleep(500);const c=await b.call('player.getState'),afterNav=await b.call('fish.navigationStatus');
 record('cancel-observation',{nav,afterNav,start:{x:a.x,y:a.y,z:a.z,onGround:a.onGround},settled:{x:settled.x,y:settled.y,z:settled.z},after:{x:c.x,y:c.y,z:c.z},settledDisplacement:Math.hypot(c.x-settled.x,c.z-settled.z)});
 assert.equal(nav.active,false);assert.equal(afterNav.active,false);assert.ok(Math.hypot(c.x-settled.x,c.z-settled.z)<.05);record('cancel-stops-motion');
 commands(['kill @e[type=!minecraft:player]','tp DeepSeekFish 0.5 200 0.5']);await sleep(250);
 const recovery=await r.mcp.execute('recover_position');record('local-recovery',{result:recovery});assert.equal(recovery.state,'succeeded');
 assert.equal(r.store.calls,0);await r.mcp.freeze();await r.minecraft.freeze();report.passed=true;
}catch(error){report.error=error.message;console.error(error);process.exitCode=1;}
finally{
 await r.close().catch(e=>{report.closeError=e.message;process.exitCode=1;});await new Promise(resolve=>overlay.close(resolve));
 try{await trashWorld(world);report.fixtureRecycled=true;}catch(e){report.cleanupError=e.message;process.exitCode=1;}
 report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,fixtureRecycled:report.fixtureRecycled}));
}

// Reproducible developer smoke: isolated fixture world, real survival actions, no model calls.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {Runtime} from '../src/runtime.mjs';
import {ROOT} from '../src/config.mjs';
import {verifyNavigationAndDiscovery} from './smoke_discovery.mjs';
const args=process.argv.slice(2),version=args[args.indexOf('--version')+1];
if(!args.includes('--version')||!/^1\.21(?:\.\d+)?$/.test(version))throw Error('Usage: node scripts/smoke_game.mjs --version 1.21.4 [--minecraft-home path]');
const jar=args.includes('--minecraft-home')?args[args.indexOf('--minecraft-home')+1]:path.join(os.homedir(),'.gradle/caches/fabric-loom',version,'minecraft-client.jar');
const runtime=new Runtime();runtime.store.persist=false;runtime.store.settings={...runtime.store.settings,minecraftHome:jar,minecraftVersion:version,world:'smoke-v3',streamingEnabled:false,nativeHudEnabled:false};
const overlay=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({...runtime.store.overlayState(),balanceBubbleSeq:0}));});
await new Promise(resolve=>overlay.listen(0,'127.0.0.1',resolve));process.env.FISH_OVERLAY_URL='http://127.0.0.1:'+overlay.address().port+'/api/overlay';
const out=path.join(ROOT,'outputs/smoke',version);fs.mkdirSync(out,{recursive:true});
const report={version,startedAt:new Date().toISOString(),modelRequests:0,steps:[],passed:false};
const record=(step,data={})=>{report.steps.push({step,...data});console.log(JSON.stringify({version,step,...data}));};
let last='';const watcher=setInterval(()=>{const row=runtime.store.setup.steps.find(x=>x.id===runtime.store.setup.active),text=row?.title+': '+row?.detail;if(row&&text!==last){last=text;console.log(JSON.stringify({version,preparing:row.id,detail:row.detail}));}},5000);watcher.unref();
const cancel=()=>void runtime.close();process.once('SIGINT',cancel);
try{
 await runtime.prepare({requireModel:false});assert.equal(runtime.store.status,'ready');assert.equal(runtime.store.connected,true);record('prepare-and-freeze',{tools:runtime.store.tools});
 const b=runtime.mcp.bridge,identity=await b.call('session.info'),self=await b.call('player.getState');assert.equal(identity.player,'DeepSeekFish');assert.equal(self.gameMode,'survival');record('identity',{player:identity.player,mode:self.gameMode});
 runtime.minecraft.resume();await runtime.mcp.resume();
 runtime.minecraft.command('forceload add -16 -16 16 16');
 const chunkDeadline=Date.now()+20000;
 while(!runtime.minecraft.lines.some(line=>line.includes('fish_smoke_chunk_ready'))){runtime.minecraft.command('execute if loaded 0 199 0 run say fish_smoke_chunk_ready');await sleep(500);if(Date.now()>chunkDeadline)throw Error('Fixture chunk did not finish loading');}
 for(const command of ['fill -4 199 -4 4 199 4 minecraft:stone','fill -4 200 -4 4 205 4 minecraft:air','setblock 0 200 2 minecraft:oak_log','tp DeepSeekFish 0.5 200 0.5','time set day','weather clear'])runtime.minecraft.command(command);
 const syncDeadline=Date.now()+15000;
 while(!JSON.stringify(await b.call('fish.probeBlocks',{positions:[{x:0,y:200,z:2}]})).includes('oak_log')){if(Date.now()>syncDeadline)throw Error('Fixture block did not synchronize to client');await sleep(300);}
 const scan=await runtime.mcp.spatialStatus(true);assert.equal(scan.available,true);record('spatial');
 const before=await b.call('fish.probeBlocks',{positions:[{x:0,y:200,z:2}]});assert.match(JSON.stringify(before),/oak_log/);
 const look=await runtime.mcp.execute('look_at',{x:.5,y:200.5,z:2.5});assert.equal(look.state,'succeeded');
 const mined=await runtime.mcp.execute('mine_block',{x:0,y:200,z:2},{remainingMs:()=>30000});assert.equal(mined.state,'succeeded');
 const after=await b.call('fish.probeBlocks',{positions:[{x:0,y:200,z:2}]});assert.doesNotMatch(JSON.stringify(after),/oak_log/);record('real-mine',{state:mined.state});
 if(args.includes('--discovery'))await verifyNavigationAndDiscovery(runtime,out,record);
 for(const [block,size,role] of [['furnace',3,'output'],['chest',27,'storage'],['crafting_table',10,'crafting_input'],['brewing_stand',5,'ingredient'],['anvil',3,'secondary_input'],['smithing_table',4,'template']]){
  await b.call('container.close');
  const items=block==='furnace'?'{Items:[{Slot:0b,id:"minecraft:raw_iron",count:2},{Slot:1b,id:"minecraft:coal",count:1},{Slot:2b,id:"minecraft:copper_ingot",count:1}]}':'';
  runtime.minecraft.command('setblock 0 200 2 minecraft:'+block+items);
  const deadline=Date.now()+10000;while(!JSON.stringify(await b.call('fish.probeBlocks',{positions:[{x:0,y:200,z:2}]})).includes('minecraft:'+block)){if(Date.now()>deadline)throw Error('Container fixture did not sync: '+block);await sleep(100);}
  const opened=await runtime.mcp.execute('open_container',{x:0,y:200,z:2});assert.equal(opened.state,'succeeded');const menu=opened.container;
  assert.equal(menu.size,size);assert.ok(role in menu.slotRoles);assert.ok(menu.slotRules?.length);assert.ok(menu.playerMenuSlots.length>=36);assert.equal(menu.carried.empty,true);
  if(block==='furnace'){assert.ok(menu.properties.length>=4);assert.equal(menu.furnace.status,'output_blocked');}
  record('native-container',{type:menu.type,size});
 }
 await runtime.mcp.execute('close_container');
 runtime.minecraft.command('summon minecraft:villager 2 200 0 {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,VillagerData:{type:"minecraft:plains",profession:"minecraft:farmer",level:2},Offers:{Recipes:[{buy:{id:"minecraft:emerald",count:1},sell:{id:"minecraft:bread",count:1},maxUses:10}]}}');
 const merchantDeadline=Date.now()+15000;let villager;
 do{const nearby=await b.call('perception.entities',{radius:6,kinds:[]});villager=nearby.entities.find(e=>e.type==='minecraft:villager');if(Date.now()>merchantDeadline)throw Error('Merchant fixture did not spawn');if(!villager)await sleep(100);}while(!villager);
 await b.call('interact.useEntity',{uuid:villager.uuid});let trade;
 do{await sleep(100);trade=await b.call('fish.containerState');if(Date.now()>merchantDeadline)throw Error('Merchant offers did not synchronize');}while(trade.type!=='minecraft:merchant'||!trade.tradeOffers?.length);
 assert.equal(trade.tradeOffers[0].result.id,'minecraft:bread');record('native-merchant',{offers:trade.tradeOffers.length});await b.call('container.close');
 const frame=await b.call('fish.screenshot');assert.equal(frame.format,'png');assert.ok(frame.width>0&&frame.width<=1280&&frame.base64.length>100);fs.writeFileSync(path.join(out,'game.png'),Buffer.from(frame.base64,'base64'));record('game-frame',{width:frame.width,height:frame.height});
 runtime.store.settings.streamingEnabled=true;runtime.store.settings.nativeHudEnabled=true;runtime.store.say('测试：木头到手了，看看前方。','preview');
 const hudDeadline=Date.now()+6000;let hud;
 do{await sleep(300);hud=await b.call('fish.hudStatus');if(Date.now()>hudDeadline)throw Error('Native HUD did not render its bubble');}while(!hud.enabled||!hud.bubbleVisible||hud.bubbleHeight<=0);
 const withHud=await b.call('fish.screenshot');fs.writeFileSync(path.join(out,'streaming.png'),Buffer.from(withHud.base64,'base64'));record('native-hud',{bubble: hud.bubbleText});
 const effects=await b.call('player.getStatusEffects');assert.match(JSON.stringify(effects),/night_vision/);assert.match(JSON.stringify(effects),/regeneration/);record('effects');
 await runtime.mcp.freeze();await runtime.minecraft.freeze();const a=await b.call('player.getState');await sleep(400);const c=await b.call('player.getState');assert.deepEqual(a.position,c.position);record('frozen');
 const bad=runtime.minecraft.lines.filter(s=>/Failed to load function fish:|Failed to parse.*fish|Error loading.*fish|Couldn't load.*fish/.test(s));assert.deepEqual(bad,[]);report.passed=true;
}catch(error){report.error={message:error.message,code:error.code,detail:error.detail,hint:error.hint};console.error(JSON.stringify({version,error:report.error}));process.exitCode=1;}
finally{clearInterval(watcher);await runtime.close().catch(e=>{report.closeError=e.message;process.exitCode=1;});await new Promise(resolve=>overlay.close(resolve));process.removeListener('SIGINT',cancel);report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({version,passed:report.passed}));}

// Disposable real-game fixture; no model requests and no changes to the user's world.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {Runtime} from '../src/runtime.mjs';
import {ROOT} from '../src/config.mjs';
import {createWorld,trashWorld} from '../src/worlds.mjs';
import {assistanceQuery} from '../src/assistance.mjs';
import {chatCompletion,fetchBalance,canSpend,reserveFor} from '../src/deepseek.mjs';
import {withCommentary} from '../src/commentary.mjs';
const world=createWorld({name:'辅助通关烟测（临时）',version:'1.21.4',seed:'10991'}),r=new Runtime();
r.store.persist=false;r.store.settings={...r.store.settings,world:world.id,minecraftVersion:world.version,minecraftHome:path.join(ROOT,'runtime/versions/1.21.4/client.jar'),resolvedVersion:world.version,streamingEnabled:false,nativeHudEnabled:false};
const out=path.join(ROOT,'outputs/smoke/assistance');fs.mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),world:world.id,modelRequests:0,steps:[],passed:false};
const record=(step,value={})=>{report.steps.push({step,...value});console.log(JSON.stringify({step,...value}));};
const overlay=http.createServer((_req,res)=>{res.end('{"hudEnabled":false}');});await new Promise(resolve=>overlay.listen(0,'127.0.0.1',resolve));process.env.FISH_OVERLAY_URL='http://127.0.0.1:'+overlay.address().port;
const command=s=>r.minecraft.command(s);
const wait=async(test,label,ms=15000)=>{const end=Date.now()+ms;while(!await test()){if(Date.now()>end)throw Error(label);await sleep(150);}};
let b;
try {
 await r.prepare({requireModel:false});b=r.mcp.bridge;r.minecraft.resume();await r.mcp.resume();const call=(m,a={})=>b.call(m,a);
 const info=await call('fish.assistInfo');assert.equal(info.available,true);record('connected',{tools:r.mcp.tools().length});
 command('gamerule doMobSpawning false');
 command('execute in minecraft:the_nether run tp DeepSeekFish 0.5 100 0.5');
 await wait(async()=>(await call('player.getState')).dimension==='minecraft:the_nether','nether transition');
 command('execute in minecraft:the_nether run fill -10 99 -10 10 99 10 minecraft:stone');
 command('execute in minecraft:the_nether run fill -10 100 -10 10 104 10 minecraft:air');
 command('execute in minecraft:the_nether run fill -10 100 -10 -10 103 10 minecraft:bedrock');
 command('execute in minecraft:the_nether run fill 10 100 -10 10 103 10 minecraft:bedrock');
 command('execute in minecraft:the_nether run fill -10 100 -10 10 103 -10 minecraft:bedrock');
 command('execute in minecraft:the_nether run fill -10 100 10 10 103 10 minecraft:bedrock');
 command('execute as DeepSeekFish at @s run kill @e[type=!minecraft:player,distance=..24]');
 command('execute in minecraft:the_nether run tp DeepSeekFish 0.5 100 0.5');command('effect give DeepSeekFish minecraft:instant_health 1 5 true');command('effect give DeepSeekFish minecraft:saturation 1 5 true');
 command('execute in minecraft:the_nether run summon minecraft:piglin 3 100 0 {IsImmuneToZombification:1b,PersistenceRequired:1b,CanPickUpLoot:1b,HandItems:[{id:"minecraft:crossbow",count:1},{}]}');
 await sleep(1000);
 let scene=await assistanceQuery(call,'entities',{radius:24});const crossbow=scene.entities.find(e=>e.type==='minecraft:piglin'&&e.mainhand==='minecraft:crossbow');assert.ok(crossbow);assert.equal(crossbow.ignoresPlayer,true);
 const health=(await call('player.getState')).health;await sleep(6000);scene=await assistanceQuery(call,'entities',{radius:24});assert.equal(scene.entities.find(e=>e.uuid===crossbow.uuid)?.attackingPlayer,false);record('crossbow-neutral',{healthBefore:health,healthAfter:(await call('player.getState')).health});
 command('execute in minecraft:the_nether run summon minecraft:piglin -3 100 0 {IsImmuneToZombification:1b,PersistenceRequired:1b,CanPickUpLoot:1b,HandItems:[{id:"minecraft:golden_sword",count:1},{}]}');
 await wait(async()=>(await assistanceQuery(call,'entities',{radius:24})).entities.some(e=>e.type==='minecraft:piglin'&&e.mainhand==='minecraft:golden_sword'&&e.attackingPlayer),'melee piglin did not attack');record('melee-remains-hostile');
 command('execute as DeepSeekFish at @s run kill @e[type=!minecraft:player,distance=..24]');await sleep(250);
 command('execute in minecraft:the_nether run tp DeepSeekFish 0.5 100 0.5');command('clear DeepSeekFish');command('give DeepSeekFish minecraft:cobblestone 16');command('give DeepSeekFish minecraft:gold_ingot 4');command('give DeepSeekFish minecraft:iron_pickaxe 1');command('effect give DeepSeekFish minecraft:instant_health 1 5 true');
 command('execute in minecraft:the_nether run summon minecraft:piglin 5.5 100 0.5 {IsImmuneToZombification:1b,PersistenceRequired:1b,CanPickUpLoot:1b,HandItems:[{id:"minecraft:golden_sword",count:1},{}]}');await sleep(500);
 const located=await r.mcp.execute('locate_resource',{target:'piglin',radius:32});assert.equal(located.result.found,true);assert.equal(located.result.entities[0].baby,false);record('loaded-piglin-location',{chars:JSON.stringify(located).length});
 const trade=await r.mcp.execute('barter_piglins',{item:'ender_pearl',count:1,goldBudget:2,seconds:70});record('actual-barter',{result:trade});assert.equal(trade.result.towerBlocks,2);assert.ok(trade.result.goldSpent>=1&&trade.result.goldSpent<=2);assert.ok(trade.result.observedDrops.length>0||trade.result.receivedItems.length>0);assert.ok(trade.result.receivedItems.length>0);
 command('execute as DeepSeekFish at @s run kill @e[type=!minecraft:player,distance=..24]');command('effect give DeepSeekFish minecraft:instant_health 1 5 true');
 command('execute in minecraft:the_nether run fill 6 99 6 8 99 8 minecraft:lava');command('execute in minecraft:the_nether run tp DeepSeekFish -2.5 100 0.5');await sleep(300);
 const lava=await r.mcp.execute('locate_resource',{target:'lava_lake',radius:16});record('lava-location',{result:lava.result});assert.equal(lava.result.found,true);assert.equal(lava.result.source,'server_assistance');assert.ok(lava.result.distance<16);
 const fortress=await r.mcp.execute('locate_resource',{target:'nether_fortress',structureChunks:32});record('fortress-location',{result:fortress.result});assert.equal(fortress.result.source,'server_assistance');assert.equal(typeof fortress.result.found,'boolean');if(fortress.result.found){assert.equal(fortress.result.heightKnown,false);assert.equal(fortress.result.position.y,undefined);}
 const frame=await call('fish.screenshot');fs.writeFileSync(path.join(out,'game.png'),Buffer.from(frame.base64,'base64'));
 if(process.argv.includes('--model')){
  for(const kind of ['locate_resource','barter_piglins']){
   if(kind==='barter_piglins'){
    command('execute as DeepSeekFish at @s run kill @e[type=!minecraft:player,distance=..24]');command('execute in minecraft:the_nether run fill -2 100 -2 2 104 2 minecraft:air');command('execute in minecraft:the_nether run tp DeepSeekFish 0.5 100 0.5');command('effect give DeepSeekFish minecraft:instant_health 1 5 true');command('clear DeepSeekFish');command('give DeepSeekFish minecraft:cobblestone 8');command('give DeepSeekFish minecraft:gold_ingot 1');command('execute in minecraft:the_nether run summon minecraft:piglin 5.5 100 0.5 {IsImmuneToZombification:1b,PersistenceRequired:1b,CanPickUpLoot:1b,HandItems:[{id:"minecraft:golden_sword",count:1},{}]}');await sleep(400);
   }
   await r.mcp.freeze();await r.minecraft.freeze();
   const body={model:r.store.settings.model,messages:[{role:'system',content:fs.readFileSync(path.join(ROOT,'prompts/game.md'),'utf8')},{role:'user',content:JSON.stringify(await r.mcp.status())+'\n'+(kind==='locate_resource'?'现在要获得地狱堡垒的辅助位置，请调用一个合适工具，不走路。':'现在要用一枚金锭与附近成年近战猪灵交换珍珠，已有建筑块和背包空位。请调用一个现成工具，新增珍珠目标1，金锭预算严格为1，时限30秒。')}],tools:r.mcp.tools().filter(t=>['locate_resource','barter_piglins'].includes(t.function.name)).map(t=>withCommentary(t)),tool_choice:'required',thinking:{type:'disabled'},max_tokens:512};
   const balance=await fetchBalance();if(!canSpend(balance,reserveFor(body)))throw Error('model verification: balance floor');
   const response=await chatCompletion(body,{});report.modelRequests++;
   const action=response.choices[0].message.tool_calls?.[0];assert.equal(action?.function.name,kind);
   const {say,reaction,...input}=JSON.parse(action.function.arguments);const args=r.mcp.normalizeArgs(kind,input);
   if(kind==='barter_piglins')assert.equal(args.goldBudget,1);else assert.equal(args.target,'nether_fortress');
   r.minecraft.resume();await r.mcp.resume();
   const result=await r.mcp.execute(kind,args);record('model-'+kind,{tool:kind,args,result,usage:response.usage});
   if(kind==='barter_piglins'){assert.equal(result.result.goldSpent,1);assert.ok(result.result.goldOffers<=1);assert.ok(result.result.receivedItems.length>0);}
  }
 }
 assert.equal(r.store.calls,0);report.passed=true;
}catch(error){report.error=error.message;console.error(error);process.exitCode=1;}
finally{await r.close().catch(e=>{report.closeError=e.message;process.exitCode=1;});await new Promise(resolve=>overlay.close(resolve));try{await trashWorld(world);report.fixtureRecycled=true;}catch(e){report.cleanupError=e.message;process.exitCode=1;}report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,fixtureRecycled:report.fixtureRecycled}));}

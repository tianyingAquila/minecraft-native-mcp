// Disposable native stairs and persistent stage-goal smoke; no model calls.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {Runtime} from '../src/runtime.mjs';
import {ROOT} from '../src/config.mjs';
import {createWorld,trashWorld} from '../src/worlds.mjs';
const world=createWorld({name:'阶梯与目标板烟测（临时）',version:'1.21.4',seed:'10991'}),r=new Runtime();
r.store.persist=false;r.store.settings={...r.store.settings,world:world.id,minecraftVersion:world.version,minecraftHome:path.join(ROOT,'runtime/versions/1.21.4/client.jar'),resolvedVersion:world.version,streamingEnabled:true,nativeHudEnabled:true};
const out=path.join(ROOT,'outputs/smoke/stairs');fs.mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),world:world.id,modelRequests:0,steps:[],passed:false};
const record=(step,data={})=>{report.steps.push({step,...data});console.log(JSON.stringify({step,...data}));};
const overlay=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(r.store.overlayState()));});
await new Promise(resolve=>overlay.listen(0,'127.0.0.1',resolve));process.env.FISH_OVERLAY_URL='http://127.0.0.1:'+overlay.address().port+'/';
const commands=list=>{for(const cmd of list)r.minecraft.command(cmd);};
const waitFor=async(test,message,timeout=20000)=>{const until=Date.now()+timeout;while(!await test()){if(Date.now()>until)throw Error(message);await sleep(100);}};
try{
 await r.prepare({requireModel:false});const b=r.mcp.bridge;r.minecraft.resume();await r.mcp.resume();
 commands(['forceload add -16 -16 16 16','tp DeepSeekFish 0.5 200 0.5']);
 await waitFor(async()=>{r.minecraft.command('execute if loaded 0 199 0 run say fish_stairs_chunk_ready');return r.minecraft.lines.some(line=>line.includes('fish_stairs_chunk_ready'));},'fixture chunks unavailable');
 commands(['fill -6 197 -6 6 210 6 minecraft:stone','fill 0 200 0 0 201 0 minecraft:air','fill 0 202 -4 0 203 -1 minecraft:air','fill 0 201 -4 0 201 -1 minecraft:air','give DeepSeekFish minecraft:diamond_pickaxe 1','tp DeepSeekFish 0.5 200 0.5','time set day','weather clear']);
 await waitFor(async()=>{const p=await b.call('player.getState'),i=await b.call('player.getInventory');return Math.abs(p.y-200)<.1&&p.onGround&&[...i.hotbar,...i.main].some(s=>s.id==='minecraft:diamond_pickaxe');},'fixture did not synchronize');
 // A real two-high takeoff cell: the current ceiling must be removed before jumping.
 const up=await r.mcp.execute('dig_tunnel',{direction:'east',length:3,slope:'up'});record('up-three',{result:up});
 assert.equal(up.result.completedSteps,3);assert.equal(up.result.position.y,203);assert.equal(up.result.status,'completed');
 const down=await r.mcp.execute('dig_tunnel',{direction:'north',length:3,slope:'down'});record('down-three',{result:down});
 assert.equal(down.result.completedSteps,3);assert.equal(down.result.position.y,200);
 const goal='我要获取一组铁锭，制作全套铁装备';r.store.goal=goal;r.store.say('先挖出一条上去的楼梯。','preview');
 await waitFor(async()=>{const h=await b.call('fish.hudStatus');return h.enabled&&h.goalText===goal&&h.goalHeight>0&&h.bubbleVisible;},'native goal board did not render');
 let frame=await b.call('fish.screenshot');fs.writeFileSync(path.join(out,'goal.png'),Buffer.from(frame.base64,'base64'));
 r.store.say('接下来寻找更多铁矿。','preview');await waitFor(async()=>{const h=await b.call('fish.hudStatus');return h.goalText===goal&&h.bubbleText==='接下来寻找更多铁矿。';},'bubble overwrote goal');
 const short=await b.call('fish.hudStatus');
 const long='收集足够的铁矿石和煤炭，带回安全地点熔炼，制作全套铁装备与备用工具；补充食物和木材，确认出口位置，再出发探索地表村庄。';r.store.goal=long;
 await waitFor(async()=>{const h=await b.call('fish.hudStatus');return h.goalText===long&&h.goalHeight>short.goalHeight;},'long goal did not wrap');
 frame=await b.call('fish.screenshot');fs.writeFileSync(path.join(out,'goal-long.png'),Buffer.from(frame.base64,'base64'));record('goal-board',{short,long:await b.call('fish.hudStatus')});
 r.store.settings.streamingEnabled=false;await waitFor(async()=>!(await b.call('fish.hudStatus')).enabled,'streaming toggle did not hide goal');record('hidden-with-streaming');
 assert.equal(r.store.calls,0);await r.mcp.freeze();await r.minecraft.freeze();report.passed=true;
}catch(error){report.error=error.message;console.error(error);process.exitCode=1;}
finally{await r.close().catch(e=>{report.closeError=e.message;process.exitCode=1;});await new Promise(resolve=>overlay.close(resolve));try{await trashWorld(world);report.fixtureRecycled=true;}catch(e){report.cleanupError=e.message;process.exitCode=1;}report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,fixtureRecycled:report.fixtureRecycled}));}

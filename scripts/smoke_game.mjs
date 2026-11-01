// Reproducible developer smoke: isolated fixture world, real survival actions, no model calls.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {Runtime} from '../src/runtime.mjs';
import {ROOT} from '../src/config.mjs';
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

// Developer smoke in an owned disposable world; no model calls or user-world edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

export async function verifyNavigationAndDiscovery(runtime,out,record){
 assert.ok(runtime.store.settings.world.startsWith('smoke-'));
 const b=runtime.mcp.bridge;
 const wait=async(fn,label,ms=15000)=>{const until=Date.now()+ms;while(!await fn()){if(Date.now()>until)throw Error(label);await sleep(100);}};
 runtime.minecraft.command('fill -16 199 -16 16 199 16 minecraft:stone');
 runtime.minecraft.command('fill -16 200 -16 16 207 16 minecraft:air');
 runtime.minecraft.command('fill 14 200 0 14 203 0 minecraft:red_concrete');
 runtime.minecraft.command('fill 10 200 -14 10 203 -14 minecraft:blue_concrete');
 runtime.minecraft.command('tp DeepSeekFish 0.5 200 0.5');
 await wait(async()=>Math.abs((await b.call('player.getState')).x-.5)<.1,'Camera fixture teleport');
 await b.call('control.lookAt',{x:-8,y:201.62,z:.5});
 const before=await b.call('fish.screenshot');fs.writeFileSync(path.join(out,'camera-before.png'),Buffer.from(before.base64,'base64'));
 const samples=[];
 for(const [name,target] of [['east',{x:10.5,y:200,z:.5}],['north',{x:10.5,y:200,z:-10.5}]]){
  const started=Date.now();await b.call('fish.navigate',{...target,reach:.6});let previous=await b.call('player.getState');
  while(true){await sleep(100);const self=await b.call('player.getState'),state=await b.call('fish.navigationStatus');
   const dx=self.x-previous.x,dz=self.z-previous.z,distance=Math.hypot(dx,dz);
   if(distance>.03&&Date.now()-started>400){const yaw=self.yaw*Math.PI/180,dot=(-Math.sin(yaw)*dx+Math.cos(yaw)*dz)/distance;samples.push({leg:name,dot,yaw:self.yaw,x:self.x,z:self.z});}
   previous=self;if(state.state==='reached')break;if(Date.now()-started>15000)throw Error('Navigation did not reach '+name);
  }
  assert.equal((await b.call('fish.navigationStatus')).cameraFollowsPath,true);
  const frame=await b.call('fish.screenshot');fs.writeFileSync(path.join(out,'camera-'+name+'.png'),Buffer.from(frame.base64,'base64'));await b.call('fish.cancel');
 }
 assert.ok(samples.length>=10);const forward=samples.filter(s=>s.dot>.5).length/samples.length;assert.ok(forward>=.9,'Camera still faces away during movement: '+forward);
 fs.writeFileSync(path.join(out,'camera-samples.json'),JSON.stringify(samples,null,2));record('navigation-camera',{samples:samples.length,alignedRatio:forward});
 runtime.minecraft.command('tp DeepSeekFish 0.5 200 0.5');
 await wait(async()=>Math.abs((await b.call('player.getState')).x-.5)<.1,'Discovery fixture teleport');
 runtime.minecraft.command('fill 1 200 -4 1 207 4 minecraft:stone');
 runtime.minecraft.command('setblock 4 200 0 minecraft:rail');
 runtime.minecraft.command('setblock 4 201 0 minecraft:cobweb');
 await wait(async()=>JSON.stringify(await b.call('fish.probeBlocks',{positions:[{x:1,y:201,z:0},{x:4,y:201,z:0}]})).includes('cobweb'),'Discovery fixture blocks');
 await b.call('control.lookAt',{x:5,y:201.62,z:.5});
 runtime.minecraft.command('give DeepSeekFish minecraft:iron_pickaxe');
 await wait(async()=>{const inv=await b.call('player.getInventory');return [...inv.hotbar,...inv.main].some(i=>i.id==='minecraft:iron_pickaxe');},'Mining fixture tool');
 const hidden=await runtime.mcp.spatialStatus();assert.equal(hidden.environment.candidates.some(c=>c.id==='mineshaft'),false);
 const dug=await runtime.mcp.execute('dig_tunnel',{direction:'east',length:4,slope:'level'},{remainingMs:()=>90000});
 assert.equal(dug.state,'interrupted',JSON.stringify(dug));assert.equal(dug.result.reason,'new_environment',JSON.stringify(dug.result));assert.ok(dug.result.discovery.updates.some(e=>e.detail?.id==='mineshaft'));
 assert.ok(dug.result.completedSteps<4);record('new-environment-interrupt',{broken:dug.result.brokenBlocks,steps:dug.result.completedSteps,label:dug.result.discovery.updates[0].label});
 runtime.minecraft.command('fillbiome -8 196 -8 8 204 8 minecraft:lush_caves');
 await wait(async()=>(await b.call('fish.spatialScan')).biome==='minecraft:lush_caves','Client biome did not update');
 const lush=await runtime.mcp.spatialStatus();assert.equal(lush.environment.biome.id,'minecraft:lush_caves');assert.ok(lush.environment.updates.some(e=>e.kind==='biome'));
 record('biome-discovery',{id:lush.environment.biome.id});
}

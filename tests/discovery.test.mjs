import test from 'node:test';
import assert from 'node:assert/strict';
import {describeEnvironment,DiscoveryTracker} from '../src/discovery.mjs';
import {reactionAllowed,reactionEventKey} from '../src/commentary.mjs';
const block=(id,x=3)=>({id:'minecraft:'+id,x,y:20,z:0,distance:x});
const environment=blocks=>describeEnvironment({biome:'minecraft:plains',dimension:'minecraft:overworld',player:{y:20},openSky:false,blocks});
test('矿井需要可见组合证据，普通木头/单根铁轨不冒充已确认结构',()=>{
 assert.equal(environment([block('oak_planks')]).candidates.length,0);
 assert.equal(environment([block('rail')]).candidates.length,0);
 const found=environment([block('rail'),block('cobweb',4)]).candidates[0];assert.equal(found.id,'mineshaft');assert.equal(found.certainty,'possible');assert.ok(found.evidence.some(b=>b.id==='minecraft:rail'));
 assert.equal(environment([block('cobweb'),block('oak_fence'),block('oak_planks'),block('oak_planks',5)]).candidates[0].id,'mineshaft');
});
test('群系数据与结构推断分开，深暗之域不直接当远古城市',()=>{
 const e=describeEnvironment({biome:'minecraft:deep_dark',dimension:'minecraft:overworld',player:{y:-30},openSky:false,blocks:[]});
 assert.equal(e.biome.name,'深暗之域');assert.equal(e.candidates.length,0);
 const lush=describeEnvironment({biome:'minecraft:lush_caves',dimension:'minecraft:overworld',player:{y:20},blocks:[]});assert.equal(lush.biome.name,'繁茂洞穴');
});
test('同地转头和短距反复采样不会重复发现，新的远处线索仍会通知',()=>{
 const t=new DiscoveryTracker(),e=environment([block('rail'),block('cobweb',4)]);t.observe(e,[0,20,0],1000);const n=t.sequence;
 t.observe(e,[1,20,0],2000);assert.equal(t.sequence,n);assert.equal(t.since(n).length,0);
 t.observe(environment([block('rail',90),block('cobweb',91)]),[88,20,0],3000);assert.equal(t.sequence,n+1);
 t.observe(environment([]),[0,20,0],95000);assert.equal(t.since().length,0);
 const other=environment([block('rail'),block('cobweb',4)]);other.dimension='minecraft:the_nether';t.observe(other,[0,20,0],96000);
 assert.ok(t.since().some(e=>e.kind==='dimension'));assert.ok(t.since().some(e=>e.detail.id==='mineshaft'));
});
test('新环境允许自然反应但危险优先，重复反应使用稳定事件ID',()=>{
 const event={id:'one-new-cave',at:Date.now(),salient:true};const s={result:{situation:{vitals:{health:20},spatial:{environment:{updates:[event]}}}}};
 assert.equal(reactionAllowed(null,s),true);assert.equal(reactionEventKey(null,s),event.id);s.result.situation.vitals.health=5;assert.equal(reactionAllowed(null,s),false);
});

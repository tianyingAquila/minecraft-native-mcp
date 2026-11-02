import test from 'node:test';
import assert from 'node:assert/strict';
import {ProgressGuard} from '../src/progress.mjs';
const snapshot=(count=5,yaw=0,held=false)=>({result:{situation:{position:{x:0,y:65,z:0,headingDegrees:yaw},vitals:{health:20,food:20},inventory:{stacks:[{name:'iron_ingot',count,slot:0,held}]}}}});
test('相同材料不足不因转头或修改等待时间而无限重试，补材料后解除',()=>{
 const g=new ProgressGuard();g.observe(snapshot(),0);
 const args={item:'iron_chestplate',count:1,waitSeconds:5};
 g.record('craft_item',args,{state:'failed',result:'missing iron_ingot×3'});
 g.record('craft_item',args,{state:'failed',result:'missing iron_ingot×3'});
 g.observe(snapshot(5,90),1000);
 assert.equal(g.blocked('craft_item',{...args,waitSeconds:45}).error,'REPLAN_REQUIRED');
 g.observe(snapshot(8),2000);
 assert.equal(g.blocked('craft_item',args),null);
});
test('长期没有实际进展才要求恢复，普通短暂等待不触发',()=>{
 const g=new ProgressGuard();for(let i=0;i<16;i++)g.observe(snapshot(5,i*10),i*9000);
 assert.equal(g.needsRecovery(135000),true);
 g.observe(snapshot(6),136000);assert.equal(g.needsRecovery(136000),false);
});
test('转头、换快捷栏、反复开关同一容器都不能清除重复失败',()=>{
 const g=new ProgressGuard(),s=snapshot();s.result.situation.openMenu={open:true,type:'minecraft:furnace',position:{x:1,y:65,z:0},slots:[{slot:0,id:'minecraft:raw_iron',count:9}]};
 g.observe(s,0);for(let i=0;i<2;i++)g.record('craft_item',{item:'iron_chestplate'},{state:'failed',result:'missing materials'});
 const closed=structuredClone(s);closed.result.situation.openMenu=null;closed.result.situation.inventory.stacks[0].held=true;
 g.observe(closed,1000);g.observe(s,2000);
 assert.equal(g.blocked('craft_item',{item:'iron_chestplate'}).error,'REPLAN_REQUIRED');
});
test('截图冷却和未执行的排队动作不进入永久世界变化失败锁',()=>{
 const g=new ProgressGuard();g.observe(snapshot(),0);g.record('inspect_game_screen',{reason:'看不懂A'},{error:'VISION_COOLDOWN'});g.record('inspect_game_screen',{reason:'看不懂B'},{error:'VISION_COOLDOWN'});assert.equal(g.blocked('inspect_game_screen',{reason:'冷却结束再看'}),null);
 g.record('craft_item',{item:'stick'},{error:'OBSERVATION_REQUIRED'});g.record('craft_item',{item:'stick'},{error:'OBSERVATION_REQUIRED'});assert.equal(g.blocked('craft_item',{item:'stick'}),null);
});

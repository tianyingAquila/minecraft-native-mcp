import test from 'node:test';
import assert from 'node:assert/strict';
import {fightEntity,chooseMeleeWeapon} from '../src/combat.mjs';
const uuid='11111111-1111-4111-8111-111111111111';
function fixture({missing=false,blocked=false,stationary=false,health=20,kind='minecraft:cow',signal}={}){
 let time=0,hp=10,nav=null,attacks=0,moves=0,cancels=0;const self={x:0,y:64,z:0,health,gameMode:'survival',dimension:'minecraft:overworld'},target={uuid,type:kind,x:8,y:64,z:0,distance:8},inventory={selectedSlot:0,hotbar:[{slot:1,id:'minecraft:stone_sword',count:1}],main:[]};
 const call=async(method,args={})=>{
  if(method==='fish.cancel'){nav=null;cancels++;return {};}
  if(method==='screen.close')return {};
  if(method==='player.getState')return {...self};
  if(method==='player.getInventory')return inventory;
  if(method==='fish.equip'){inventory.selectedSlot=1;return {};}
  if(method==='perception.entities')return {entities:missing?[]:[{...target,distance:Math.abs(target.x-self.x)}]};
  if(method==='fish.navigationStatus')return {active:Boolean(nav)};
  if(method==='fish.navigate'){nav=args;moves++;return {};}
  if(method==='fish.attack'){
   if(missing)return {missing:true};if(hp<=0)return {deathObserved:true};
   if(blocked)throw Error('Target is obstructed; move to a clear line of sight.');
   if(Math.abs(target.x-self.x)>2.5)throw Error('Target is out of melee reach.');
   attacks++;hp-=5;return {attacked:true};
  }
  throw Error(method);
 };
 return {call,now:()=>time,signal,sleep:async ms=>{time+=ms;if(nav&&!stationary)self.x+=Math.sign(nav.x-self.x)*.8;if(!stationary)target.x+=.1;},counts:()=>({attacks,moves,cancels})};
}
test('连续追踪移动目标并挥击，不逐步请求模型；只有原生确认死亡才成功',async()=>{
 const f=fixture(),r=await fightEntity({uuid,weapon:'stone_sword',seconds:30},f);
 assert.equal(r.status,'succeeded');assert.equal(r.deathObserved,true);assert.equal(r.attacks,2);assert.equal(r.weapon,'minecraft:stone_sword');assert.ok(f.counts().moves>1);assert.ok(f.counts().cancels>=2);
});
test('目标消失、低血、无法接近、爆炸目标均交回，不虚报击杀',async()=>{
 for(const [options,reason] of [[{missing:true},'target_missing'],[{health:7},'player_danger'],[{stationary:true},'no_progress'],[{kind:'minecraft:creeper'},'explosive_target_requires_other_tactic']]){
  const f=fixture(options),r=await fightEntity({uuid},f);assert.equal(r.status,'interrupted');assert.equal(r.reason,reason);assert.equal(r.deathObserved,false);assert.equal(f.counts().attacks,0);
 }
});
test('手动选武器必须真实存在，自动近战不把弓箭当剑使用',()=>{
 assert.throws(()=>chooseMeleeWeapon({hotbar:[{id:'minecraft:bow',slot:0}],main:[]}));
 assert.throws(()=>chooseMeleeWeapon({hotbar:[],main:[]},'diamond_sword'));
 assert.equal(chooseMeleeWeapon({selectedSlot:0,hotbar:[],main:[]},'held').id,'minecraft:air');
 assert.throws(()=>chooseMeleeWeapon({},12));
});
test('取消后不再追击或攻击，仍执行停止清理',async()=>{
 const controller=new AbortController(),f=fixture({signal:controller.signal}),sleep=f.sleep;
 f.sleep=async ms=>{await sleep(ms);controller.abort();};
 await assert.rejects(fightEntity({uuid},f),e=>e.name==='AbortError');assert.equal(f.counts().attacks,0);assert.ok(f.counts().cancels>=2);
});

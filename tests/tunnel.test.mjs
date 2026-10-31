import test from 'node:test';
import assert from 'node:assert/strict';
import {digTunnel} from '../src/tunnel.mjs';
import {normalizeToolArgs} from '../src/tool-args.mjs';
import {ClientActions} from '../src/client-actions.mjs';

function world({slope='level', obstacle, onBreak}={}) {
  let clock=0, aim, breaks=0;
  const air=new Set(['0,64,0','0,65,0']);
  const self={x:.5,y:64,z:.5,health:20,air:300,inWater:false,onGround:true,dimension:'minecraft:overworld',gameMode:'survival'};
  const calls=[];
  const block=p=>{const empty=air.has(`${p.x},${p.y},${p.z}`);return {...p,loaded:true,id:empty?'minecraft:air':'minecraft:stone',air:empty,hardness:empty?0:1.5,fullSupport:!empty,falling:false,fluid:false,blockEntity:false,canHarvest:true,bestSlot:0,...obstacle?.(p)};};
  const call=async(method,args={})=>{
    calls.push([method,structuredClone(args)]);
    if(method==='player.getState')return {...self};
    if(method==='player.getInventory')return {selectedSlot:0,hotbar:[{slot:0,id:'minecraft:iron_pickaxe',maxDamage:250,damage:10}],main:[]};
    if(method==='perception.entities')return {entities:[]};
    if(method==='fish.probeBlocks'||method==='perception.blocks')return {blocks:args.positions.map(block)};
    if(method==='interact.breakBlock'){air.add(`${args.x},${args.y},${args.z}`);onBreak?.(++breaks,self);}
    if(method==='control.lookAt')aim=args;
    if(method==='control.setInput'&&args.forward){self.x=aim.x;self.z=aim.z;if(slope==='down')self.y--;}
    return {};
  };
  return {call,calls,self,now:()=>clock,sleep:async ms=>{clock+=ms;},signal:new AbortController().signal};
}
test('一次矿道工具连续挖8块并实际推进4格；向下两级每级清除额外头部空间',async()=>{
  const horizontal=world();const result=await digTunnel({direction:'east',length:4},horizontal);
  assert.equal(result.status,'completed');assert.equal(result.completedSteps,4);assert.equal(result.brokenBlocks,8);assert.equal(result.position.x,4.5);
  assert.equal(horizontal.calls.filter(([m])=>m==='interact.breakBlock').length,8);
  const down=world({slope:'down'});const stairs=await digTunnel({direction:'east',length:2,slope:'down'},down);
  assert.equal(stairs.completedSteps,2);assert.equal(stairs.brokenBlocks,6);assert.equal(stairs.position.y,62);
});
test('矿道发现流体、断崖、未加载、落沙或方块实体时不开始挖掘',async()=>{
  for(const [fields,reason] of [[{fluid:true},'fluid_or_hazard'],[{fullSupport:false},'unsupported_floor'],[{loaded:false},'unloaded_area'],[{falling:true},'unsafe_or_protected_block'],[{blockEntity:true},'unsafe_or_protected_block']]){
    const w=world({obstacle:p=>p.x===1&&p.z===0&&p.y===(reason==='unsupported_floor'?63:64)?fields:{}});
    const result=await digTunnel({direction:'east',length:3},w);assert.equal(result.reason,reason);assert.equal(result.completedSteps,0);assert.equal(w.calls.some(([m])=>m==='interact.breakBlock'),false);
  }
});
test('挖掘期间受伤即交回决策，不继续挖第二块；卡住不伪报推进',async()=>{
  const danger=world({onBreak:(_,self)=>{self.health=18;}});
  const interrupted=await digTunnel({direction:'east',length:5},danger);assert.equal(interrupted.reason,'player_danger');assert.equal(interrupted.completedSteps,0);assert.equal(danger.calls.filter(([m])=>m==='interact.breakBlock').length,1);
  const stuck=world(),raw=stuck.call;stuck.call=(m,a)=>m==='control.setInput'?Promise.resolve({}):raw(m,a);
  const result=await digTunnel({direction:'east',length:2},stuck);assert.equal(result.reason,'movement_stalled');assert.equal(result.completedSteps,0);
});
test('矿道取消后仍释放游戏按键，不把取消当作普通中断结果',async()=>{
  const controller=new AbortController(),w=world(),raw=w.call;
  const a=new ClientActions({bridge:{call:async(m,args)=>{if(m==='interact.breakBlock')controller.abort();return raw(m,args);}}});
  await assert.rejects(a.custom('dig_tunnel',{direction:'east',length:3},controller.signal),e=>e.name==='AbortError');
  assert.equal(w.calls.at(-1)[0],'fish.cancel');
});
test('只有schema中的数字字段兼容数字字符串，其他错误类型不偷偷转换',async()=>{
  const schema={type:'object',properties:{x:{type:'number'},length:{type:'integer'},positions:{type:'array',items:{type:'object',properties:{z:{type:'number'}}}}}};
  assert.deepEqual(normalizeToolArgs({x:'-41',length:'4',positions:[{z:' -3.5 '}],unknown:'7'},schema),{x:-41,length:4,positions:[{z:-3.5}],unknown:'7'});
  for(const invalid of ['', ' ',false,null,'Infinity','1;exit'])assert.equal(normalizeToolArgs(invalid,{type:'number'}),invalid);
  const actions=new ClientActions();actions.catalogue=[{name:'mine_block',inputSchema:schema}];assert.equal(actions.normalizeArgs('mine_block',{x:'-41'}).x,-41);
});

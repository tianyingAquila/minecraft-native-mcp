import test from 'node:test';
import assert from 'node:assert/strict';
import {ClientActions} from '../src/client-actions.mjs';

test('背包装备避开寻路组件的镐槽，并核对实际手持物品',async()=>{
 for(const reverted of [false,true]){
  let selectedSlot=0,equipped=false;
  const calls=[];
  const table={slot:34,id:'minecraft:crafting_table',count:1};
  const pick={slot:0,id:'minecraft:iron_pickaxe',count:1,damage:249};
  const actions=new ClientActions({bridge:{call:async(method,args)=>{
   calls.push([method,args]);
   if(method==='player.getInventory')return {selectedSlot,hotbar:[pick,...(equipped?[{...table,slot:7}]:[])],main:equipped?[]:[table]};
   if(method==='fish.equip'){selectedSlot=reverted?0:args.hotbarSlot;equipped=!reverted;return {selected:true};}
   throw Error(method);
  }}});
  const result=actions.custom('equip_item',{slot:34},new AbortController().signal);
  if(reverted)await assert.rejects(result,/实际手持物品/);
  else assert.equal((await result).item,'minecraft:crafting_table');
  assert.equal(calls.find(([method])=>method==='fish.equip')[1].hotbarSlot,7);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assistanceQuery,locateResource} from '../src/assistance.mjs';
import {barterPiglins} from '../src/barter.mjs';

test('辅助查询带当前维度，服务端结果标来源；完成后不留下请求文件',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fish-assist-'));
 let pending;
 try{
  const call=async method=>method==='fish.assistInfo'?{available:true,directory:root}:{dimension:'minecraft:the_nether'};
  pending=setInterval(async()=>{for(const name of await fs.readdir(root)){if(!name.endsWith('.request.json'))continue;clearInterval(pending);const value=JSON.parse(await fs.readFile(path.join(root,name),'utf8'));assert.equal(value.dimension,'minecraft:the_nether');clearInterval(pending);await fs.rm(path.join(root,name));const output=path.join(root,name.replace('.request.','.result.'));await fs.writeFile(output+'.tmp',JSON.stringify({source:'server_assistance',found:true,position:{x:3,y:64,z:5}}));await fs.rename(output+'.tmp',output);}},10);
  const result=await assistanceQuery(call,'nether_fortress');clearInterval(pending);assert.equal(result.source,'server_assistance');assert.equal(result.found,true);assert.deepEqual(await fs.readdir(root),[]);
 }finally{clearInterval(pending);await fs.rm(root,{recursive:true,force:true});}
});

test('交易拒绝错误维度、儿童猪灵和无建筑块，不能偷偷投金',async()=>{
 for(const reason of ['dimension','baby','blocks','crossbow','dead']){
  let dropped=0;
  const call=async method=>{
   if(method==='player.getState')return {dimension:reason==='dimension'?'minecraft:overworld':'minecraft:the_nether',onGround:true,health:20};
   if(method==='player.getInventory')return {hotbar:[{slot:0,id:'minecraft:gold_ingot',count:4},...(reason==='blocks'?[]:[{slot:1,id:'minecraft:cobblestone',count:4}])],main:[]};
   if(method==='fish.offerGold')dropped++;
   return {};
  };
  await assert.rejects(barterPiglins({item:'ender_pearl',count:1,goldBudget:2},{call,query:async()=>({entities:[{uuid:'00000000-0000-0000-0000-000000000001',type:'minecraft:piglin',baby:reason==='baby',health:reason==='dead'?0:16,mainhand:reason==='crossbow'?'minecraft:crossbow':'minecraft:golden_sword',distance:2}]})}));
  assert.equal(dropped,0);
 }
});

function barterFixture({pickup=false,confirmGold=true,abortAtOffer=false,receiptToPlatform=false}={}){
 let clock=0,y=64,gold=3,pearls=7,offers=0,offhand='minecraft:air',queriesAfterOffer=0;
 const controller=new AbortController(),piglin={uuid:'00000000-0000-0000-0000-000000000001',type:'minecraft:piglin',x:2,y:64,z:0,distance:2,baby:false};
 const call=async(method,args={})=>{
  controller.signal.throwIfAborted();
  if(method==='player.getState')return {x:0,y,z:0,dimension:'minecraft:the_nether',onGround:true,health:20};
  if(method==='player.getInventory')return {hotbar:[{slot:0,id:'minecraft:gold_ingot',count:gold},{slot:1,id:'minecraft:cobblestone',count:4},{slot:2,id:'minecraft:ender_pearl',count:pearls}],main:[]};
  if(method==='control.setInput'&&args.jump)y+=1.1;
  if(method==='control.stop')y=Math.round(y);
  if(method==='fish.probeBlocks')return {blocks:args.positions.map((p,i)=>({...p,loaded:true,fullSupport:true,collision:args.positions.length===5&&i>0?false:undefined,fluid:false}))};
  if(method==='fish.offerGold'){offers++;if(confirmGold)gold--;offhand='minecraft:gold_ingot';queriesAfterOffer=0;if(receiptToPlatform)pearls=9;if(abortAtOffer)controller.abort();}
  if(method==='fish.navigate'){y=64;if(pickup&&offers)pearls=9;}
  return {};
 };
 const query=async()=>{
  if(offers&&++queriesAfterOffer>1)offhand='minecraft:air';
  return {entities:[{...piglin,offhand},...(offers&&queriesAfterOffer>1&&!receiptToPlatform?[{uuid:'new-drop',item:'minecraft:ender_pearl',count:2,x:1,y:64,z:0}]:[])]};
 };
 return {call,query,stabilize:async()=>({activeMs:5000,damageProtection:false}),signal:controller.signal,now:()=>clock,sleep:async ms=>{clock+=ms;},offers:()=>offers};
}

test('交易有金锭预算；看到珍珠不等于拿到，既有七颗也不能冒充新增',async()=>{
 const f=barterFixture();const result=await barterPiglins({item:'ender_pearl',count:2,goldBudget:1,seconds:30},f);
 assert.equal(f.offers(),1);assert.equal(result.goldSpent,1);assert.equal(result.observedDrops[0].count,2);assert.equal(result.gained,0);assert.equal(result.status,'interrupted');
 const success=await barterPiglins({item:'ender_pearl',count:2,goldBudget:1,seconds:30},barterFixture({pickup:true}));assert.equal(success.gained,2);assert.equal(success.status,'succeeded');
});

test('投金回执未确认不能重投；取消后没有下一枚',async()=>{
 const f=barterFixture({confirmGold:false});const result=await barterPiglins({item:'ender_pearl',count:2,goldBudget:3,seconds:30},f);assert.equal(result.reason,'gold_offer_not_confirmed');assert.equal(f.offers(),1);
 const cancelled=barterFixture({abortAtOffer:true});await assert.rejects(barterPiglins({item:'ender_pearl',count:2,goldBudget:3,seconds:30},cancelled));assert.equal(cancelled.offers(),1);
});

test('猪灵把产物直接抛进高台玩家背包时，以新增量确认，不强行下来',async()=>{
 const result=await barterPiglins({item:'minecraft:ender_pearl',count:2,goldBudget:1,seconds:30},barterFixture({receiptToPlatform:true}));assert.equal(result.status,'succeeded');assert.equal(result.gained,2);assert.deepEqual(result.observedDrops,[]);
});

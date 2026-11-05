import {setTimeout as delay} from 'node:timers/promises';
import {assistanceQuery} from './assistance.mjs';
import {advance} from './progress-metric.mjs';

const stacks=inventory=>[...(inventory.hotbar||[]),...(inventory.main||[])];
const count=(inventory,id)=>stacks(inventory).filter(i=>i.id===id).reduce((n,i)=>n+i.count,0);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const buildingBlocks=['cobblestone','cobbled_deepslate','netherrack','dirt','stone','andesite','diorite','granite'];

// Inventory baselines and observed drops are separate, as in MIT Mine AI MCP's
// barter and hunt/drop-accounting actions. A vanished item is never a receipt.
export async function barterPiglins(args,{call,signal,now=Date.now,sleep=ms=>delay(ms,undefined,{signal}),query=options=>assistanceQuery(call,'entities',{radius:24,signal,...options}),stabilize=()=>assistanceQuery(call,'trade_stability',{signal,timeoutMs:3000})}={}) {
 const rawItem=args.item??'ender_pearl',item=typeof rawItem==='string'?rawItem.replace(/^minecraft:/,''):'',wanted=args.count??4,goldBudget=args.goldBudget??16,seconds=args.seconds??120;
 if(!/^[a-z0-9_]+$/.test(item)||!Number.isInteger(wanted)||wanted<1||wanted>64||!Number.isInteger(goldBudget)||goldBudget<1||goldBudget>64||!Number.isInteger(seconds)||seconds<15||seconds>180||args.uuid&&!/^[0-9a-f-]{36}$/i.test(args.uuid))throw Error('交易需要物品名、1–64个新增物品、1–64枚金锭预算和15–180秒时限。');
 const id='minecraft:'+item,started=now(),deadline=started+seconds*1000;
 const initial=await call('player.getState'),inventory=await call('player.getInventory');
 if(initial.dimension!=='minecraft:the_nether')throw Error('猪灵交易工具只在地狱使用。');
 if(!initial.onGround||initial.inLava||initial.inWater||initial.health<=8)throw Error('先站到稳定、干燥的地面并恢复生命，再开始交易。');
 if(count(inventory,'minecraft:gold_ingot')<1)throw Error('背包没有金锭；金粒、金块、金装备不会按本工具交换。');
 if(36-stacks(inventory).length<2)throw Error('交易前请至少留出两个背包空格。');
 let scene=await query(),piglin=scene.entities.find(e=>e.uuid===args.uuid&&e.type==='minecraft:piglin'&&(e.health??1)>0&&!e.baby&&e.mainhand!=='minecraft:crossbow');
 if(!args.uuid)piglin=scene.entities.filter(e=>e.type==='minecraft:piglin'&&(e.health??1)>0&&!e.baby&&e.mainhand!=='minecraft:crossbow'&&e.offhand!=='minecraft:gold_ingot'&&e.distance<=12).sort((a,b)=>a.distance-b.distance)[0];
 if(!piglin)throw Error('附近没有可用的成年近战猪灵；持弩猪灵保持中立，不作为高台交易对象。先用locate_resource找近战猪灵并走近。');
 if(piglin.offhand==='minecraft:gold_ingot')throw Error('该猪灵正在处理已有金锭，等这笔交换结束后再开始。');
 const block=stacks(inventory).find(i=>buildingBlocks.includes(i.id.replace('minecraft:',''))&&i.count>=2);
 if(!block)throw Error('搭交易高台需要同一格至少两个普通建筑方块。');
 const before=count(inventory,id),observed=new Map(),baseline=new Set(scene.entities.map(e=>e.uuid));
 const receipt={status:'interrupted',item:id,requested:wanted,inventoryBefore:before,inventoryAfter:before,gained:0,goldBudget,goldOffers:0,goldSpent:0,piglin:piglin.uuid,towerBlocks:0,observedDrops:[],elapsedMs:0};
 let floor=initial,platform=null;
 const finish=async reason=>{
  const after=await call('player.getInventory');receipt.inventoryAfter=count(after,id);receipt.gained=Math.max(0,receipt.inventoryAfter-before);
  const netGold=Math.max(0,count(inventory,'minecraft:gold_ingot')-count(after,'minecraft:gold_ingot'));receipt.goldRecovered=Math.max(0,receipt.goldSpent-netGold);receipt.goldSpent=netGold;
  receipt.observedDrops=[...observed.values()].slice(0,8);receipt.receivedItems=[...new Set(stacks(after).map(i=>i.id))].map(item=>({item,count:count(after,item)-count(inventory,item)})).filter(i=>i.count>0).slice(0,12);receipt.elapsedMs=now()-started;
  return {...receipt,status:receipt.gained>=wanted?'succeeded':'interrupted',reason:receipt.gained>=wanted?'requested_items_collected':reason};
 };
 const ensure=async()=>{
  signal?.throwIfAborted();const self=await call('player.getState');
  if(self.dimension!==initial.dimension||self.health<=8||self.inLava)throw Object.assign(Error('交易因维度变化、岩浆或生命降至危险线而中断；已花金锭不会重投。'),{code:'BARTER_DANGER',playerState:{x:self.x,y:self.y,z:self.z,health:self.health,inLava:self.inLava,dimension:self.dimension}});
  return self;
 };
 const observe=entities=>{
  for(const e of entities)if(e.item&&!baseline.has(e.uuid)&&e.item!=='minecraft:gold_ingot'&&distance(e,platform||floor)<10)observed.set(e.uuid,{uuid:e.uuid,item:e.item,count:e.count,position:{x:e.x,y:e.y,z:e.z},state:'observed_item'});
 };
 try {
  await call('fish.cancel');await call('screen.close');
  if(piglin.distance>8){
   const progress={};
   await call('fish.navigate',{x:piglin.x,y:piglin.y,z:piglin.z,reach:6});
   const until=Math.min(deadline,now()+12000);
   while(now()<until){const self=await ensure(),remaining=distance(self,piglin);advance(progress,remaining,{now:now()});if(remaining<=7||now()-progress.bestAt>6000)break;await sleep(200);}
   await call('fish.cancel');
  }
  floor=await ensure();if(distance(floor,piglin)>10)return finish('piglin_unreachable');
  // Two ordinary jump-and-place actions. Never synthesize blocks or teleport.
  const x=Math.floor(floor.x),y=Math.floor(floor.y),z=Math.floor(floor.z);
  const space=(await call('fish.probeBlocks',{positions:[{x,y:y-1,z},...Array.from({length:4},(_,i)=>({x,y:y+i,z}))]})).blocks;
  if(!floor.onGround||!space[0]?.fullSupport||space.slice(1).some(b=>!b.loaded||b.collision||b.fluid))return finish('tower_space_blocked');
  await stabilize();
  await call('fish.equip',{slot:block.slot,hotbarSlot:7});
  for(let step=0;step<2;step++){
   await call('control.setInput',{jump:true});let placed=false;const until=Math.min(deadline,now()+2500);
   while(now()<until){
    const self=await ensure();
    if(self.y>=y+step+1.02){
     try{await call('fish.placeBlock',{x,y:y+step-1,z,face:'up'});placed=true;break;}catch(error){signal?.throwIfAborted();receipt.lastProblem=error.message;}
    }
    await sleep(40);
   }
   await call('control.stop');
   if(!placed)return finish('tower_placement_failed');
   await sleep(300);
   const proof=(await call('fish.probeBlocks',{positions:[{x,y:y+step,z}]})).blocks[0];
   if(!proof?.fullSupport)return finish('tower_not_confirmed');
   receipt.towerBlocks++;
  }
  platform=await ensure();
  if(platform.y<y+1.8)return finish('tower_height_not_confirmed');
  for(let offer=0;offer<goldBudget&&now()<deadline-5000;offer++){
   await ensure();scene=await query();observe(scene.entities);
   const target=scene.entities.find(e=>e.uuid===piglin.uuid&&!e.baby);
   if(target?.health===0)return finish('piglin_died');
   if(!target||distance(target,platform)>6)return {...await finish(target?'piglin_moved_out_of_range':'piglin_no_longer_loaded'),lastTarget:target||null,platform};
   if(target.mainhand==='minecraft:crossbow')return finish('piglin_switched_to_crossbow');
   if(target.offhand==='minecraft:gold_ingot')return finish('piglin_still_processing_previous_offer');
   const inv=await call('player.getInventory'),gold=stacks(inv).find(i=>i.id==='minecraft:gold_ingot');
   if(!gold)break;
   const goldBefore=count(inv,'minecraft:gold_ingot');
   // Drop one held ingot directionally (Q), not a randomly scattered menu item.
   await call('fish.equip',{slot:gold.slot,hotbarSlot:7});
   await call('fish.offerGold',{x:target.x,y:target.y+1.7,z:target.z});receipt.goldOffers++;
   await sleep(200);
   const spent=goldBefore-count(await call('player.getInventory'),'minecraft:gold_ingot');
   if(spent!==1)return finish('gold_offer_not_confirmed');
   receipt.goldSpent++;
   const prior=new Set(observed.keys()),waitUntil=Math.min(deadline-4000,now()+14000);let accepted=false,produced=false;
   while(now()<waitUntil){
    await ensure();scene=await query();observe(scene.entities);
    const recipient=scene.entities.find(e=>e.uuid===piglin.uuid);
    accepted ||= recipient?.offhand==='minecraft:gold_ingot';
    const carried=await call('player.getInventory');
    produced=[...observed.keys()].some(uuid=>!prior.has(uuid))||stacks(carried).some(i=>i.id!=='minecraft:gold_ingot'&&count(carried,i.id)>count(inv,i.id));
    if(accepted&&recipient&&recipient.offhand!=='minecraft:gold_ingot'&&produced)break;
    await sleep(300);
   }
   if(!accepted||!produced)return {...await finish(accepted?'exchange_output_not_observed':'gold_recipient_not_confirmed'),lastTarget:scene.entities.find(e=>e.uuid===piglin.uuid)||null,unclaimedGold:scene.entities.filter(e=>e.item==='minecraft:gold_ingot').slice(0,3),platform};
   if(count(await call('player.getInventory'),id)-before>=wanted)return finish('requested_items_collected');
   if([...observed.values()].filter(e=>e.item===id).reduce((n,e)=>n+e.count,0)>=wanted)break;
  }
  // Leave the pillar on a checked, solid adjacent floor; collect by normal walking.
  const adjacent=[{x:x+1,z},{x:x-1,z},{x,z:z+1},{x,z:z-1}];
  const cells=(await call('fish.probeBlocks',{positions:adjacent.flatMap(p=>[-1,0,1].map(dy=>({...p,y:y+dy})))})).blocks;
  const index=adjacent.findIndex((_,i)=>cells[i*3]?.loaded&&cells[i*3].fullSupport&&!cells[i*3].fluid&&cells.slice(i*3+1,i*3+3).every(b=>b.loaded&&!b.collision&&!b.fluid));
  const landing=index<0?null:adjacent[index];
  if(!landing)return finish('no_safe_descent_observed');
  await call('fish.navigate',{x:landing.x+.5,y,z:landing.z+.5,reach:.6});
  let until=now()+Math.min(7000,Math.max(0,deadline-now()));
  while(now()<until){const self=await ensure();if(self.onGround&&self.y<y+.5)break;await sleep(150);}
  await call('fish.cancel');
  // Baritone can refuse a two-block drop without a pickaxe. The adjacent floor,
  // feet and head were just checked, so walking one block off is sufficient.
  if((await ensure()).y>=y+.5&&now()<deadline){
   const departure=await ensure(),dx=landing.x+.5-departure.x,dz=landing.z+.5-departure.z,threshold=dx*dx+dz*dz-.12*Math.hypot(dx,dz);
   await call('control.lookAt',{x:landing.x+.5,y:platform.y+1.62,z:landing.z+.5});await sleep(100);
   await call('control.setInput',{forward:true});until=Math.min(deadline,now()+1500);
   try{while(now()<until){const self=await ensure();if((self.x-departure.x)*dx+(self.z-departure.z)*dz>=threshold)break;await sleep(40);}}
   finally{await call('control.stop');}
   await sleep(500);
   if((await ensure()).y>=y+.5)return finish('safe_descent_not_reached');
  }
  scene=await query();observe(scene.entities);
  const drops=scene.entities.filter(e=>e.item&&e.item!=='minecraft:gold_ingot'&&observed.has(e.uuid)).sort((a,b)=>Number(b.item===id)-Number(a.item===id)||a.distance-b.distance);
  for(const drop of drops.slice(0,12)){
   if(now()>deadline)break;
   await ensure();
   if(stacks(await call('player.getInventory')).length>=36)break;
   await call('fish.navigate',{x:drop.x,y:drop.y,z:drop.z,reach:.5});until=Math.min(deadline,now()+2500);
   while(now()<until){const self=await ensure();if(distance(self,drop)<1.2)break;await sleep(150);}
   await call('fish.cancel');await sleep(200);
  }
  return finish(receipt.goldSpent>=goldBudget?'gold_budget_exhausted':'time_or_available_gold_exhausted');
 }catch(error){signal?.throwIfAborted();if(error.code==='BARTER_DANGER')return {...await finish('player_danger'),message:error.message,playerState:error.playerState,platformPosition:platform?{x:platform.x,y:platform.y,z:platform.z}:null};throw error;}
 finally{await call('fish.cancel').catch(()=>{});}
}

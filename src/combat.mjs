import {setTimeout as delay} from 'node:timers/promises';

export function chooseMeleeWeapon(inventory,choice='auto'){
 if(typeof choice!=='string'||choice.length>80)throw Error('请选择auto、held或背包中近战武器的物品ID。');
 const items=[...(inventory.hotbar||[]),...(inventory.main||[])];
 const isPrecious = i => /diamond|netherite/.test(i.id || '');
 const usable = i => /_(sword|axe)$|:mace$/.test(i.id) && (!i.maxDamage || !isPrecious(i) ? (i.maxDamage ? i.maxDamage - (i.damage || 0) > 0 : true) : i.maxDamage - (i.damage || 0) > 3);
 if(choice==='held')return {id:items.find(i=>i.slot===inventory.selectedSlot)?.id||'minecraft:air',slot:inventory.selectedSlot,held:true};
 const id=choice.includes(':')?choice:'minecraft:'+choice;
 const rank=i=>(i.id.endsWith('_sword')?100:i.id.endsWith('_axe')?50:40)+(['wooden','golden','stone','iron','diamond','netherite'].findIndex(m=>i.id.includes(m))+1)+(i.maxDamage&&i.maxDamage-(i.damage||0)<=3?-20:0);
 const item=choice==='auto'?items.filter(usable).sort((a,b)=>rank(b)-rank(a))[0]:items.find(i=>i.id===id&&usable(i));
 if(!item)throw Error(choice==='auto'?'没有可用的剑或斧，请先制作武器；原地手动攻击仍可使用。':'指定近战武器不在背包中、耐久过低或不是剑/斧/重锤。');
 return item;
}

const isApproachError=error=>/out of.*reach|obstructed|line of sight/i.test(error.message);
const itemCount=(inventory,id)=>[...(inventory.hotbar||[]),...(inventory.main||[])].filter(item=>item.id===id).reduce((total,item)=>total+item.count,0);

async function collectLoot({id,before,dimension,until,call,now,sleep,signal}) {
 await call('fish.cancel');
 const findUntil=Math.min(until,now()+1600);
 let destination;
 while(now()<until){
  signal?.throwIfAborted();
  const player=await call('player.getState');
  const gained=Math.max(0,itemCount(await call('player.getInventory'),id)-before);
  if(gained||player.dimension!==dimension||player.health<=8||player.inLava)return {item:id,gained};
  if(!destination){
   const {entities}=await call('perception.entities',{radius:6,kinds:['item']});
   const nearby=entities.find(entity=>entity.item?.id===id&&Math.abs(entity.y-player.y)<2);
   if(nearby){
    destination=nearby;
    await call('fish.navigate',{x:nearby.x,y:nearby.y,z:nearby.z,reach:.45});
   }else if(now()>=findUntil)break;
  }
  await sleep(180);
 }
 return {item:id,gained:Math.max(0,itemCount(await call('player.getInventory'),id)-before)};
}

// One model decision, with optional pickup of a specified nearby drop.

export async function fightEntity(args,{call,signal,now=Date.now,sleep=ms=>delay(ms,undefined,{signal})}={}){
 if(!/^[0-9a-f-]{36}$/i.test(args.uuid||'')||!Number.isInteger(args.seconds??30)||(args.seconds??30)<1||(args.seconds??30)>60)throw Error('连续近战需要已观察实体UUID，时长1–60秒。');
 if(args.loot!==undefined&&(typeof args.loot!=='string'||!/^(?:minecraft:)?[a-z0-9_]{1,64}$/.test(args.loot)))throw Error('loot 需要指定可拾取的原版物品ID。');
 const lootId=args.loot&&(args.loot.startsWith('minecraft:')?args.loot:'minecraft:'+args.loot);
 const started=now(),deadline=started+(args.seconds??30)*1000,result={status:'interrupted',uuid:args.uuid,attacks:0,deathObserved:false};
 let initial,lastNav=null,lastNavAt=-Infinity,lastPosition=null,movedAt=started,lastAttackAt=started,navigating=false;
 const finish=reason=>({...result,reason,elapsedMs:now()-started});
 try{
  await call('fish.cancel');await call('screen.close');initial=await call('player.getState');
  const inventory=await call('player.getInventory');
  const weapon=chooseMeleeWeapon(inventory,args.weapon??'auto');result.weapon=weapon.id;
  const defeated=async()=>{
   if(lootId&&result.attacks>0){
    try{result.loot=await collectLoot({id:lootId,before:itemCount(inventory,lootId),dimension:initial.dimension,until:Math.min(deadline,now()+4500),call,now,sleep,signal});}
    catch(error){signal?.throwIfAborted();result.loot={item:lootId,error:error.message};}
   }
   return {...finish('target_defeated'),status:'succeeded',deathObserved:true};
  };
  if(!weapon.held)await call('fish.equip',{slot:weapon.slot,hotbarSlot:7});
  while(now()<deadline){
   signal?.throwIfAborted();const self=await call('player.getState');
   if(self.gameMode!=='survival'||self.dimension!==initial.dimension)return finish('player_state_changed');
   if(self.health<=8||self.inLava||(self.air??300)<100)return finish('player_danger');
   const entities=(await call('perception.entities',{radius:64,kinds:[]})).entities;
   const target=entities.find(e=>e.uuid===args.uuid);
   if(!target){
    try{
     const last=await call('fish.attack',{uuid:args.uuid});
     if(last.deathObserved)return await defeated();
    }catch(error){
     signal?.throwIfAborted();
     if(!isApproachError(error))throw error;
    }
    return {...finish('target_missing'),missing:true};
   }
   result.targetType=target.type;
   if(/creeper|end_crystal|tnt/.test(target.type))return finish('explosive_target_requires_other_tactic');
   if(entities.some(e=>e.uuid!==args.uuid&&/creeper/.test(e.type)&&e.distance<5))return finish('explosive_nearby');
   const distance=Math.hypot(self.x-target.x,self.y-target.y,self.z-target.z);result.distance=distance;
   let needsApproach=distance>2.5;
   if(!needsApproach){
    if(navigating){await call('fish.cancel');navigating=false;}
    try{
     const hit=await call('fish.attack',{uuid:args.uuid});
     if(hit.deathObserved)return await defeated();
     if(hit.missing)return {...finish('target_missing'),missing:true};
     if(hit.attacked){result.attacks++;lastAttackAt=now();movedAt=now();}
    }catch(error){
     signal?.throwIfAborted();
     if(!isApproachError(error))throw error;
     result.lastApproachProblem=/obstructed|line of sight/i.test(error.message)?'line_of_sight':'out_of_reach';needsApproach=true;
    }
   }
   if(needsApproach){
    const shift=lastNav?Math.hypot(target.x-lastNav.x,target.y-lastNav.y,target.z-lastNav.z):Infinity;
    const nav=await call('fish.navigationStatus');
    if(now()-lastNavAt>=800&&(!navigating||shift>=1.2||!nav.active)){
     await call('fish.navigate',{x:target.x,y:target.y,z:target.z,reach:1.5});lastNav={x:target.x,y:target.y,z:target.z};lastNavAt=now();navigating=true;
    }
   }
   if(!lastPosition||Math.hypot(self.x-lastPosition.x,self.y-lastPosition.y,self.z-lastPosition.z)>.35){lastPosition={x:self.x,y:self.y,z:self.z};movedAt=now();}
   if(now()-movedAt>6500&&now()-lastAttackAt>6500)return finish(result.lastApproachProblem==='line_of_sight'?'no_clear_approach':'no_progress');
   const inventory=await call('player.getInventory'),held=[...(inventory.hotbar||[]),...(inventory.main||[])].find(i=>i.slot===inventory.selectedSlot);
   if(!weapon.held&&held?.id!==weapon.id)return finish('weapon_changed_or_broken');
   if(held?.maxDamage&&/diamond|netherite/.test(held.id||'')&&held.maxDamage-(held.damage||0)<=3)return finish('weapon_nearly_broken');
   await sleep(150);
  }
  return finish('time_budget');
 }finally{await call('fish.cancel').catch(()=>{});}
}

import {setTimeout as delay} from 'node:timers/promises';
import {chooseMeleeWeapon} from './combat.mjs';

const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const validCell = cell => cell?.loaded && !cell.fluid && !/portal|fire|cactus|magma/.test(cell.id);
const cloudsNear = async call => (await call('fish.dragonState')).clouds;
const clearOfClouds = (point,clouds) => clouds.every(cloud=>Math.abs(point.y-cloud.y)>2||Math.hypot(point.x-cloud.x,point.z-cloud.z)>cloud.radius+.9);

function cloudCrossing(from,to,clouds) {
  const length=distance(from,to);
  let crossing=0;
  for(let step=.5;step<length;step+=.5) {
    const t=step/length;
    const point={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:from.z+(to.z-from.z)*t};
    if(!clearOfClouds(point,clouds)) crossing+=.5;
  }
  return crossing;
}

async function refuge(call, player, clouds) {
  const directions=[[1,0],[-1,0],[0,1],[0,-1],[.7,.7],[.7,-.7],[-.7,.7],[-.7,-.7]];
  const points = directions.flatMap(([dx,dz])=>[4,8].flatMap(step=>[0,1,-1].map(dy=>({
    x:Math.floor(player.x)+Math.round(dx*step)+.5,y:Math.round(player.y)+dy,z:Math.floor(player.z)+Math.round(dz*step)+.5,
  }))));
  const score=point=>cloudCrossing(player,point,clouds)*20+distance(player,point)+Math.abs(Math.hypot(point.x,point.z)-9)*.15;
  const candidates = points.filter(point=>clearOfClouds(point,clouds)&&Math.hypot(point.x,point.z)<=30)
    .map(point=>({point,score:score(point)})).sort((a,b)=>a.score-b.score).map(({point})=>point);
  for (let offset=0;offset<candidates.length;offset+=16) {
    const batch = candidates.slice(offset,offset+16);
    const positions = batch.flatMap(point=>[-1,0,1].map(dy=>({...point,y:point.y+dy})));
    const {blocks} = await call('fish.probeBlocks',{positions});
    const point = batch.find((_,i)=>{
      const [floor,feet,head]=blocks.slice(i*3,i*3+3);
      return [floor,feet,head].every(validCell)&&floor.fullSupport&&!floor.falling&&!feet.collision&&!head.collision;
    });
    if(point) return point;
  }
}

async function strikingPosition(call, head, player, excluded,clouds) {
  const x = Math.floor(head.x), y = Math.floor(head.y), z = Math.floor(head.z);
  const offsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
  const candidates = offsets.flatMap(([dx,dz]) => [0,-1,-2,-3].map(dy=>({x:x+dx,y:y+dy,z:z+dz})));
  const positions = candidates.flatMap(point=>[-1,0,1].map(dy=>({...point,y:point.y+dy})));
  const {blocks} = await call('fish.probeBlocks',{positions});
  return candidates.flatMap((point,index)=>{
    const [floor,feet,top] = blocks.slice(index*3,index*3+3);
    const key = `${point.x},${point.y},${point.z}`;
    if (excluded.has(key)||![floor,feet,top].every(validCell)||!floor.fullSupport||floor.falling||feet.collision||top.collision) return [];
    const target = {x:point.x+.5,y:point.y,z:point.z+.5,key};
    const eye = {...target,y:target.y+1.62};
    if (distance(eye,head)>2.85||!clearOfClouds(target,clouds)||cloudCrossing(player,target,clouds)>0) return [];
    return [target];
  }).sort((a,b)=>distance(a,player)-distance(b,player))[0];
}

export async function fightDragon({seconds=90,weapon='auto'}, {call,signal}) {
  if (!Number.isInteger(seconds)||seconds<10||seconds>120) throw Error('一次落地接战的时限为10–120秒。');
  const anchor = await call('player.getState');
  if (anchor.dimension!=='minecraft:the_end'||!anchor.onGround||anchor.health<=10||Math.hypot(anchor.x,anchor.z)>32) {
    throw Error('请先在末地中央基岩喷泉附近找安全地面站稳。');
  }
  await call('screen.close');
  const selected = chooseMeleeWeapon(await call('player.getInventory'),weapon);
  if (!selected.held) await call('fish.equip',{slot:selected.slot,hotbarSlot:7});
  const deadline = Date.now()+seconds*1000;
  const receipt = {attacks:0,retreated:false,perchObserved:false,landingObserved:false,dragonDamage:0,breathEvades:0,approachAttempts:0};
  const sleep = ms=>delay(ms,undefined,{signal});
  const excluded = new Set();
  const goToSafe = async (destination,until) => {
    if(!destination)return false;
    await call('fish.navigate',{x:destination.x,y:destination.y,z:destination.z,reach:1.2});
    while(Date.now()<until) {
      const self=await call('player.getState');
      if (self.health<=0 || self.dimension!==anchor.dimension) return false;
      if (self.onGround&&distance(self,destination)<1.5&&clearOfClouds(self,await cloudsNear(call))) return true;
      await sleep(160);
    }
    return false;
  };
  let restingPoint=anchor;
  let target, navAt=0, initialHealth, lowestHealth=Infinity, reason='perch_timeout';
  try {
    while (Date.now()<deadline) {
      signal?.throwIfAborted();
      const self = await call('player.getState');
      if (self.dimension!==anchor.dimension||self.health<=8||self.inLava||self.y<anchor.y-12) {reason='player_danger';break;}
      const dragon = await call('fish.dragonState');
      const clouds=dragon.clouds;
      if (!clearOfClouds(self,clouds)) {
        reason='dragon_breath';
        if(receipt.perchObserved)break;
        const safe=await refuge(call,self,clouds);
        const escaped=await goToSafe(safe,Math.min(deadline,Date.now()+5500));
        await call('fish.cancel');
        if(!escaped)break;
        restingPoint=safe;
        receipt.breathEvades++;
        reason='perch_timeout';
        continue;
      }
      if (!dragon.found) {reason='dragon_not_observed';break;}
      initialHealth ??= dragon.health;
      lowestHealth = Math.min(lowestHealth,dragon.health);
      receipt.dragonDamage = Math.max(0,initialHealth-lowestHealth);
      if (dragon.dying) {reason='dragon_death_observed';break;}
      if (!dragon.sitting && receipt.perchObserved) {reason='dragon_took_off';break;}
      if (!dragon.sitting && !dragon.landing) {
        if (target) {await call('fish.cancel');target=undefined;}
        excluded.clear();
        await sleep(320);
        continue;
      }
      receipt.landingObserved ||= dragon.landing===true;
      if (dragon.sitting) {
        if (!receipt.perchObserved) excluded.clear();
        receipt.perchObserved=true;
        reason='perch_time_limit';
        try {
          const hit = await call('fish.attack',{uuid:dragon.uuid});
          if (hit.attacked) receipt.attacks++;
          if (hit.deathObserved) {reason='dragon_death_observed';break;}
          if (target) {await call('fish.cancel');target=undefined;}
          await sleep(180);
          continue;
        } catch(error) {
          signal?.throwIfAborted();
          if (!/melee reach|obstructed/.test(error.message)) throw error;
        }
      }
      if (target && (distance({...target,y:target.y+1.62},dragon.head)>3.3||!clearOfClouds(target,clouds))) {
        await call('fish.cancel');target=undefined;
      }
      if (target && (Date.now()-navAt>3500||(dragon.sitting&&distance(self,target)<.65))) {excluded.add(target.key);target=undefined;}
      if (!target) {
        target = await strikingPosition(call,dragon.head,self,excluded,clouds);
        if (!target) {if(dragon.sitting) reason='no_safe_striking_position';await sleep(250);continue;}
        await call('fish.navigate',{x:target.x,y:target.y,z:target.z,reach:.6});
        receipt.approachAttempts++;
        navAt=Date.now();
      }
      await sleep(180);
    }
    await call('fish.cancel');
    const current = await call('player.getState');
    if (current.dimension===anchor.dimension && current.health>0 && current.y>=anchor.y-12) {
      const clouds=await cloudsNear(call);
      const clearReturn=clearOfClouds(restingPoint,clouds)&&cloudCrossing(current,restingPoint,clouds)<1;
      const retreat=clearReturn?restingPoint:await refuge(call,current,clouds);
      if (retreat&&distance(current,retreat)>1.5) {
        receipt.retreated=await goToSafe(retreat,Date.now()+6500);
      } else receipt.retreated=current.onGround&&clearOfClouds(current,clouds);
    }
    return {...receipt,status:receipt.attacks>0&&receipt.dragonDamage>0&&receipt.retreated?'succeeded':'interrupted',reason};
  } finally {await call('fish.cancel').catch(()=>{});}
}

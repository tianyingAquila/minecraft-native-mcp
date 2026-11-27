import {setTimeout as delay} from 'node:timers/promises';
import {assistanceQuery} from './assistance.mjs';
import {mineBlock} from './mining.mjs';

const blocks = new Set(['minecraft:end_stone','minecraft:cobblestone','minecraft:cobbled_deepslate','minecraft:stone','minecraft:netherrack','minecraft:dirt']);
const material = async call => {
  const inventory = await call('player.getInventory');
  return [...inventory.hotbar,...inventory.main].find(stack=>blocks.has(stack.id));
};
const supported = block=>block?.loaded&&block.fullSupport&&!block.fluid&&!block.falling;

export async function pillar({direction,height}, {call,signal}) {
  if (!['up','down'].includes(direction)||!Number.isInteger(height)||height<1||height>48) throw Error('指定原地搭高或拆柱下降，限1–48格。');
  await call('fish.cancel');
  await call('screen.close');
  const start = await call('player.getState');
  const x = Math.floor(start.x), z = Math.floor(start.z), y = Math.round(start.y);
  if (!start.onGround||Math.abs(start.y-y)>.12||Math.hypot(start.x-x-.5,start.z-z-.5)>.39||start.health<=10) throw Error('请先在柱子位置的完整方块中央站稳。');
  const at = dy=>({x,y:y+dy,z});
  const probe = async positions=>(await call('fish.probeBlocks',{positions})).blocks;
  const path = direction==='up'
    ? await probe(Array.from({length:height+3},(_,i)=>at(i-1)))
    : await probe(Array.from({length:height+1},(_,i)=>at(-i-1)));
  if (direction==='up') {
    if(!supported(path[0])) throw Error('柱脚下方没有完整支撑。');
    const blocked=path.slice(1).findIndex(block=>!block.loaded||!block.air||block.fluid);
    if(blocked>=0) throw Error(`柱子上方 y=${y+blocked} 的${path[blocked+1].id||'未加载方块'}挡住净空；换站位或降低目标高度。`);
  }
  if (direction==='down'&&(!path.every(supported)||path.slice(0,-1).some(block=>!blocks.has(block.id)))) throw Error('下降只拆连续普通建筑块，底部必须有支撑。');
  let advanced=0;
  const fail = (reason,message) => ({status:'interrupted',reason,advanced,message});
  const wait = ms=>delay(ms,undefined,{signal});
  const safe = async () => {
    signal?.throwIfAborted();
    const state = await call('player.getState');
    if(state.dimension!==start.dimension||state.health<=10||state.health<start.health-2||state.inLava||Math.floor(state.x)!==x||Math.floor(state.z)!==z) throw Error('角色受伤、偏离柱子或进入危险区域。');
    return state;
  };
  const limit = Date.now()+145000;
  try {
    for(let step=0;step<height&&Date.now()<limit;step++) {
      await safe();
      if(direction==='up') {
        const held=await material(call);
        if(!held) return fail('no_building_blocks');
        await call('fish.equip',{slot:held.slot,hotbarSlot:7});
        await call('control.setInput',{jump:true});
        const deadline=Date.now()+2300;
        let placed=false;
        try {
          while(Date.now()<deadline) {
            if((await safe()).y>=y+step+1.02) {
              await call('fish.placeBlock',{...at(step-1),face:'up'});
              placed=true;
              break;
            }
            await wait(35);
          }
        } finally {await call('control.stop');}
        if(!placed) return fail('jump_placement_not_confirmed');
        const proof=(await probe([at(step)]))[0];
        if(proof?.id!==held.id||!supported(proof)) return fail('pillar_block_not_confirmed');
      } else {
        await mineBlock(call,at(-step-1),{signal,check:safe});
      }
      const wanted=y+(direction==='up'?step+1:-step-1);
      const landUntil=Date.now()+1600;
      let landed=false;
      while(Date.now()<landUntil) {
        const state=await safe();
        if(state.onGround&&Math.abs(state.y-wanted)<.12) {landed=true;break;}
        await wait(50);
      }
      if(!landed) return fail('pillar_height_not_confirmed');
      advanced++;
    }
    return {status:advanced===height?'succeeded':'interrupted',advanced,reason:advanced===height?'completed':'time_limit'};
  } catch(error) {
    signal?.throwIfAborted();
    return fail('pillar_action_failed',error.message);
  } finally {await call('fish.cancel').catch(()=>{});}
}

async function approachCrystalBase(target,start,call,signal) {
  const x=Math.floor(target.x),z=Math.floor(target.z),y=Math.round(start.y);
  const points=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dz])=>({x:x+dx+.5,y,z:z+dz+.5}));
  const distance=point=>Math.hypot(point.x-start.x,point.z-start.z);
  points.sort((a,b)=>distance(a)-distance(b));
  const {blocks:cells}=await call('fish.probeBlocks',{positions:points.flatMap(point=>[-1,0,1].map(dy=>({...point,y:y+dy})))});
  const destination=points.find((_,i)=>{
    const [floor,feet,head]=cells.slice(i*3,i*3+3);
    return supported(floor)&&feet?.loaded&&feet.air&&head?.loaded&&head.air;
  });
  if(!destination||distance(destination)>3) return;
  await call('fish.navigate',{...destination,reach:.35});
  const deadline=Date.now()+4500;
  try {
    while(Date.now()<deadline) {
      const player=await call('player.getState');
      if(player.health<15||player.inLava||player.dimension!==start.dimension||player.y<y-.5) return;
      if(player.onGround&&Math.abs(player.y-y)<.1&&Math.hypot(player.x-destination.x,player.z-destination.z)<.35) return player;
      await delay(100,undefined,{signal});
    }
  } finally {await call('fish.cancel').catch(()=>{});}
}

export async function breakCrystal({uuid,bar,cover}, {call,place,signal}) {
  if (!/^[0-9a-f-]{36}$/i.test(uuid||'')) throw Error('需要已观察到的水晶 UUID。');
  let start=await call('player.getState');
  if(start.dimension!=='minecraft:the_end'||!start.onGround||start.health<15) throw Error('请先在末地水晶旁站稳并恢复生命。');
  const read=()=>call('fish.crystalExposure',{uuid});
  await call('fish.cancel');
  await call('screen.close');
  let target=await read();
  if(!target.found) throw Error('未观察到目标水晶。');
  if(bar&&(await call('fish.probeBlocks',{positions:[bar]})).blocks[0]?.id!=='minecraft:iron_bars') {
    throw Error('bar 指定的方块不是铁栏杆。省略 bar，程序会检查攻击位置正上方的栏杆。');
  }
  if(cover&&!(await call('fish.probeBlocks',{positions:[cover]})).blocks[0]?.air) {
    throw Error('cover 必须是已加载的空格。可省略 cover 并让柱顶黑曜石挡住爆炸。');
  }
  let lift=0;
  let horizontal=Math.hypot(start.x-target.x,start.z-target.z);
  const height=Math.floor(target.y)-2-Math.round(start.y);
  if(horizontal>=1.6&&horizontal<4&&height>0&&height<=48){
    const base=await approachCrystalBase(target,start,call,signal);
    if(!base) return {status:'interrupted',reason:'crystal_base_not_reached'};
    start=base;
    horizontal=Math.hypot(start.x-target.x,start.z-target.z);
  }
  if((!cover||target.distance>4)&&horizontal<1.6&&height!==0&&height>=-3&&height<=48){
    const approach=await pillar({direction:height>0?'up':'down',height:Math.abs(height)},{call,signal});
    if(approach.advanced!==Math.abs(height))return {status:'interrupted',reason:'crystal_height_not_reached',approach};
    lift=Math.max(0,height);
    target=await read();
  }
  if(!target.found||target.distance>4) throw Error('尚未到达水晶旁。请先在柱脚找到水平靠近水晶的完整方块并站稳，或自行搭到水晶侧面下方再试。');
  if(!bar&&horizontal<1.6){
    const current=await call('player.getState');
    const opening={x:Math.floor(current.x),y:Math.floor(target.y),z:Math.floor(current.z)};
    if((await call('fish.probeBlocks',{positions:[opening]})).blocks[0]?.id==='minecraft:iron_bars')bar=opening;
  }
  let openedBar;
  if(bar) {
    const cell=(await call('fish.probeBlocks',{positions:[bar]})).blocks[0];
    if(cell?.id!=='minecraft:iron_bars') throw Error('指定的开口位置不是铁栏杆。');
    openedBar=(await mineBlock(call,bar,{signal})).position;
  }
  if(cover) {
    const held=await material(call);
    if(!held) throw Error('缺少遮挡用建筑块。');
    await call('fish.equip',{slot:held.slot,hotbarSlot:7});
    await place(cover);
  }
  target=await read();
  if(!target.found||target.exposure>.22) return {status:'interrupted',reason:'insufficient_blast_cover',exposure:target.exposure,openedBar};
  const until=Date.now()+2200;
  let attacked=false;
  while(Date.now()<until) {
    const health=await call('player.getState');
    if(!health.onGround||health.health<15||health.dimension!==start.dimension) break;
    const hit=await call('fish.attack',{uuid});
    if(hit.attacked) {attacked=true;break;}
    await delay(160,undefined,{signal});
  }
  if(!attacked) return {status:'interrupted',reason:'crystal_strike_not_confirmed'};
  await delay(450,undefined,{signal});
  let after=await call('player.getState');
  const scene=await assistanceQuery(call,'entities',{radius:24,signal});
  const destroyed=after.dimension===start.dimension&&Math.hypot(after.x-target.x,after.y-target.y,after.z-target.z)<20&&!scene.entities.some(entity=>entity.uuid===uuid);
  let descent;
  if(destroyed&&lift&&after.health>10&&after.onGround&&Math.floor(after.x)===Math.floor(start.x)&&Math.floor(after.z)===Math.floor(start.z)){
    descent=await pillar({direction:'down',height:lift},{call,signal});
    after=await call('player.getState');
  }
  return {status:destroyed&&after.health>0?'succeeded':'interrupted',reason:destroyed?'crystal_removed':'crystal_not_confirmed',destroyed,healthBefore:start.health,healthAfter:after.health,position:{x:after.x,y:after.y,z:after.z},onGround:after.onGround,openedBar,descent};
}

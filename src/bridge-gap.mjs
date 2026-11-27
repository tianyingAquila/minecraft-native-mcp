import {setTimeout as delay} from 'node:timers/promises';

const directions = {north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]};
const materials = ['minecraft:end_stone','minecraft:cobblestone','minecraft:cobbled_deepslate','minecraft:stone','minecraft:netherrack','minecraft:dirt'];
const safe = block => block?.loaded && !block.fluid && !/lava|fire|magma|cactus|portal/.test(block.id);

export async function bridgeGap({direction,length}, {call,signal}) {
  if (!Object.hasOwn(directions,direction)||!Number.isInteger(length)||length<1||length>16) throw Error('指定搭桥方向与1–16格长度。');
  await call('fish.cancel');
  await call('screen.close');
  const start = await call('player.getState');
  const y = Math.round(start.y);
  if (!start.onGround||Math.abs(y-start.y)>.15||start.inLava||start.health<=10) throw Error('先在完整方块的稳固地面站稳。');
  const [dx,dz] = directions[direction];
  let origin = {x:Math.floor(start.x),y:y-1,z:Math.floor(start.z)};
  const behind = {...origin,x:origin.x-dx,z:origin.z-dz};
  const {blocks: initialBlocks} = await call('fish.probeBlocks',{positions:[origin,behind]});
  if (!initialBlocks[0]?.fullSupport && initialBlocks[1]?.fullSupport) {
    const offset = (start.x-behind.x-.5)*dx + (start.z-behind.z-.5)*dz;
    if (offset >= .5 && offset < .79) origin=behind;
  }
  const report = {placed:0,advanced:0};
  const end = Date.now()+70000;
  const positionsAt = step => ({x:origin.x+step*dx,y:origin.y,z:origin.z+step*dz});
  const interrupted = reason => ({...report,status:'interrupted',reason});
  const read = async () => {
    signal?.throwIfAborted();
    const state = await call('player.getState');
    if (state.dimension!==start.dimension||state.inLava||state.health<=10||state.health<start.health-1||state.y<y-.2) throw Error('搭桥因受伤、失足或维度变化中断。');
    return state;
  };
  const walk = async (x,z,tolerance,deadline=Math.min(end,Date.now()+3000)) => {
    while (Date.now()<deadline) {
      const state = await read();
      if (Math.hypot(state.x-x,state.z-z)<=tolerance) {
        await call('control.setInput',{sneak:true});
        return true;
      }
      await call('control.lookAt',{x,y:state.y+1.62,z});
      await call('control.setInput',{forward:true,sneak:true,sprint:false,jump:false});
      await delay(60,undefined,{signal});
    }
    return false;
  };
  let lastSupport=origin;
  try {
    for (let step=0;step<length&&Date.now()<end;step++) {
      await read();
      const support = positionsAt(step), next = positionsAt(step+1);
      const {blocks} = await call('fish.probeBlocks',{positions:[support,next,{...next,y:y},{...next,y:y+1}]});
      const [base,floor,feet,head] = blocks;
      if (![base,floor,feet,head].every(safe)||!base.fullSupport||base.falling||feet.collision||head.collision) return interrupted('unsafe_or_blocked_route');
      if (!floor.fullSupport||floor.falling) {
        if (!floor.air) return interrupted('next_floor_is_not_replaceable');
        const inventory = await call('player.getInventory');
        const available = [...inventory.hotbar,...inventory.main];
        const material = materials.map(id=>available.find(stack=>stack.id===id)).find(Boolean);
        if (!material) return interrupted('no_building_blocks');
        await call('fish.equip',{slot:material.slot,hotbarSlot:7});
        const edgeX = support.x+.5+dx*.70, edgeZ = support.z+.5+dz*.70;
        if (!(await walk(edgeX,edgeZ,.06))) return interrupted('safe_edge_not_reached');
        await call('control.setInput',{sneak:true});
        await delay(100,undefined,{signal});
        try {await call('fish.placeBlock',{...support,face:direction});}
        catch(error) {signal?.throwIfAborted();return {...interrupted('edge_placement_failed'),message:error.message};}
        await delay(160,undefined,{signal});
        const proof = (await call('fish.probeBlocks',{positions:[next]})).blocks[0];
        if (proof?.id!==material.id||!proof.fullSupport) return interrupted('bridge_block_not_confirmed');
        report.placed++;
      }
      if (!(await walk(next.x+.5,next.z+.5,.18))) return interrupted('new_support_not_reached');
      lastSupport=next;
      report.advanced++;
    }
    return {...report,status:report.advanced===length?'succeeded':'interrupted',reason:report.advanced===length?'requested_length_reached':'time_limit'};
  } finally {
    if(!signal?.aborted) await walk(lastSupport.x+.5,lastSupport.z+.5,.24,Date.now()+2000).catch(()=>{});
    await call('fish.cancel').catch(()=>{});
  }
}

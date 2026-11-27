import {setTimeout as delay} from 'node:timers/promises';
import {mineBlock} from './mining.mjs';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

async function escapeWater(start, {call, signal, now, sleep}) {
  const deadline = now() + 12000;
  let last = start;
  let clearedCeiling = false;

  const findLandStep = async (state) => {
    const px = Math.floor(state.x), py = Math.floor(state.y), pz = Math.floor(state.z);
    const probes = DIRS.flatMap(([dx, dz]) => [
      {x: px + dx, y: py - 1, z: pz + dz},
      {x: px + dx, y: py, z: pz + dz},
      {x: px + dx, y: py + 1, z: pz + dz},
      {x: px + dx, y: py + 2, z: pz + dz},
    ]);
    const blocks = (await call('fish.probeBlocks', {positions: probes})).blocks || [];
    for (let i = 0; i < DIRS.length; i++) {
      const [below, feet, head, above] = blocks.slice(i * 4, i * 4 + 4);
      const [dx, dz] = DIRS[i];
      // Dry bank at same level (feet/head air, solid below)
      if (below?.loaded && below.fullSupport && !below.fluid && feet?.loaded && feet.air && head?.loaded && head.air) {
        return {x: px + dx + 0.5, y: py + 0.5, z: pz + dz + 0.5};
      }
      // Step-up dry bank 1 block higher (feet solid dry, head & above air)
      if (feet?.loaded && feet.fullSupport && !feet.fluid && head?.loaded && head.air && above?.loaded && above.air) {
        return {x: px + dx + 0.5, y: py + 1.5, z: pz + dz + 0.5};
      }
    }
    return null;
  };

  const findOpenUpColumn = async (state) => {
    const px = Math.floor(state.x), py = Math.floor(state.y), pz = Math.floor(state.z);
    const probes = DIRS.flatMap(([dx, dz]) => [
      {x: px + dx, y: py + 1, z: pz + dz},
      {x: px + dx, y: py + 2, z: pz + dz},
    ]);
    const blocks = (await call('fish.probeBlocks', {positions: probes})).blocks || [];
    for (let i = 0; i < DIRS.length; i++) {
      const [b1, b2] = blocks.slice(i * 2, i * 2 + 2);
      const [dx, dz] = DIRS[i];
      if (b1?.loaded && !b1.collision && b2?.loaded && !b2.collision) {
        return {x: px + dx + 0.5, y: py + 1.5, z: pz + dz + 0.5};
      }
    }
    return null;
  };

  try {
    while (now() < deadline) {
      signal?.throwIfAborted();
      const self = await call('player.getState');
      last = self;
      if (self.inLava) {
        return {status: 'interrupted', reason: 'in_lava', from: {x: start.x, y: start.y, z: start.z}, to: {x: self.x, y: self.y, z: self.z}};
      }
      const px = Math.floor(self.x), py = Math.floor(self.y), pz = Math.floor(self.z);
      const headBlocks = (await call('fish.probeBlocks', {
        positions: [
          {x: px, y: py + 1, z: pz},
          {x: px, y: py + 2, z: pz},
        ],
      })).blocks || [];
      const headBlock = headBlocks[0];
      const aboveHead = headBlocks[1];
      const headInAir = Boolean(headBlock?.loaded && headBlock.air);

      // Already out of water and standing on solid ground
      if (!self.inWater && self.onGround) {
        return {
          status: 'succeeded',
          reason: 'escaped_water',
          from: {x: start.x, y: start.y, z: start.z},
          to: {x: self.x, y: self.y, z: self.z},
          airAfter: self.air ?? 300,
          inWater: false,
          onGround: true,
        };
      }

      // If head is above water and air is healthy, try stepping onto an adjacent dry bank or return surfaced.
      const bank = await findLandStep(self);
      if (bank) {
        await call('control.lookAt', bank);
        await call('control.setInput', {forward: true, jump: true, sprint: false, sneak: false});
        await sleep(220);
        const afterStep = await call('player.getState');
        last = afterStep;
        if (!afterStep.inWater && afterStep.onGround) {
          return {
            status: 'succeeded',
            reason: 'escaped_water',
            from: {x: start.x, y: start.y, z: start.z},
            to: {x: afterStep.x, y: afterStep.y, z: afterStep.z},
            airAfter: afterStep.air ?? 300,
            inWater: false,
            onGround: true,
          };
        }
        continue;
      }

      if (headInAir && (self.air ?? 300) >= 260 && (self.y > start.y + 0.3 || !start.inWater || (start.air ?? 300) < 260)) {
        return {
          status: 'succeeded',
          reason: 'surfaced_for_air',
          from: {x: start.x, y: start.y, z: start.z},
          to: {x: self.x, y: self.y, z: self.z},
          airAfter: self.air ?? 300,
          inWater: Boolean(self.inWater),
          onGround: Boolean(self.onGround),
          message: '已持续上浮至水面换气；可选择附近岸边或继续上岸。',
        };
      }

      // Check if trapped directly under a solid ceiling underwater
      if (aboveHead?.loaded && aboveHead.collision && !aboveHead.fluid) {
        const openSide = await findOpenUpColumn(self);
        if (openSide) {
          await call('control.lookAt', openSide);
          await call('control.setInput', {forward: true, jump: true, sprint: false, sneak: false});
          await sleep(240);
          continue;
        }
        if (!clearedCeiling && !aboveHead.blockEntity && (aboveHead.hardness ?? 1) >= 0) {
          await call('control.stop').catch(() => {});
          try {
            await mineBlock(call, {x: px, y: py + 2, z: pz}, {signal, sleep});
            clearedCeiling = true;
          } catch (err) {
            signal?.throwIfAborted();
          }
        }
      }

      // Hold jump continuously to swim upward
      await call('control.setInput', {forward: false, jump: true, sprint: false, sneak: false});
      await sleep(180);
    }

    const finalState = await call('player.getState');
    const rose = finalState.y - start.y;
    const recoveredAir = (finalState.air ?? 300) > (start.air ?? 300);
    return {
      status: (!finalState.inWater || recoveredAir || rose >= 1.5) ? 'succeeded' : 'interrupted',
      reason: !finalState.inWater ? 'escaped_water' : (recoveredAir || rose >= 1.5) ? 'surfaced_partial' : 'water_escape_timeout',
      from: {x: start.x, y: start.y, z: start.z},
      to: {x: finalState.x, y: finalState.y, z: finalState.z},
      climbedY: Number(rose.toFixed(2)),
      airAfter: finalState.air ?? 300,
      inWater: Boolean(finalState.inWater),
      onGround: Boolean(finalState.onGround),
    };
  } finally {
    await call('control.stop').catch(() => {});
    await call('fish.cancel').catch(() => {});
  }
}

// A short, locally verified way out of a stuck position, or continuous swim-up underwater escape.
export async function recoverPosition({call,signal,now=Date.now,sleep=ms=>delay(ms,undefined,{signal})}){
 let start;
 try{
  await call('fish.cancel');await call('screen.close');start=await call('player.getState');
  if (start.inWater || (start.air ?? 300) < 260) {
   return await escapeWater(start, {call, signal, now, sleep});
  }
  if(!start.onGround||start.inLava||start.health<=10||Math.abs(start.y-Math.round(start.y))>.1)return {status:'interrupted',reason:'need_manual_escape',message:'当前不适合自动挪动，请依据真实状态选择脱险动作。'};
  const nearby=(await call('perception.entities',{radius:6,kinds:['hostile']})).entities;
  if(nearby.some(e=>e.distance<6))return {status:'interrupted',reason:'enemy_nearby',message:'近处有敌人，优先战斗或有依据地撤离，不能原地等天亮。'};
  const y=Math.round(start.y),x=Math.floor(start.x),z=Math.floor(start.z),yaw=(start.yaw||0)*Math.PI/180;
  const directions=[[0,1],[-1,0],[0,-1],[1,0]].sort((a,b)=>(-b[0]*Math.sin(yaw)+b[1]*Math.cos(yaw))-(-a[0]*Math.sin(yaw)+a[1]*Math.cos(yaw)));
  const positions=directions.flatMap(([dx,dz])=>[1,2].flatMap(step=>[-2,-1,0,1,2,3].map(dy=>({x:x+dx*step,y:y+dy,z:z+dz*step}))));
  const blocks=(await call('fish.probeBlocks',{positions})).blocks,map=new Map(blocks.map(b=>[`${b.x},${b.y},${b.z}`,b]));
  const at=(px,py,pz)=>map.get(`${px},${py},${pz}`),danger=b=>!b?.loaded||b.fluid||/lava|fire|magma|cactus|campfire|powder_snow|sweet_berry_bush/.test(b.id);
  let target;
  for(const [dx,dz] of directions){let previous=y,valid=true;
   for(const step of [1,2]){const px=x+dx*step,pz=z+dz*step,py=[y,y+1,y-1].find(level=>{
    const floor=at(px,level-1,pz),feet=at(px,level,pz),head=at(px,level+1,pz);
    return Math.abs(level-previous)<=1&&!danger(floor)&&floor.fullSupport&&!floor.falling&&!danger(feet)&&!feet.collision&&!danger(head)&&!head.collision;
   });if(py===undefined){valid=false;break;}previous=py;target={x:px+.5,y:py,z:pz+.5};}
   if(valid)break;target=null;
  }
  if(!target)return {status:'interrupted',reason:'no_verified_exit',message:'附近两格未找到已验证通路。查看具体障碍、截图或有目标地清障，不把脚边方块当成封闭房间。'};
  await call('fish.navigate',{...target,reach:.6});const deadline=now()+4500;
  while(now()<deadline){signal?.throwIfAborted();const self=await call('player.getState');
   if(self.health<start.health||self.inLava||(self.air??300)<100)return {status:'interrupted',reason:'player_danger'};
   if(Math.hypot(self.x-target.x,self.y-target.y,self.z-target.z)<.7)return {status:'succeeded',reason:'position_recovered',from:{x:start.x,y:start.y,z:start.z},to:{x:self.x,y:self.y,z:self.z}};
   await sleep(150);
  }
  return {status:'interrupted',reason:'recovery_route_failed',message:'局部挪动未到达，请重新检查地形或选择其他任务。'};
 }finally{await call('fish.cancel').catch(()=>{});}
}

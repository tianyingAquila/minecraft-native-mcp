import { setTimeout as delay } from 'node:timers/promises';
import { mineBlock } from './mining.mjs';

const DIRECTIONS = {north:[0,-1], south:[0,1], west:[-1,0], east:[1,0]};
const HAZARD = /(?:^|:)(?:lava|water|fire|soul_fire|magma_block|campfire|soul_campfire|cactus|powder_snow|sweet_berry_bush)$/;
const PICKAXE_RANK = ['minecraft:netherite_pickaxe', 'minecraft:diamond_pickaxe', 'minecraft:iron_pickaxe', 'minecraft:stone_pickaxe', 'minecraft:golden_pickaxe', 'minecraft:wooden_pickaxe'];
class TunnelStop extends Error { constructor(reason, extra = null) { super(reason); this.reason=reason; this.extra=extra; } }
const stop = (reason, extra = null) => { throw new TunnelStop(reason, extra); };
const same = (a,b) => a.x===b.x && a.y===b.y && a.z===b.z;

// A finite mechanical action. Direction, depth and whether to continue belong to the model.
export async function digTunnel(args, {call, signal, discover, placeFloor, equip, mergeInventory, sleep = ms => delay(ms, undefined, {signal}), now = Date.now} = {}) {
  const vector = DIRECTIONS[args.direction], length=args.length, slope=args.slope??'level';
  if (!vector || !Number.isInteger(length) || length<1 || length>12 || !['level','down','up'].includes(slope)) throw new Error('矿道方向限north/south/east/west，长度1–12格，坡度level/down/up');
  const started=now(), deadline=started+90000;
  const result={status:'interrupted', direction:args.direction, slope, requestedSteps:length, completedSteps:0, brokenBlocks:0, encountered:[]};
  let initial, stepPositions, floor, cut, lastSelf;
  let discoveryStart;
  const checkDiscovery=async()=>{if(!discover)return;const found=await discover(discoveryStart);if(found.updates?.some(e=>e.salient)){result.discovery=found;stop('new_environment');}};
  const guard = async ({ allowEmptyFloor = false, requirePickaxe = true } = {}) => {
    signal?.throwIfAborted();
    if (now()>=deadline) stop('time_budget');
    const self=await call('player.getState'); lastSelf=self;
    if (self.gameMode!=='survival' || self.dimension!==initial.dimension) stop('player_state_changed');
    if (self.health<initial.health-.1 || self.health<=10 || (self.air??300)<100 || self.inWater) stop('player_danger');
    const nearby=await call('perception.entities', {radius:6, kinds:['hostile']});
    const closeHostiles=(nearby.entities||[]).filter(e=>e.distance<6 && Math.abs((e.y??self.y)-self.y)<=2.6);
    if (closeHostiles.length) {
      let threat=closeHostiles.find(e=>e.distance<2.6 || e.x===undefined || e.z===undefined);
      if (!threat) {
        for (const e of closeHostiles) {
          const samples=[0.3, 0.5, 0.7].flatMap(t => {
            const sx=Math.floor(self.x+(e.x-self.x)*t);
            const sy=Math.floor((self.y+0.5)+((e.y??self.y)-self.y)*t);
            const sz=Math.floor(self.z+(e.z-self.z)*t);
            return [{x:sx,y:sy,z:sz},{x:sx,y:sy+1,z:sz}];
          });
          const wall=(await call('fish.probeBlocks', {positions:samples})).blocks||[];
          let blockedByWall=false;
          for (let i=0;i<wall.length;i+=2) {
            const lo=wall[i], hi=wall[i+1];
            if (lo?.loaded && lo.fullSupport && !lo.air && hi?.loaded && hi.fullSupport && !hi.air) {
              blockedByWall=true; break;
            }
          }
          if (!blockedByWall) { threat=e; break; }
        }
      }
      if (threat) {
        stop('hostile_nearby', {
          hostile: {
            type: threat.type,
            distance: Number((threat.distance??0).toFixed(1)),
            ...(threat.x!==undefined ? {x:Math.floor(threat.x), y:Math.floor(threat.y??self.y), z:Math.floor(threat.z)} : {}),
          },
          message: '通道内近处出现无遮挡敌对生物，已停止挖掘。',
        });
      }
    }
    const blocks=(await call('fish.probeBlocks', {positions:stepPositions})).blocks;
    if (blocks.length!==stepPositions.length || blocks.some(b=>!b.loaded)) stop('unloaded_area');
    if (blocks.some(b=>b.fluid || HAZARD.test(b.id))) stop('fluid_or_hazard');
    const support=blocks.find(b=>same(b,floor));
    if (!support?.fullSupport || support.falling) {
      if (!allowEmptyFloor || !support?.air) {
        stop('unsupported_floor', { missingFloor: floor, message: `前方落脚格(${floor.x},${floor.y},${floor.z})缺少完整支撑（当前为${support?.id || 'unknown'}）。` });
      }
    }
    const above=blocks.find(b=>b.x===floor.x && b.z===floor.z && b.y===cut[0].y+1);
    if (above?.falling) stop('falling_ceiling');
    for (const pos of cut) {
      const block=blocks.find(b=>same(b,pos));
      if (block.falling || block.blockEntity || block.hardness<0) {result.obstacle={id:block.id,position:pos,falling:block.falling,blockEntity:block.blockEntity,hardness:block.hardness};stop('unsafe_or_protected_block');}
      if(blocks.find(b=>b.x===pos.x&&b.z===pos.z&&b.y===pos.y+1)?.falling)stop('falling_ceiling');
    }
    let inv=await call('player.getInventory');
    if ([...inv.hotbar,...inv.main].length>=36) {
      if (mergeInventory) {
        await mergeInventory();
        inv = await call('player.getInventory');
      }
      if ([...inv.hotbar,...inv.main].length>=36) {
        stop('inventory_full', { message: '背包已满(36/36)；请先调 organize_inventory 合并零碎堆叠，或用 drop_items(slot, wholeStack: true) 整组丢弃多余圆石/杂石腾出空槽。' });
      }
    }
    if (requirePickaxe) {
      const held=inv.hotbar.find(i=>i.slot===inv.selectedSlot);
      const lowHeld = held?.maxDamage && held.maxDamage-(held.damage??0)<=3;
      if (lowHeld) {
        const stacks=[...inv.hotbar,...inv.main];
        let replacement=null;
        for (const id of PICKAXE_RANK) {
          replacement=stacks.find(s=>s.id===id && (!s.maxDamage || s.maxDamage-(s.damage??0)>3));
          if (replacement) break;
        }
        if (replacement && equip) {
          await equip(replacement.slot);
        } else if (/diamond|netherite/.test(held.id || '')) {
          stop('tool_nearly_broken', { message: '贵重镐剩余耐久不足 3，已保护性停止；请更换备用镐或合成新镐。' });
        }
      }
    }
    return blocks;
  };
  try {
    await call('fish.cancel'); await call('screen.close');
    initial=lastSelf=await call('player.getState');
    if(discover)discoveryStart=(await discover()).sequence;
    if (!initial.onGround || Math.abs(initial.y-Math.round(initial.y))>.15) stop('need_stable_full_block_ground');
    const origin={x:Math.floor(initial.x),y:Math.round(initial.y),z:Math.floor(initial.z)};
    for (let step=1;step<=length;step++) {
      const feet={x:origin.x+vector[0]*step,y:origin.y+(slope==='up'?step:slope==='down'?-step:0),z:origin.z+vector[1]*step};
      floor={...feet,y:feet.y-1};
      // Descending needs one extra head block to clear the approach from the higher step.
      const top=feet.y+(slope==='down'?2:1);
      cut=Array.from({length:top-feet.y+1},(_,i)=>({...feet,y:top-i}));
      // Clear the takeoff column before jumping; a two-high corridor otherwise blocks ascent.
      if(slope==='up')cut.unshift({x:feet.x-vector[0],y:feet.y+1,z:feet.z-vector[1]});
      stepPositions=[];
      for(let x=feet.x-1;x<=feet.x+1;x++)for(let z=feet.z-1;z<=feet.z+1;z++)for(let y=feet.y-1;y<=top+1;y++)stepPositions.push({x,y,z});
      const initialProbe = await guard({ allowEmptyFloor: Boolean(placeFloor), requirePickaxe: false });
      const initialSupport = initialProbe.find(b=>same(b,floor));
      let needsFloorPlacement = Boolean((!initialSupport?.fullSupport || initialSupport.falling) && initialSupport?.air && placeFloor);
      if (needsFloorPlacement && slope !== 'down') {
        try {
          await placeFloor(floor);
          result.placedFloors = (result.placedFloors || 0) + 1;
          needsFloorPlacement = false;
        } catch (placeErr) {
          signal?.throwIfAborted();
          stop('unsupported_floor', { missingFloor: floor, message: `前方落脚格(${floor.x},${floor.y},${floor.z})为空且自动垫块失败：${placeErr.message}` });
        }
      }
      for (const pos of cut) {
        const blocks=await guard({ allowEmptyFloor: needsFloorPlacement, requirePickaxe: false }), block=blocks.find(b=>same(b,pos));
        if (!block.air) {
          await guard({ allowEmptyFloor: needsFloorPlacement, requirePickaxe: true });
          const broke=await mineBlock(call,pos,{signal,check:() => guard({ allowEmptyFloor: needsFloorPlacement, requirePickaxe: true }),sleep});
          result.brokenBlocks++;
          if (/_ore$|ancient_debris$/.test(broke.broke)) result.encountered.push({id:broke.broke,position:pos});
          await call('fish.cancel');
          await checkDiscovery();
        }
      }
      if (needsFloorPlacement) {
        try {
          await placeFloor(floor);
          result.placedFloors = (result.placedFloors || 0) + 1;
          needsFloorPlacement = false;
        } catch (placeErr) {
          signal?.throwIfAborted();
          stop('unsupported_floor', { missingFloor: floor, message: `前方落脚格(${floor.x},${floor.y},${floor.z})为空且自动垫块失败：${placeErr.message}` });
        }
      }
      const beforeWalk=await guard({ requirePickaxe: false });
      if(cut.some(pos=>!beforeWalk.find(b=>same(b,pos))?.air)) stop('passage_not_clear');
      const moveUntil=Math.min(deadline,now()+6000);
      const stallLimit=slope==='up'?2500:1800;
      let closest=Infinity, movedAt=now(), lastGuardAt=now(), retriedStepBack=false;
      try {
        while (true) {
          if (now()-lastGuardAt>=350) {
            await guard({ requirePickaxe: false });
            lastGuardAt=now();
          } else {
            signal?.throwIfAborted();
            if (now()>=deadline) stop('time_budget');
            const self=await call('player.getState'); lastSelf=self;
            if (self.gameMode!=='survival' || self.dimension!==initial.dimension) stop('player_state_changed');
            if (self.health<initial.health-.1 || self.health<=10 || (self.air??300)<100 || self.inWater) stop('player_danger');
          }
          const distance=Math.hypot(lastSelf.x-feet.x-.5,lastSelf.z-feet.z-.5);
          const dy=feet.y-lastSelf.y;
          if(distance<=.25 && Math.abs(dy)<.2) break;
          if(now()>=moveUntil || now()-movedAt>stallLimit) stop('movement_stalled');
          const progressDist=Math.hypot(distance, dy);
          if(progressDist<closest-.03){closest=progressDist;movedAt=now();}
          if(Math.abs(dy)>1.35) stop('unexpected_height_change');
          await call('control.lookAt',{x:feet.x+.5,y:lastSelf.y+1.62,z:feet.z+.5});
          if(slope==='up' && !retriedStepBack && dy>0.4 && lastSelf.onGround && now()-movedAt>700){
            retriedStepBack=true;
            await call('control.setInput',{forward:false,back:true,left:false,right:false,jump:false,sneak:false,sprint:false});
            await sleep(120);
          }
          const needJump=slope==='up' && dy>0.08;
          await call('control.setInput',{forward:distance>.18 || needJump,back:false,left:false,right:false,jump:needJump,sneak:false,sprint:false});
          await sleep(slope==='up'?120:60);
        }
      } finally {
        await call('control.stop').catch(()=>{});
      }
      await call('fish.cancel');
      result.completedSteps++;
      await checkDiscovery();
    }
    result.status='completed'; result.reason='requested_length_reached';
  } catch(error) {
    signal?.throwIfAborted();
    if (!(error instanceof TunnelStop)) {
      result.reason='action_failed'; result.message=String(error.message).slice(0,500);
    } else {
      result.reason=error.reason;
      if (error.extra) Object.assign(result, error.extra);
    }
  }
  result.position=lastSelf&&{x:lastSelf.x,y:lastSelf.y,z:lastSelf.z};
  result.elapsedMs=now()-started;
  return result;
}

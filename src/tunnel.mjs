import { setTimeout as delay } from 'node:timers/promises';
import { mineBlock } from './mining.mjs';

const DIRECTIONS = {north:[0,-1], south:[0,1], west:[-1,0], east:[1,0]};
const HAZARD = /(?:^|:)(?:lava|water|fire|soul_fire|magma_block|campfire|soul_campfire|cactus|powder_snow|sweet_berry_bush)$/;
class TunnelStop extends Error { constructor(reason) { super(reason); this.reason=reason; } }
const stop = reason => { throw new TunnelStop(reason); };
const same = (a,b) => a.x===b.x && a.y===b.y && a.z===b.z;

// A finite mechanical action. Direction, depth and whether to continue belong to the model.
export async function digTunnel(args, {call, signal, sleep = ms => delay(ms, undefined, {signal}), now = Date.now} = {}) {
  const vector = DIRECTIONS[args.direction], length=args.length, slope=args.slope??'level';
  if (!vector || !Number.isInteger(length) || length<1 || length>12 || !['level','down'].includes(slope)) throw new Error('矿道方向限north/south/east/west，长度1–12格，坡度level/down');
  const started=now(), deadline=started+90000;
  const result={status:'interrupted', direction:args.direction, slope, requestedSteps:length, completedSteps:0, brokenBlocks:0, encountered:[]};
  let initial, stepPositions, floor, cut, lastSelf;
  const guard = async () => {
    signal?.throwIfAborted();
    if (now()>=deadline) stop('time_budget');
    const self=await call('player.getState'); lastSelf=self;
    if (self.gameMode!=='survival' || self.dimension!==initial.dimension) stop('player_state_changed');
    if (self.health<initial.health-.1 || self.health<=10 || (self.air??300)<100 || self.inWater) stop('player_danger');
    const nearby=await call('perception.entities', {radius:6, kinds:['hostile']});
    if (nearby.entities.some(e=>e.distance<6)) stop('hostile_nearby');
    const blocks=(await call('fish.probeBlocks', {positions:stepPositions})).blocks;
    if (blocks.length!==stepPositions.length || blocks.some(b=>!b.loaded)) stop('unloaded_area');
    if (blocks.some(b=>b.fluid || HAZARD.test(b.id))) stop('fluid_or_hazard');
    const support=blocks.find(b=>same(b,floor));
    if (!support?.fullSupport || support.falling) stop('unsupported_floor');
    const above=blocks.find(b=>b.x===floor.x && b.z===floor.z && b.y===cut[0].y+1);
    if (above?.falling) stop('falling_ceiling');
    for (const pos of cut) {
      const block=blocks.find(b=>same(b,pos));
      if (block.falling || block.blockEntity || block.hardness<0) stop('unsafe_or_protected_block');
    }
    const inv=await call('player.getInventory');
    if ([...inv.hotbar,...inv.main].length>=36) stop('inventory_full');
    const held=inv.hotbar.find(i=>i.slot===inv.selectedSlot);
    if (held?.maxDamage && held.maxDamage-(held.damage??0)<=3) stop('tool_nearly_broken');
    return blocks;
  };
  try {
    await call('fish.cancel'); await call('screen.close');
    initial=lastSelf=await call('player.getState');
    if (!initial.onGround || Math.abs(initial.y-Math.round(initial.y))>.15) stop('need_stable_full_block_ground');
    const origin={x:Math.floor(initial.x),y:Math.round(initial.y),z:Math.floor(initial.z)};
    for (let step=1;step<=length;step++) {
      const feet={x:origin.x+vector[0]*step,y:origin.y-(slope==='down'?step:0),z:origin.z+vector[1]*step};
      floor={...feet,y:feet.y-1};
      // Descending needs one extra head block to clear the approach from the higher step.
      const top=feet.y+(slope==='down'?2:1);
      cut=Array.from({length:top-feet.y+1},(_,i)=>({...feet,y:top-i}));
      stepPositions=[];
      for(let x=feet.x-1;x<=feet.x+1;x++)for(let z=feet.z-1;z<=feet.z+1;z++)for(let y=feet.y-1;y<=top+1;y++)stepPositions.push({x,y,z});
      for (const pos of cut) {
        const blocks=await guard(), block=blocks.find(b=>same(b,pos));
        if (!block.air) {
          const broke=await mineBlock(call,pos,{signal,check:guard,sleep});
          result.brokenBlocks++;
          if (/_ore$|ancient_debris$/.test(broke.broke)) result.encountered.push({id:broke.broke,position:pos});
          await call('fish.cancel');
        }
      }
      const beforeWalk=await guard();
      if(cut.some(pos=>!beforeWalk.find(b=>same(b,pos))?.air)) stop('passage_not_clear');
      const moveUntil=Math.min(deadline,now()+5000);
      let closest=Infinity, movedAt=now();
      while (true) {
        await guard();
        const distance=Math.hypot(lastSelf.x-feet.x-.5,lastSelf.z-feet.z-.5);
        if(distance<=.2 && Math.abs(lastSelf.y-feet.y)<.2) break;
        if(now()>=moveUntil || now()-movedAt>1500) stop('movement_stalled');
        if(distance<closest-.03){closest=distance;movedAt=now();}
        if(Math.abs(lastSelf.y-feet.y)>1.2) stop('unexpected_height_change');
        await call('control.lookAt',{x:feet.x+.5,y:lastSelf.y+1.62,z:feet.z+.5});
        await call('control.setInput',{forward:distance>.2,back:false,left:false,right:false,jump:false,sneak:false,sprint:false});
        await sleep(50);
        await call('control.stop');
      }
      await call('fish.cancel');
      result.completedSteps++;
    }
    result.status='completed'; result.reason='requested_length_reached';
  } catch(error) {
    signal?.throwIfAborted();
    if (!(error instanceof TunnelStop)) {
      result.reason='action_failed'; result.message=String(error.message).slice(0,500);
    } else result.reason=error.reason;
  }
  result.position=lastSelf&&{x:lastSelf.x,y:lastSelf.y,z:lastSelf.z};
  result.elapsedMs=now()-started;
  return result;
}

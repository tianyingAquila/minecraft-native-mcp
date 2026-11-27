import {setTimeout as delay} from 'node:timers/promises';
import {pillar} from './end-build.mjs';
import {mineBlock} from './mining.mjs';

const obsidian = 'minecraft:obsidian';
const portal = 'minecraft:nether_portal';
const frameFillers = ['minecraft:cobblestone','minecraft:cobbled_deepslate','minecraft:stone','minecraft:andesite','minecraft:dirt','minecraft:granite','minecraft:diorite','minecraft:netherrack'];
const stacks = inventory => [...inventory.hotbar,...inventory.main];
const posKey = p => `${p.x},${p.y},${p.z}`;
const isSoftPlant = b => Boolean(b?.loaded && !b.air && !b.fluid && b.collision === false);
const isOpenOrSoft = b => Boolean(b?.loaded && !b.fluid && (b.air || b.collision === false));

function evaluatePortalSpot(x, y, z, axis, side, getBlock) {
  const point = (column, height) => ({x: x + (axis === 'x' ? column : 0), y: y + height, z: z + (axis === 'z' ? column : 0)});
  const frame = [];
  const interior = [];
  for (let height = 0; height <= 4; height++) for (let column = 0; column <= 3; column++) {
    const pos = point(column, height);
    const edge = column === 0 || column === 3;
    if (edge || height === 0 || height === 4) frame.push({pos, corner: edge && (height === 0 || height === 4), height});
    else interior.push(pos);
  }
  const floor = [0, 1, 2, 3].map(c => getBlock(point(c, -1)));
  if (floor.some(b => !b?.loaded || !b.fullSupport || b.fluid || b.falling)) {
    return {ok: false, reason: '门框下方需连续四格稳固地面。'};
  }
  const frameBlocks = frame.map(cell => getBlock(cell.pos));
  const interiorBlocks = interior.map(pos => getBlock(pos));
  if (interiorBlocks.every(b => b?.id === portal)) {
    return {ok: true, alreadyLit: true, x, y, z, axis, side, point, frame, interior, pending: [], softToClear: [], work: null};
  }
  if (interiorBlocks.some(b => !isOpenOrSoft(b))) {
    return {ok: false, reason: '门框内部需要两格宽、三格高的空地。'};
  }
  const pending = [];
  for (let i = 0; i < frame.length; i++) {
    const cell = frame[i];
    const b = frameBlocks[i];
    if (b?.id === obsidian || (cell.corner && b?.fullSupport && !b.fluid && !b.falling)) continue;
    if (!isOpenOrSoft(b)) return {ok: false, reason: '门框目标有不匹配方块，请先清理或另选位置。'};
    pending.push(cell);
  }
  const needsLift = pending.some(cell => cell.height >= 2);
  const work = {...point(1, 0)};
  if (axis === 'x') work.z += side * 2;
  else work.x += side * 2;
  const workCells = [-1, 0, 1, 2, 3, 4].map(dy => getBlock({...work, y: y + dy}));
  if (!workCells[0]?.fullSupport || workCells[0].fluid || workCells[0].falling || workCells.slice(1, needsLift ? 6 : 3).some(b => !isOpenOrSoft(b))) {
    return {ok: false, reason: '门框侧面两格处需要可站立的平地和脚手空间。'};
  }
  const softToClear = [
    ...frameBlocks.filter(isSoftPlant),
    ...interiorBlocks.filter(isSoftPlant),
    ...workCells.slice(1, needsLift ? 6 : 3).filter(isSoftPlant),
  ];
  return {ok: true, alreadyLit: false, x, y, z, axis, side, point, frame, interior, pending, softToClear, work, needsLift};
}

export async function buildNetherPortal(args, {call, place, mine = mineBlock, signal}) {
  if (![args.x,args.y,args.z].every(Number.isFinite) || !['x','z'].includes(args.axis)) throw Error('需要门框左下角坐标和水平轴 x 或 z。');
  const reqX = Math.floor(args.x), reqY = Math.floor(args.y), reqZ = Math.floor(args.z);
  const probe = async positions => {
    const out = [];
    for (let i = 0; i < positions.length; i += 64) {
      const res = await call('fish.probeBlocks', {positions: positions.slice(i, i + 64)});
      out.push(...(res.blocks || []));
    }
    return out;
  };
  const state = await call('player.getState');
  if (!state.onGround || state.inLava || state.health<=10 || !['minecraft:overworld','minecraft:the_nether'].includes(state.dimension)) throw Error('先在主世界或地狱的稳定地面站稳。');

  const cache = new Map();
  const loadPositions = async positions => {
    const missing = [];
    const seen = new Set();
    for (const p of positions) {
      const k = posKey(p);
      if (!cache.has(k) && !seen.has(k)) { seen.add(k); missing.push(p); }
    }
    if (missing.length) {
      for (const b of await probe(missing)) cache.set(posKey(b), b);
    }
  };
  const getBlock = p => cache.get(posKey(p));

  const tryExact = async (cx, cy, cz, caxis) => {
    const prefSide = caxis === 'x' ? (state.z < cz + .5 ? -1 : 1) : (state.x < cx + .5 ? -1 : 1);
    const needed = [];
    for (let h = -1; h <= 4; h++) {
      for (let c = 0; c <= 3; c++) needed.push({x: cx + (caxis === 'x' ? c : 0), y: cy + h, z: cz + (caxis === 'z' ? c : 0)});
      for (const s of [prefSide, -prefSide]) {
        const wx = cx + (caxis === 'x' ? 1 : s * 2);
        const wz = cz + (caxis === 'z' ? 1 : s * 2);
        needed.push({x: wx, y: cy + h, z: wz});
      }
    }
    await loadPositions(needed);
    let firstErr = null;
    for (const s of [prefSide, -prefSide]) {
      const ev = evaluatePortalSpot(cx, cy, cz, caxis, s, getBlock);
      if (ev.ok) return ev;
      if (!firstErr) firstErr = ev;
    }
    return firstErr;
  };

  let chosen = await tryExact(reqX, reqY, reqZ, args.axis);
  if (!chosen?.ok) {
    // Auto-search nearby clean 4x5 spot within +-5 blocks horizontally, +-1..2 vertically
    const box = [];
    for (let dx = -5; dx <= 8; dx++) {
      for (let dz = -5; dz <= 8; dz++) {
        for (let dy = -2; dy <= 6; dy++) {
          box.push({x: reqX + dx, y: reqY + dy, z: reqZ + dz});
        }
      }
    }
    await loadPositions(box);
    const axes = args.axis === 'x' ? ['x', 'z'] : ['z', 'x'];
    const candidates = [];
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dy = -1; dy <= 2; dy++) {
          const cx = reqX + dx, cy = reqY + dy, cz = reqZ + dz;
          const dist = Math.hypot(cx - reqX, (cy - reqY) * 1.5, cz - reqZ);
          for (const caxis of axes) candidates.push({cx, cy, cz, caxis, dist});
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    for (const {cx, cy, cz, caxis} of candidates) {
      const prefSide = caxis === 'x' ? (state.z < cz + .5 ? -1 : 1) : (state.x < cx + .5 ? -1 : 1);
      for (const s of [prefSide, -prefSide]) {
        const ev = evaluatePortalSpot(cx, cy, cz, caxis, s, getBlock);
        if (ev.ok) { chosen = ev; break; }
      }
      if (chosen?.ok) break;
    }
  }
  if (!chosen?.ok) throw Error(chosen?.reason || '附近未找到连续四格稳固地面与宽4高5的建门空间。');

  const {x, y, z, axis, point, interior, pending, softToClear, work, needsLift} = chosen;
  if (chosen.alreadyLit) return {status:'succeeded',placed:0,entry:point(1,1),origin:{x,y,z,axis},alreadyLit:true};

  const inventory = stacks(await call('player.getInventory'));
  const count = item => inventory.filter(stack=>stack.id===item).reduce((total,stack)=>total+stack.count,0);
  const corners = pending.filter(cell=>cell.corner).length;
  const filler = frameFillers.find(item=>count(item)>=corners+(needsLift?3:0));
  if (count(obsidian)<pending.length-corners || ((corners||needsLift)&&!filler) || !count('minecraft:flint_and_steel')) throw Error('材料不足，需要剩余门框的普通黑曜石、转角和三格脚手用方块、打火石。');

  let placed = 0;
  let lifted = false;
  const equip = async item => {
    const stack = stacks(await call('player.getInventory')).find(entry=>entry.id===item);
    if (!stack) throw Error(`物品已用完：${item}`);
    await call('fish.equip',{slot:stack.slot,hotbarSlot:7});
  };
  try {
    await call('fish.navigate',{x:work.x+.5,y,z:work.z+.5,reach:.3});
    const approachUntil=Date.now()+12000;
    while (true) {
      const current=await call('player.getState');
      if(current.onGround&&Math.hypot(current.x-work.x-.5,current.y-y,current.z-work.z-.5)<.45) break;
      if(Date.now()>=approachUntil) return {status:'interrupted',reason:'work_position_not_reached',placed,origin:{x,y,z,axis}};
      await delay(150,undefined,{signal});
    }
    await call('fish.cancel');
    // Clear any short_grass / flowers / snow inside frame, interior, or work column
    for (const soft of softToClear) {
      try { await mine(call, {x: soft.x, y: soft.y, z: soft.z}, {signal}); } catch {}
    }
    const tryClearPlaceBlocker = async err => {
      const msg = String(err?.message || '');
      const m = msg.match(/first hit\s+([a-z0-9_:]+)\s*@\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/i);
      if (!m) return false;
      if (/obsidian|nether_portal|lava|water|bedrock|spawner|chest|furnace/i.test(m[1])) return false;
      const blocker = {x: Number(m[2]), y: Number(m[3]), z: Number(m[4])};
      const cur = await call('player.getState');
      if (blocker.x === Math.floor(cur.x) && blocker.z === Math.floor(cur.z) && blocker.y < Math.floor(cur.y)) return false;
      try {
        await mine(call, blocker, {signal});
        return true;
      } catch {
        return false;
      }
    };
    // Upper corners support the two top obsidian blocks.
    pending.sort((a,b)=>a.height-b.height || Number(b.corner)-Number(a.corner));
    for (const cell of pending) {
      signal?.throwIfAborted();
      const current = await call('player.getState');
      if (current.health<=10||current.health<state.health-2||current.inLava||current.dimension!==state.dimension) {
        return {status:'interrupted',reason:'player_danger',placed,origin:{x,y,z,axis}};
      }
      if(cell.height>=2&&!lifted){
        const lift=await pillar({direction:'up',height:3},{call,signal});
        if(lift.advanced!==3) return {status:'interrupted',reason:'scaffold_not_completed',placed,scaffold:lift,origin:{x,y,z,axis}};
        lifted=true;
      }
      const material = cell.corner?filler:obsidian;
      let receipt = null;
      let placeErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        await equip(material);
        try {
          receipt = await place(cell.pos);
          placeErr = null;
          break;
        } catch (err) {
          signal?.throwIfAborted();
          placeErr = err;
          if (attempt < 2 && await tryClearPlaceBlocker(err)) continue;
          break;
        }
      }
      if (placeErr) throw placeErr;
      if (receipt.block!==material) throw Error('放置后的方块与门框材料不符。');
      placed++;
    }
    if(lifted){
      const down=await pillar({direction:'down',height:3},{call,signal});
      if(down.advanced!==3) return {status:'interrupted',reason:'scaffold_descent_failed',placed,scaffold:down,origin:{x,y,z,axis}};
      lifted=false;
    }
    await equip('minecraft:flint_and_steel');
    let error;
    for (const column of [1,2]) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await call('fish.useBlock',{...point(column,0),face:'up'}); error=null; break; }
        catch (e) {
          signal?.throwIfAborted();
          error=e;
          if (attempt === 0 && await tryClearPlaceBlocker(e)) { await equip('minecraft:flint_and_steel'); continue; }
          break;
        }
      }
      if (!error) break;
    }
    if (error) throw error;
    for (let attempt=0;attempt<8;attempt++) {
      if ((await probe(interior)).every(block=>block.id===portal)) return {status:'succeeded',placed,entry:point(1,1),origin:{x,y,z,axis}};
      await delay(150,undefined,{signal});
    }
    return {status:'interrupted',reason:'portal_not_lit',placed,origin:{x,y,z,axis}};
  } catch(error) {
    signal?.throwIfAborted();
    return {status:'interrupted',reason:'frame_action_failed',placed,scaffoldStillUp:lifted,origin:{x,y,z,axis},message:error.message};
  } finally {await call('fish.cancel').catch(()=>{});}
}

export async function crossPortal({x,y,z}, {call,signal}) {
  if (![x,y,z].every(Number.isFinite)) throw Error('需要已观察到的传送门方块坐标。');
  const pos = {x:Math.floor(x),y:Math.floor(y),z:Math.floor(z)};
  const initial = await call('player.getState');
  const blocks = await call('fish.probeBlocks',{positions:[pos]});
  const portalId=blocks.blocks[0]?.id;
  if (![portal,'minecraft:end_portal'].includes(portalId)) throw Error('目标格不是已激活的传送门。');
  await call('screen.close');
  if(portalId==='minecraft:end_portal'&&initial.dimension==='minecraft:overworld') return jumpIntoEndPortal(pos,initial,{call,signal});
  await call('fish.navigate',{x:pos.x+.5,y:pos.y,z:pos.z+.5,reach:.45});
  const until = Date.now()+22000;
  try {
    while (Date.now()<until) {
      const state = await call('player.getState');
      if (state.health<=8 || state.inLava) return {status:'interrupted',reason:'player_danger'};
      if (state.dimension!==initial.dimension) return {status:'succeeded',from:initial.dimension,to:state.dimension,arrival:{x:state.x,y:state.y,z:state.z}};
      await delay(250,undefined,{signal});
    }
    return {status:'interrupted',reason:'dimension_unchanged',message:'核对是否真的走进门内，或刚穿门尚有冷却。'};
  } finally { await call('fish.cancel').catch(()=>{}); }
}

const endFrame = 'minecraft:end_portal_frame';
const normals = {east:[1,0],west:[-1,0],south:[0,1],north:[0,-1]};

async function jumpIntoEndPortal(pos,initial,{call,signal}) {
  const probe = async positions => (await call('fish.probeBlocks',{positions})).blocks;
  const offsets=[-2,-1,0,1,2];
  const surface=(await probe(offsets.flatMap(dx=>offsets.map(dz=>({x:pos.x+dx,y:pos.y,z:pos.z+dz}))))).filter(block=>block.id==='minecraft:end_portal');
  if(surface.length!==9) return {status:'interrupted',reason:'end_portal_surface_not_confirmed'};
  const center={x:Math.min(...surface.map(block=>block.x))+1.5,y:pos.y,z:Math.min(...surface.map(block=>block.z))+1.5};
  const candidates=Object.values(normals).map(([dx,dz])=>({stand:{x:Math.floor(center.x)+3*dx,y:pos.y,z:Math.floor(center.z)+3*dz},edge:{x:Math.floor(center.x)+2*dx,y:pos.y,z:Math.floor(center.z)+2*dz}}));
  const surroundings=await probe(candidates.flatMap(({stand,edge})=>[{...stand,y:pos.y-1},stand,{...stand,y:pos.y+1},edge,{...edge,y:pos.y+1},{...edge,y:pos.y+2}]));
  const safe = candidates.flatMap(({stand},index)=>{
    const [floor,feet,head,edge,over,above]=surroundings.slice(index*6,index*6+6);
    if(!floor?.fullSupport||floor.fluid||floor.falling||edge?.id!==endFrame||![feet,head,over,above].every(block=>block?.loaded&&!block.collision&&!block.fluid)) return [];
    return [{x:stand.x+.5,y:stand.y,z:stand.z+.5}];
  }).sort((a,b)=>Math.hypot(a.x-initial.x,a.z-initial.z)-Math.hypot(b.x-initial.x,b.z-initial.z))[0];
  if(!safe)return {status:'interrupted',reason:'no_safe_jump_approach'};
  const receipt=state=>({status:'succeeded',from:initial.dimension,to:state.dimension,arrival:{x:state.x,y:state.y,z:state.z}});
  try {
    await call('fish.navigate',{...safe,reach:.4});
    const nearUntil=Date.now()+7000;
    while(true) {
      const state=await call('player.getState');
      if(state.dimension!==initial.dimension)return receipt(state);
      if(state.health<=8||state.inLava)return {status:'interrupted',reason:'player_danger'};
      if(state.onGround&&Math.hypot(state.x-safe.x,state.y-safe.y,state.z-safe.z)<.55)break;
      if(Date.now()>=nearUntil)return {status:'interrupted',reason:'jump_position_unreachable'};
      await delay(120,undefined,{signal});
    }
    await call('fish.cancel');
    const start=await call('player.getState');
    await call('control.lookAt',{x:center.x,y:start.y+1.62,z:center.z});
    await call('control.setInput',{forward:true,jump:true,sprint:false,sneak:false});
    const jumpUntil=Date.now()+2400;
    while(Date.now()<jumpUntil) {
      const state=await call('player.getState');
      if(state.dimension!==initial.dimension)return receipt(state);
      if(state.health<=8||state.inLava)return {status:'interrupted',reason:'player_danger'};
      if(Math.abs(state.x-center.x)<.95&&Math.abs(state.z-center.z)<.95)break;
      await delay(60,undefined,{signal});
    }
    await call('control.stop');
    const transferUntil=Date.now()+4500;
    while(Date.now()<transferUntil) {
      const state=await call('player.getState');
      if(state.dimension!==initial.dimension)return receipt(state);
      await delay(150,undefined,{signal});
    }
    return {status:'interrupted',reason:'end_portal_dimension_unchanged'};
  } finally {await call('fish.cancel').catch(()=>{});}
}

export async function activateEndPortal({x,y,z}, {call,signal}) {
  if (![x,y,z].every(Number.isFinite)) throw Error('需要实际门框或门框中心的坐标。');
  const anchor = {x:Math.floor(x),y:Math.floor(y),z:Math.floor(z)};
  const probe = async positions => (await call('fish.probeBlocks',{positions})).blocks;
  const [sample] = await probe([anchor]);
  const normal = sample.id===endFrame?normals[sample.facing]:null;
  const centers = normal?[-1,0,1].map(offset=>({x:anchor.x+2*normal[0]+offset*normal[1],y:anchor.y,z:anchor.z+2*normal[1]-offset*normal[0]})):[anchor];
  let ring, center;
  for (const point of centers) {
    const candidates = [-1,0,1].flatMap(offset=>[
      {x:point.x+offset,y:point.y,z:point.z-2,facing:'south'},
      {x:point.x+offset,y:point.y,z:point.z+2,facing:'north'},
      {x:point.x-2,y:point.y,z:point.z+offset,facing:'east'},
      {x:point.x+2,y:point.y,z:point.z+offset,facing:'west'},
    ]);
    const state = await probe(candidates);
    if(state.every((block,index)=>block.id===endFrame&&block.facing===candidates[index].facing)) {ring=state;center=point;break;}
  }
  if (!ring) throw Error('附近没有确认到完整、朝内的12格末地门框。');
  const missing = ring.filter(frame=>!frame.hasEye);
  const eye = 'minecraft:ender_eye';
  if(stacks(await call('player.getInventory')).filter(stack=>stack.id===eye).reduce((total,stack)=>total+stack.count,0)<missing.length) throw Error(`门框仍缺${missing.length}颗末影之眼。`);
  let inserted = 0;
  try {
    await call('screen.close');
    for (const frame of missing) {
      const self=await call('player.getState');
      if(self.dimension!=='minecraft:overworld'||self.health<=10||self.inLava) return {status:'interrupted',reason:'player_danger',inserted};
      const [dx,dz]=normals[frame.facing];
      const spots=[1,2].flatMap(distance=>[0,1,-1].map(side=>({x:frame.x-dx*distance+dz*side,y:frame.y,z:frame.z-dz*distance-dx*side})));
      const cells=await probe(spots.flatMap(point=>[-1,0,1].map(dy=>({...point,y:point.y+dy}))));
      const stand=spots.find((_,index)=>{
        const [floor,feet,head]=cells.slice(index*3,index*3+3);
        return floor?.fullSupport&&!floor.fluid&&!floor.falling&&[feet,head].every(cell=>cell?.loaded&&!cell.collision&&!cell.fluid&&!/fire|portal/.test(cell.id));
      });
      if(!stand)return {status:'interrupted',reason:'no_safe_frame_position',inserted,frame:{x:frame.x,y:frame.y,z:frame.z}};
      const at = {x:stand.x+.5,y:stand.y,z:stand.z+.5};
      const reached = state=>state.onGround&&Math.hypot(state.x-at.x,state.y-at.y,state.z-at.z)<.75;
      if(!reached(self)) {
        await call('fish.navigate',{...at,reach:.65});
        const until=Date.now()+6000;
        let arrived=false;
        while(Date.now()<until){
          const current=await call('player.getState');
          if(current.inLava||current.health<=10) return {status:'interrupted',reason:'player_danger',inserted};
          if(reached(current)){arrived=true;break;}
          await delay(120,undefined,{signal});
        }
        await call('fish.cancel');
        if(!arrived)return {status:'interrupted',reason:'frame_unreachable',inserted,frame:{x:frame.x,y:frame.y,z:frame.z}};
      }
      const stack=stacks(await call('player.getInventory')).find(item=>item.id===eye);
      if(!stack)return {status:'interrupted',reason:'eyes_exhausted',inserted};
      await call('fish.equip',{slot:stack.slot,hotbarSlot:7});
      const target={x:frame.x,y:frame.y,z:frame.z};
      // End frames are shorter than a full block. Let the native ray find
      // their actual shape instead of aiming at the full-block top surface.
      await call('fish.useBlock',target);
      let confirmed=false;
      for(let i=0;i<7;i++){
        if((await probe([target]))[0]?.hasEye){confirmed=true;break;}
        await delay(120,undefined,{signal});
      }
      if(!confirmed)return {status:'interrupted',reason:'eye_not_confirmed',inserted,frame:target};
      inserted++;
    }
    const cells=await probe([-1,0,1].flatMap(dx=>[-1,0,1].map(dz=>({x:center.x+dx,y:center.y,z:center.z+dz}))));
    return cells.every(block=>block.id==='minecraft:end_portal')
      ? {status:'succeeded',inserted,entry:center}
      : {status:'interrupted',reason:'end_portal_not_confirmed',inserted};
  } catch(error) {
    signal?.throwIfAborted();
    return {status:'interrupted',reason:'frame_action_failed',inserted,message:error.message};
  } finally {await call('fish.cancel').catch(()=>{});}
}

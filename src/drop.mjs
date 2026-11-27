import {setTimeout as delay} from 'node:timers/promises';
import {mineBlock} from './mining.mjs';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const HAZARD = /(?:^|:)(?:lava|water|fire|soul_fire|magma_block|bedrock|obsidian|spawner|chest|furnace|blast_furnace|smoker|crafting_table|brewing_stand|anvil|ender_chest|shulker_box)$/;
const stacks = inv => [...(inv.hotbar || []), ...(inv.main || [])];
const totalOf = (inv, id) => stacks(inv).filter(s => s.id === id).reduce((sum, s) => sum + s.count, 0);

function safeDiggable(block) {
  return Boolean(block?.loaded && !block.fluid && !block.blockEntity && !block.falling && (block.hardness ?? 0) >= 0 && !HAZARD.test(block.id || ''));
}

async function inspectDropEnvironment(call, px, py, pz) {
  // For each cardinal direction inspect:
  // dist=1: y-1 (pitBottom), y (pitTop), y+1 (wallEye)
  // dist=2: y-1, y, y+1
  // dist=3: y, y+1
  const positions = DIRS.flatMap(([dx, dz]) => [
    {x: px + dx, y: py - 1, z: pz + dz},
    {x: px + dx, y: py, z: pz + dz},
    {x: px + dx, y: py + 1, z: pz + dz},
    {x: px + dx * 2, y: py - 1, z: pz + dz * 2},
    {x: px + dx * 2, y: py, z: pz + dz * 2},
    {x: px + dx * 2, y: py + 1, z: pz + dz * 2},
    {x: px + dx * 3, y: py, z: pz + dz * 3},
    {x: px + dx * 3, y: py + 1, z: pz + dz * 3},
  ]);
  const blocks = (await call('fish.probeBlocks', {positions})).blocks || [];
  let existingPit = null;
  let openDir = null;
  let digCandidate = null;

  for (let i = 0; i < DIRS.length; i++) {
    const [dx, dz] = DIRS[i];
    const [d1b, d1m, d1t, d2b, d2m, d2t, d3m, d3t] = blocks.slice(i * 8, i * 8 + 8);
    // 1. Existing 2-block deep pit at dist=1 or dist=2 with clear throw line
    if (!existingPit && d1t?.loaded && d1t.air && d1m?.loaded && d1m.air && d1b?.loaded && d1b.air && !d1b.fluid) {
      existingPit = {dx, dz, dist: 1, x: px + dx, y: py - 1, z: pz + dz};
    } else if (!existingPit && d1t?.loaded && d1t.air && d2t?.loaded && d2t.air && d2m?.loaded && d2m.air && d2b?.loaded && d2b.air && !d2b.fluid) {
      existingPit = {dx, dz, dist: 2, x: px + dx * 2, y: py - 1, z: pz + dz * 2};
    }
    // 2. Open unobstructed throw corridor (3+ blocks of clear air ahead)
    if (!openDir && d1t?.air && d1m?.air && d2t?.air && d2m?.air && d3t?.air && d3m?.air) {
      openDir = {dx, dz};
    }
    // 3. Diggable side pit at dist=1 (wallEye + pitTop + pitBottom)
    if (!digCandidate && safeDiggable(d1t) && safeDiggable(d1m) && safeDiggable(d1b)) {
      const toDig = [d1t, d1m, d1b].filter(b => !b.air);
      digCandidate = {dx, dz, x: px + dx, y: py - 1, z: pz + dz, toDig};
    }
  }
  return {existingPit, openDir, digCandidate};
}

async function performAimedDrop(call, {slot, dropWhole, expected, aim}, sleep) {
  try {
    const res = await call('fish.dropAimed', {
      slot,
      wholeStack: dropWhole,
      count: expected,
      x: aim.x,
      y: aim.y,
      z: aim.z,
    });
    await sleep(160);
    return res;
  } catch (err) {
    // Fallback for older client jar without fish.dropAimed
    if (err.code !== 'GAME_unknown_method') throw err;
    await call('control.lookAt', aim);
    await sleep(80);
    if (dropWhole) {
      await call('inventory.dropSlot', {slot, wholeStack: true});
      await sleep(150);
    } else {
      for (let i = 0; i < expected; i++) {
        await call('inventory.dropSlot', {slot, wholeStack: false});
        await sleep(60);
      }
    }
    return {fallback: true};
  }
}

async function digSidePit(call, candidate, {mine, signal, sleep}) {
  // Dig top-to-bottom: wallEye (py+1) -> pitTop (py) -> pitBottom (py-1)
  for (const cell of candidate.toDig) {
    signal?.throwIfAborted();
    try {
      await mine(call, {x: cell.x, y: cell.y, z: cell.z}, {signal, sleep});
    } catch (err) {
      // Skip cells that already turned to air (e.g. grass/popped blocks when digging top-to-bottom).
      if (/没有已加载的可挖方块/.test(String(err?.message || ''))) continue;
      throw err;
    }
  }
}

async function stepBackFromPit(call, self, dx, dz, sleep) {
  // Briefly sneak backward away from the side pit so player sits on the opposite side of the block (dist >= 1.3 from pit center)
  try {
    await call('control.lookAt', {x: self.x + dx * 3, y: self.y + 1.2, z: self.z + dz * 3});
    await call('control.setInput', {back: true, sneak: true, forward: false, jump: false, sprint: false});
    await sleep(240);
  } finally {
    await call('control.stop').catch(() => {});
  }
}

export async function dropItemsSafe(
  args = {},
  {call, signal, mine = mineBlock, sleep = ms => delay(ms, undefined, {signal})} = {},
) {
  const whole = args.wholeStack === true;
  const reqCount = whole ? 64 : args.count;
  if (!Number.isInteger(args.slot) || args.slot < 0 || args.slot > 35 || (!whole && (!Number.isInteger(reqCount) || reqCount < 1 || reqCount > 64))) {
    throw Error('请指定背包格0–35，以及数量1–64或wholeStack:true');
  }
  const inv = await call('player.getInventory');
  const stack = stacks(inv).find(i => i.slot === args.slot);
  if (!stack) throw Error('该格没有物品，请先刷新背包');
  const dropWhole = whole || reqCount >= stack.count;
  const expected = dropWhole ? stack.count : reqCount;
  if (!dropWhole && stack.count < expected) throw Error('该格物品数量不足');
  const totalBefore = totalOf(inv, stack.id);

  await call('container.close').catch(() => {});
  await call('fish.cancel').catch(() => {});

  const self = await call('player.getState');
  const px = Math.floor(self.x), py = Math.floor(self.y), pz = Math.floor(self.z);
  const env = await inspectDropEnvironment(call, px, py, pz);

  let method = 'open_throw';
  let pitPosition = null;
  let aim;

  if (env.existingPit) {
    method = 'existing_pit';
    pitPosition = {x: env.existingPit.x, y: env.existingPit.y, z: env.existingPit.z};
    if (env.existingPit.dist === 1) await stepBackFromPit(call, self, env.existingPit.dx, env.existingPit.dz, sleep);
    aim = {
      x: env.existingPit.x + 0.5 + env.existingPit.dx * 0.2,
      y: py + 0.1,
      z: env.existingPit.z + 0.5 + env.existingPit.dz * 0.2,
    };
  } else if (env.openDir) {
    method = 'open_throw';
    aim = {
      x: self.x + env.openDir.dx * 4,
      y: self.y + 1.9,
      z: self.z + env.openDir.dz * 4,
    };
  } else if (env.digCandidate && !self.inWater && !self.inLava) {
    await digSidePit(call, env.digCandidate, {mine, signal, sleep});
    method = 'dug_pit';
    pitPosition = {x: env.digCandidate.x, y: env.digCandidate.y, z: env.digCandidate.z};
    await stepBackFromPit(call, self, env.digCandidate.dx, env.digCandidate.dz, sleep);
    aim = {
      x: env.digCandidate.x + 0.5 + env.digCandidate.dx * 0.2,
      y: py + 0.1,
      z: env.digCandidate.z + 0.5 + env.digCandidate.dz * 0.2,
    };
  } else {
    aim = {x: self.x + 3, y: self.y + 1.8, z: self.z};
  }

  // Re-locate target slot in case digging equipped a pickaxe onto hotbar
  let currentInv = await call('player.getInventory');
  let activeSlot = stacks(currentInv).find(i => i.slot === args.slot && i.id === stack.id)?.slot;
  if (activeSlot === undefined) {
    activeSlot = stacks(currentInv).find(i => i.id === stack.id && i.count >= expected)?.slot;
  }
  if (activeSlot === undefined) throw Error('丢弃前目标格物品已变化，请先刷新背包');

  await performAimedDrop(call, {slot: activeSlot, dropWhole, expected, aim}, sleep);
  await sleep(600);

  let settled = await call('player.getInventory');
  let totalAfter = totalOf(settled, stack.id);

  // If open_throw got sucked back in a tight corner, dig a side pit and retry once!
  if (totalAfter >= totalBefore && method === 'open_throw' && env.digCandidate && !self.inWater && !self.inLava) {
    await digSidePit(call, env.digCandidate, {mine, signal, sleep});
    method = 'dug_pit';
    pitPosition = {x: env.digCandidate.x, y: env.digCandidate.y, z: env.digCandidate.z};
    await stepBackFromPit(call, self, env.digCandidate.dx, env.digCandidate.dz, sleep);
    const retryInv = await call('player.getInventory');
    const retrySlot = stacks(retryInv).find(i => i.id === stack.id && i.count >= expected)?.slot;
    if (retrySlot !== undefined) {
      const pitAim = {
        x: env.digCandidate.x + 0.5 + env.digCandidate.dx * 0.2,
        y: py + 0.1,
        z: env.digCandidate.z + 0.5 + env.digCandidate.dz * 0.2,
      };
      await performAimedDrop(call, {slot: retrySlot, dropWhole, expected, aim: pitAim}, sleep);
      await sleep(600);
      settled = await call('player.getInventory');
      totalAfter = totalOf(settled, stack.id);
    }
  }

  const usedSlots = stacks(settled).length;
  const freeSlots = Math.max(0, 36 - usedSlots);
  const left = stacks(settled).find(i => i.slot === activeSlot)?.count || 0;
  const netDropped = Math.max(0, totalBefore - totalAfter);

  if (netDropped === 0) {
    return {
      dropped: 0,
      recollected: true,
      item: stack.id,
      method,
      ...(pitPosition ? {pitPosition} : {}),
      usedSlots,
      freeSlots,
      message: '物品丢出后仍被吸回背包；请先挪开两格远离地面散落物再丢弃。',
    };
  }
  return {
    dropped: netDropped,
    item: stack.id,
    method,
    ...(pitPosition ? {pitPosition} : {}),
    remainingInSlot: left,
    usedSlots,
    freeSlots,
    ...(freeSlots === 0 ? {hint: '背包仍满(36/36)，请传 wholeStack: true 清空杂石或调用 organize_inventory 合并零碎堆叠。'} : {}),
  };
}

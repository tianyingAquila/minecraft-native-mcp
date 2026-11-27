import {setTimeout as delay} from 'node:timers/promises';
import {mineBlock} from './mining.mjs';

const OBSIDIAN_ID = 'minecraft:obsidian';
const LAVA_ID = 'minecraft:lava';
const WATER_BUCKET = 'minecraft:water_bucket';
const EMPTY_BUCKET = 'minecraft:bucket';

const stacks = inv => [...(inv.hotbar || []), ...(inv.main || [])];
const countItem = (inv, id) => stacks(inv).filter(s => s.id === id).reduce((n, s) => n + s.count, 0);

export function findObsidianPickaxe(inv) {
  return stacks(inv)
    .filter(s => (s.id === 'minecraft:diamond_pickaxe' || s.id === 'minecraft:netherite_pickaxe') && (!s.maxDamage || s.maxDamage - (s.damage || 0) > 3))
    .sort((a, b) => (b.id.includes('netherite') ? 1 : 0) - (a.id.includes('netherite') ? 1 : 0))[0] || null;
}

async function scanCandidates(call, origin, radius) {
  const ox = Math.floor(origin.x);
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z);
  const r = Math.min(radius, 8);
  const coords = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r) continue;
        coords.push({x: ox + dx, y: oy + dy, z: oz + dz});
      }
    }
  }
  coords.sort((a, b) => Math.hypot(a.x - ox, a.y - oy, a.z - oz) - Math.hypot(b.x - ox, b.y - oy, b.z - oz));
  const obsidianBlocks = [];
  const lavaBlocks = [];
  for (let i = 0; i < coords.length; i += 64) {
    const batch = coords.slice(i, i + 64);
    const {blocks = []} = await call('fish.probeBlocks', {positions: batch});
    for (const block of blocks) {
      if (!block?.loaded) continue;
      if (block.id === OBSIDIAN_ID) obsidianBlocks.push(block);
      else if (block.id === LAVA_ID) lavaBlocks.push(block);
    }
    if (obsidianBlocks.length >= 6 && lavaBlocks.length >= 6) break;
  }
  return {obsidianBlocks, lavaBlocks};
}

async function approachPoint(call, target, reach, deadline, signal, sleep, now = Date.now) {
  const self = await call('player.getState');
  if (Math.hypot(self.x - (target.x + 0.5), self.y - target.y, self.z - (target.z + 0.5)) <= reach) return true;
  await call('fish.navigate', {x: target.x + 0.5, y: target.y + 1, z: target.z + 0.5, reach});
  const limit = Math.min(deadline, now() + 7000);
  try {
    while (now() < limit) {
      signal?.throwIfAborted();
      const s = await call('player.getState');
      if (s.health <= 10 || s.inLava) return false;
      if (Math.hypot(s.x - (target.x + 0.5), s.y - target.y, s.z - (target.z + 0.5)) <= reach + 0.4) return true;
      await sleep(160);
    }
    return false;
  } finally {
    await call('fish.cancel').catch(() => {});
  }
}

async function findWaterPlacementNextToLava(call, lavaPos) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const candidates = dirs.map(([dx, dz]) => ({x: lavaPos.x + dx, y: lavaPos.y, z: lavaPos.z + dz}));
  const probePos = candidates.flatMap(p => [p, {x: p.x, y: p.y + 1, z: p.z}]);
  const {blocks = []} = await call('fish.probeBlocks', {positions: probePos});
  for (let i = 0; i < candidates.length; i++) {
    const base = blocks[i * 2];
    const above = blocks[i * 2 + 1];
    if (base?.loaded && base.fullSupport && !base.fluid && above?.loaded && above.air) {
      return base;
    }
  }
  return null;
}

export async function makeObsidian(args = {}, {call, signal, mine = mineBlock, now = Date.now, sleep = ms => delay(ms, undefined, {signal})} = {}) {
  const count = args.count ?? 10;
  const radius = args.radius ?? 8;
  const seconds = args.seconds ?? 120;
  if (!Number.isInteger(count) || count < 1 || count > 20) throw Error('count 须为 1–20 的整数。');
  if (!Number.isInteger(radius) || radius < 3 || radius > 16) throw Error('radius 须为 3–16 格整数。');
  if (!Number.isInteger(seconds) || seconds < 20 || seconds > 240) throw Error('seconds 须为 20–240 秒整数。');

  await call('fish.cancel');
  await call('screen.close');

  const initial = await call('player.getState');
  if (initial.health <= 10 || initial.inLava) {
    throw Error('当前生命过低或处于岩浆中，请先脱险并恢复生命再采集黑曜石。');
  }
  const initInv = await call('player.getInventory');
  const pickaxe = findObsidianPickaxe(initInv);
  if (!pickaxe) {
    throw Error('开采黑曜石必须拥有可用的钻石镐或下界合金镐（铁镐无法掉落黑曜石）。请先在 Y=-58 到 -50 采集至少3颗钻石并合成 diamond_pickaxe。');
  }

  const startObsidian = countItem(initInv, OBSIDIAN_ID);
  const deadline = now() + seconds * 1000;
  const minedPositions = [];
  const skipped = new Set();
  let castCount = 0;
  let waterPlacedAt = null;
  const keyOf = p => `${p.x},${p.y},${p.z}`;

  const reclaimWater = async () => {
    if (!waterPlacedAt) return;
    try {
      const inv = await call('player.getInventory');
      const bucket = stacks(inv).find(s => s.id === EMPTY_BUCKET);
      if (bucket) {
        await call('fish.equip', {slot: bucket.slot, hotbarSlot: 7});
        await call('fish.useBlock', {x: waterPlacedAt.x, y: waterPlacedAt.y, z: waterPlacedAt.z, face: 'up'});
        await sleep(250);
      }
    } catch {}
    waterPlacedAt = null;
  };

  try {
    while (now() < deadline) {
      signal?.throwIfAborted();
      const state = await call('player.getState');
      const inv = await call('player.getInventory');
      const totalObsidian = countItem(inv, OBSIDIAN_ID);
      const gained = Math.max(0, totalObsidian - startObsidian);
      if (gained >= count) {
        await reclaimWater();
        return {status: 'succeeded', reason: 'target_reached', gained, totalObsidian, targetCount: count, castCount, minedPositions};
      }
      if (state.dimension !== initial.dimension || state.health <= 10 || state.inLava) {
        return {status: 'interrupted', reason: 'player_danger', gained, totalObsidian, targetCount: count, castCount, minedPositions};
      }
      const currentPick = findObsidianPickaxe(inv);
      if (!currentPick) {
        return {status: 'interrupted', reason: 'pickaxe_low_or_missing', gained, totalObsidian, targetCount: count, castCount, minedPositions, message: '钻石镐耐久已达保护线(<=3)或缺失。'};
      }

      const center = Number.isFinite(args.x) && Number.isFinite(args.y) && Number.isFinite(args.z)
        ? {x: args.x, y: args.y, z: args.z}
        : state;
      const {obsidianBlocks, lavaBlocks} = await scanCandidates(call, center, radius);
      let targetObs = obsidianBlocks.find(b => !skipped.has(keyOf(b)));

      if (!targetObs) {
        const candidateLava = lavaBlocks.find(b => !skipped.has(keyOf(b)));
        if (!candidateLava) {
          await reclaimWater();
          return {
            status: 'interrupted',
            reason: 'no_obsidian_or_lava_nearby',
            gained,
            totalObsidian,
            targetCount: count,
            castCount,
            minedPositions,
            message: '附近未找到可采集的黑曜石或暴露岩浆源；请先用 locate_resource(target="lava_lake") 前往岩浆湖。',
          };
        }
        if (state.dimension === 'minecraft:the_nether') {
          return {status: 'interrupted', reason: 'water_blocked_in_nether', gained, totalObsidian, targetCount: count, castCount, minedPositions, message: '下界无法放水浇灌岩浆，请直接寻找已有黑曜石或在主世界岩浆湖采集。'};
        }
        const waterBucket = stacks(inv).find(s => s.id === WATER_BUCKET);
        if (!waterBucket) {
          return {status: 'interrupted', reason: 'need_water_bucket', gained, totalObsidian, targetCount: count, castCount, minedPositions, message: '附近只有岩浆，需要水桶（water_bucket）倒水凝固成黑曜石。'};
        }
        const support = await findWaterPlacementNextToLava(call, candidateLava);
        if (!support) {
          skipped.add(keyOf(candidateLava));
          continue;
        }
        const near = await approachPoint(call, support, 3.5, deadline, signal, sleep, now);
        if (!near) {
          skipped.add(keyOf(candidateLava));
          continue;
        }
        await call('fish.equip', {slot: waterBucket.slot, hotbarSlot: 7});
        await call('fish.useBlock', {x: support.x, y: support.y, z: support.z, face: 'up'});
        waterPlacedAt = support;
        await sleep(500);
        await reclaimWater();
        const afterCast = (await call('fish.probeBlocks', {positions: [{x: candidateLava.x, y: candidateLava.y, z: candidateLava.z}]})).blocks?.[0];
        if (afterCast?.id === OBSIDIAN_ID) {
          castCount++;
          targetObs = afterCast;
        } else {
          skipped.add(keyOf(candidateLava));
          continue;
        }
      }

      // Check adjacent/below lava before mining so obsidian drop does not burn immediately.
      const hazards = (await call('fish.probeBlocks', {
        positions: [
          {x: targetObs.x, y: targetObs.y - 1, z: targetObs.z},
          {x: targetObs.x + 1, y: targetObs.y, z: targetObs.z},
          {x: targetObs.x - 1, y: targetObs.y, z: targetObs.z},
          {x: targetObs.x, y: targetObs.y, z: targetObs.z + 1},
          {x: targetObs.x, y: targetObs.y, z: targetObs.z - 1},
        ],
      })).blocks || [];
      const lavaAdjacent = hazards.some(b => b?.id === LAVA_ID);
      if (lavaAdjacent && state.dimension === 'minecraft:overworld') {
        const wb = stacks(await call('player.getInventory')).find(s => s.id === WATER_BUCKET);
        if (wb) {
          const support = await findWaterPlacementNextToLava(call, targetObs);
          if (support && await approachPoint(call, support, 3.5, deadline, signal, sleep, now)) {
            await call('fish.equip', {slot: wb.slot, hotbarSlot: 7});
            await call('fish.useBlock', {x: support.x, y: support.y, z: support.z, face: 'up'});
            waterPlacedAt = support;
            await sleep(300);
          }
        }
      }

      const reached = await approachPoint(call, targetObs, 3.2, deadline, signal, sleep, now);
      if (!reached) {
        skipped.add(keyOf(targetObs));
        continue;
      }
      await call('fish.equip', {slot: currentPick.slot, hotbarSlot: 7});
      const beforeCount = countItem(await call('player.getInventory'), OBSIDIAN_ID);
      try {
        await mine(call, targetObs, {
          signal,
          sleep,
          check: async () => {
            const s = await call('player.getState');
            if (s.health <= 10 || s.inLava) throw Error('player_danger');
          },
        });
        minedPositions.push({x: targetObs.x, y: targetObs.y, z: targetObs.z});
      } catch (err) {
        signal?.throwIfAborted();
        if (err.message === 'player_danger') {
          const invNow = await call('player.getInventory');
          const total = countItem(invNow, OBSIDIAN_ID);
          return {status: 'interrupted', reason: 'player_danger', gained: Math.max(0, total - startObsidian), totalObsidian: total, targetCount: count, castCount, minedPositions};
        }
        skipped.add(keyOf(targetObs));
        continue;
      }

      await sleep(500);
      const afterCount = countItem(await call('player.getInventory'), OBSIDIAN_ID);
      if (afterCount <= beforeCount && !lavaAdjacent) {
        // Walk onto the mined spot briefly if safe to pick up the drop.
        const floorCheck = (await call('fish.probeBlocks', {positions: [{x: targetObs.x, y: targetObs.y - 1, z: targetObs.z}]})).blocks?.[0];
        if (floorCheck?.loaded && floorCheck.fullSupport && !floorCheck.fluid) {
          await approachPoint(call, {x: targetObs.x, y: targetObs.y - 1, z: targetObs.z}, 0.8, Math.min(deadline, now() + 2500), signal, sleep, now);
          await sleep(300);
        }
      }
      await reclaimWater();
    }

    const finalInv = await call('player.getInventory');
    const totalObsidian = countItem(finalInv, OBSIDIAN_ID);
    const gained = Math.max(0, totalObsidian - startObsidian);
    return {
      status: gained >= count ? 'succeeded' : 'interrupted',
      reason: gained >= count ? 'target_reached' : 'time_budget',
      gained,
      totalObsidian,
      targetCount: count,
      castCount,
      minedPositions,
    };
  } finally {
    await reclaimWater();
    await call('fish.cancel').catch(() => {});
  }
}

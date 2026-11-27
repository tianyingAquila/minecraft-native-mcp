import {setTimeout as delay} from 'node:timers/promises';
import {fightEntity} from './combat.mjs';

const BLAZE_ROD = 'minecraft:blaze_rod';
const FIREPROOF_BLOCKS = [
  'minecraft:cobblestone',
  'minecraft:cobbled_deepslate',
  'minecraft:netherrack',
  'minecraft:nether_bricks',
  'minecraft:stone',
  'minecraft:blackstone',
  'minecraft:basalt',
  'minecraft:andesite',
  'minecraft:diorite',
  'minecraft:granite',
  'minecraft:dirt',
];

const stacks = inv => [...(inv.hotbar || []), ...(inv.main || [])];
const countItem = (inv, id) => stacks(inv).filter(s => s.id === id).reduce((n, s) => n + s.count, 0);
const pickBuildingBlock = inv => stacks(inv).find(s => FIREPROOF_BLOCKS.includes(s.id)) || null;

export function buildEnclosurePlan(spawner, playerPos) {
  const {x: sx, y: sy, z: sz} = spawner;
  // Determine which side faces the player so we keep a 1-2 block melee/loot opening on that side.
  const dxp = playerPos.x - (sx + 0.5);
  const dzp = playerPos.z - (sz + 0.5);
  const openDir = Math.abs(dxp) >= Math.abs(dzp)
    ? (dxp >= 0 ? 'east' : 'west')
    : (dzp >= 0 ? 'south' : 'north');

  const roof = [];
  // Primary 3x3 roof right at sy+2 prevents spawned blazes from flying upward out of melee reach.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      roof.push({x: sx + dx, y: sy + 2, z: sz + dz, role: 'roof'});
    }
  }
  // Outer ring walls at distance 2, heights sy+1 and sy+2, leaving an opening facing the player at sy+1.
  const walls = [];
  for (let d = -2; d <= 2; d++) {
    const ring = [
      {x: sx + 2, z: sz + d, side: 'east', center: Math.abs(d) <= 1},
      {x: sx - 2, z: sz + d, side: 'west', center: Math.abs(d) <= 1},
      {x: sx + d, z: sz + 2, side: 'south', center: Math.abs(d) <= 1},
      {x: sx + d, z: sz - 2, side: 'north', center: Math.abs(d) <= 1},
    ];
    for (const cell of ring) {
      // Top lip at sy+2 all around so blazes cannot float over walls.
      walls.push({x: cell.x, y: sy + 2, z: cell.z, role: 'wall_top'});
      // Leave melee window on the player's side at sy+1 (center 1-2 blocks open).
      if (cell.side === openDir && cell.center && d === 0) continue;
      walls.push({x: cell.x, y: sy + 1, z: cell.z, role: 'wall'});
    }
  }
  // Deduplicate keeping roof first.
  const seen = new Set();
  const plan = [];
  for (const cell of [...roof, ...walls]) {
    const key = `${cell.x},${cell.y},${cell.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plan.push(cell);
  }
  return {openDir, plan};
}

async function moveNear(call, target, reach, deadline, signal, sleep, now = Date.now) {
  const s0 = await call('player.getState');
  if (Math.hypot(s0.x - (target.x + 0.5), s0.y - target.y, s0.z - (target.z + 0.5)) <= reach) return true;
  await call('fish.navigate', {x: target.x + 0.5, y: target.y, z: target.z + 0.5, reach});
  const limit = Math.min(deadline, now() + 8000);
  try {
    while (now() < limit) {
      signal?.throwIfAborted();
      const s = await call('player.getState');
      if (s.health <= 10 || s.inLava) return false;
      if (Math.hypot(s.x - (target.x + 0.5), s.y - target.y, s.z - (target.z + 0.5)) <= reach + 0.5) return true;
      await sleep(180);
    }
    return false;
  } finally {
    await call('fish.cancel').catch(() => {});
  }
}

export async function farmBlazeSpawner(
  args = {},
  {
    call,
    place,
    signal,
    locate,
    fight = (fArgs) => fightEntity(fArgs, {call, signal}),
    eat,
    now = Date.now,
    sleep = ms => delay(ms, undefined, {signal}),
  } = {},
) {
  const targetRods = args.targetRods ?? 7;
  const seconds = args.seconds ?? 120;
  const encloseOnly = args.encloseOnly === true;
  if (!Number.isInteger(targetRods) || targetRods < 1 || targetRods > 24) throw Error('targetRods 须为 1–24 整数。');
  if (!Number.isInteger(seconds) || seconds < 20 || seconds > 180) throw Error('seconds 须为 20–180 秒整数。');

  await call('fish.cancel');
  await call('screen.close');

  const initial = await call('player.getState');
  if (initial.dimension !== 'minecraft:the_nether') {
    throw Error('farm_blaze_spawner 仅适用于下界烈焰人刷怪笼。');
  }
  if (initial.health <= 10 || initial.inLava) {
    throw Error('当前生命偏低或在岩浆中，请先恢复状态后再围笼刷烈焰人。');
  }

  let spawner;
  if (Number.isFinite(args.x) && Number.isFinite(args.y) && Number.isFinite(args.z)) {
    spawner = {x: Math.floor(args.x), y: Math.floor(args.y), z: Math.floor(args.z)};
  } else if (locate) {
    const found = await locate({target: 'blaze_spawner', radius: 64});
    if (!found?.found || !found.position) {
      throw Error('周围64格内未找到已加载的烈焰人刷怪笼；请先前往下界堡垒再调用。');
    }
    spawner = {x: Math.floor(found.position.x), y: Math.floor(found.position.y), z: Math.floor(found.position.z)};
  } else {
    throw Error('请提供烈焰人刷怪笼的 x/y/z 坐标，或先用 locate_resource(target="blaze_spawner") 查询。');
  }

  const deadline = now() + seconds * 1000;
  const startRods = countItem(await call('player.getInventory'), BLAZE_ROD);

  // Move within 12 blocks first so spawner chunk is close and reachable.
  if (Math.hypot(initial.x - (spawner.x + 0.5), initial.y - spawner.y, initial.z - (spawner.z + 0.5)) > 12) {
    const ok = await moveNear(call, spawner, 8, deadline, signal, sleep, now);
    if (!ok) {
      return {status: 'interrupted', reason: 'spawner_unreachable', spawner, enclosedBlocks: 0, killedBlazes: 0, rodsGained: 0, totalRods: startRods, targetRods};
    }
  }

  const [spawnerBlock] = (await call('fish.probeBlocks', {positions: [spawner]})).blocks || [];
  if (!spawnerBlock?.loaded || spawnerBlock.id !== 'minecraft:spawner') {
    throw Error(`指定位置 (${spawner.x},${spawner.y},${spawner.z}) 不是已加载的刷怪笼，实际为 ${spawnerBlock?.id || '未加载'}。`);
  }

  // Phase 1: Cap roof & enclose spawner so blazes stay low and reachable.
  const afterApproach = await call('player.getState');
  const {openDir, plan} = buildEnclosurePlan(spawner, afterApproach);
  const existing = [];
  for (let i = 0; i < plan.length; i += 64) {
    const res = await call('fish.probeBlocks', {positions: plan.slice(i, i + 64)});
    existing.push(...(res.blocks || []));
  }
  const missingCells = plan.filter((_, i) => existing[i]?.loaded && existing[i]?.air);
  let enclosedBlocks = 0;
  let killedBlazes = 0;
  let encloseNote = '';
  const alreadyEnclosed = missingCells.length === 0;

  if (!alreadyEnclosed && place) {
    const toPlace = missingCells.slice(0, 24);
    for (const cell of toPlace) {
      signal?.throwIfAborted();
      if (now() >= deadline - (encloseOnly ? 1000 : 25000)) break;
      const state = await call('player.getState');
      if (state.health <= 10 || state.inLava) {
        return {
          status: 'interrupted',
          reason: 'player_danger',
          spawner,
          openSide: openDir,
          enclosedBlocks,
          alreadyEnclosed: false,
          killedBlazes,
          rodsGained: Math.max(0, countItem(await call('player.getInventory'), BLAZE_ROD) - startRods),
          totalRods: countItem(await call('player.getInventory'), BLAZE_ROD),
          targetRods,
        };
      }
      const blockStack = pickBuildingBlock(await call('player.getInventory'));
      if (!blockStack) {
        encloseNote = '背包普通防火建筑块已用完，已完成部分封顶。';
        break;
      }
      // Clear immediate close blaze threat before placing if not encloseOnly.
      if (!encloseOnly) {
        const nearby = (await call('perception.entities', {radius: 7, kinds: []})).entities || [];
        const closeBlaze = nearby.find(e => e.type === 'minecraft:blaze');
        if (closeBlaze) {
          try {
            const fres = await fight({uuid: closeBlaze.uuid, weapon: 'auto', loot: 'blaze_rod', seconds: 15});
            if (fres?.deathObserved) killedBlazes++;
          } catch {}
        }
      }
      if (Math.hypot(state.x - (cell.x + 0.5), state.y - cell.y, state.z - (cell.z + 0.5)) > 4.2) {
        await moveNear(call, {x: cell.x, y: spawner.y, z: cell.z}, 3.6, Math.min(deadline, now() + 3500), signal, sleep, now);
      }
      try {
        await place({x: cell.x, y: cell.y, z: cell.z, item: blockStack.id});
        enclosedBlocks++;
      } catch (err) {
        signal?.throwIfAborted();
        // Skip unreachable/unsupported cells without aborting the whole enclosure.
      }
    }
  } else if (!alreadyEnclosed && !place) {
    encloseNote = '当前调用上下文未提供放块回调。';
  }

  if (encloseOnly) {
    const totalRods = countItem(await call('player.getInventory'), BLAZE_ROD);
    return {
      status: alreadyEnclosed || enclosedBlocks > 0 ? 'succeeded' : 'interrupted',
      reason: alreadyEnclosed ? 'already_enclosed' : enclosedBlocks > 0 ? 'enclosed' : 'no_blocks_placed',
      spawner,
      openSide: openDir,
      enclosedBlocks,
      missingBefore: missingCells.length,
      alreadyEnclosed,
      killedBlazes,
      rodsGained: Math.max(0, totalRods - startRods),
      totalRods,
      targetRods,
      ...(encloseNote ? {note: encloseNote} : {}),
    };
  }

  // Phase 2: Stay within 16 blocks of spawner, kill blazes, and collect blaze rods.
  const holdOffset = {east: [4, 0], west: [-4, 0], south: [0, 4], north: [0, -4]}[openDir];
  const holdSpot = {x: spawner.x + holdOffset[0], y: spawner.y, z: spawner.z + holdOffset[1]};

  while (now() < deadline) {
    signal?.throwIfAborted();
    const state = await call('player.getState');
    const inv = await call('player.getInventory');
    const totalRods = countItem(inv, BLAZE_ROD);
    const rodsGained = Math.max(0, totalRods - startRods);
    if (rodsGained >= targetRods) {
      return {
        status: 'succeeded',
        reason: 'target_rods_reached',
        spawner,
        openSide: openDir,
        enclosedBlocks,
        alreadyEnclosed,
        killedBlazes,
        rodsGained,
        totalRods,
        targetRods,
        ...(encloseNote ? {note: encloseNote} : {}),
      };
    }
    if (state.dimension !== 'minecraft:the_nether' || state.health <= 10 || state.inLava) {
      return {
        status: 'interrupted',
        reason: 'player_danger',
        spawner,
        openSide: openDir,
        enclosedBlocks,
        alreadyEnclosed,
        killedBlazes,
        rodsGained,
        totalRods,
        targetRods,
        ...(encloseNote ? {note: encloseNote} : {}),
      };
    }
    if ((state.food ?? 20) <= 14 && eat) {
      try { await eat(); } catch {}
    }

    const {entities = []} = await call('perception.entities', {radius: 18, kinds: []});
    const rodDrop = entities
      .filter(e => e.item?.id === BLAZE_ROD && Math.abs(e.y - state.y) <= 3)
      .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (rodDrop) {
      await moveNear(call, {x: Math.floor(rodDrop.x), y: Math.floor(rodDrop.y), z: Math.floor(rodDrop.z)}, 0.8, Math.min(deadline, now() + 3500), signal, sleep, now);
      await sleep(250);
      continue;
    }

    const blaze = entities
      .filter(e => e.type === 'minecraft:blaze')
      .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (blaze) {
      const remSec = Math.max(1, Math.min(25, Math.floor((deadline - now()) / 1000)));
      try {
        const res = await fight({uuid: blaze.uuid, weapon: 'auto', loot: 'blaze_rod', seconds: remSec});
        if (res?.deathObserved) killedBlazes++;
        if (res?.reason === 'player_danger' || res?.reason === 'weapon_nearly_broken' || res?.reason === 'weapon_changed_or_broken') {
          const invNow = await call('player.getInventory');
          const curTotal = countItem(invNow, BLAZE_ROD);
          return {
            status: 'interrupted',
            reason: res.reason,
            spawner,
            openSide: openDir,
            enclosedBlocks,
            alreadyEnclosed,
            killedBlazes,
            rodsGained: Math.max(0, curTotal - startRods),
            totalRods: curTotal,
            targetRods,
          };
        }
      } catch (err) {
        signal?.throwIfAborted();
        if (/没有可用的剑或斧/.test(err.message)) {
          const invNow = await call('player.getInventory');
          const curTotal = countItem(invNow, BLAZE_ROD);
          return {status: 'interrupted', reason: 'no_weapon', spawner, openSide: openDir, enclosedBlocks, alreadyEnclosed, killedBlazes, rodsGained: Math.max(0, curTotal - startRods), totalRods: curTotal, targetRods, message: err.message};
        }
      }
      continue;
    }

    // No blaze right now: stay within 12 blocks of spawner so it keeps spawning.
    if (Math.hypot(state.x - (spawner.x + 0.5), state.y - spawner.y, state.z - (spawner.z + 0.5)) > 12) {
      await moveNear(call, holdSpot, 3, Math.min(deadline, now() + 4500), signal, sleep, now);
    }
    await sleep(1200);
  }

  const finalInv = await call('player.getInventory');
  const totalRods = countItem(finalInv, BLAZE_ROD);
  const rodsGained = Math.max(0, totalRods - startRods);
  return {
    status: rodsGained >= targetRods ? 'succeeded' : 'interrupted',
    reason: rodsGained >= targetRods ? 'target_rods_reached' : 'time_budget',
    spawner,
    openSide: openDir,
    enclosedBlocks,
    alreadyEnclosed,
    killedBlazes,
    rodsGained,
    totalRods,
    targetRods,
    ...(encloseNote ? {note: encloseNote} : {}),
  };
}

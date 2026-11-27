import { setTimeout as delay } from 'node:timers/promises';
import { mineBlock } from './mining.mjs';

const fullId = id => (typeof id === 'string' && id.includes(':') ? id : `minecraft:${id}`);
const posKey = p => `${p.x},${p.y},${p.z}`;
const dist3 = (a, b) => Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0), (a.z ?? 0) - (b.z ?? 0));
const HAZARD = /(?:^|:)(?:lava|fire|soul_fire)$/;
const inventoryCounts = inv => {
  const map = new Map();
  for (const s of [...(inv.hotbar || []), ...(inv.main || [])]) {
    map.set(s.id, (map.get(s.id) || 0) + s.count);
  }
  return map;
};
const diffInventory = (before, after) => {
  const gains = [];
  for (const [id, count] of after.entries()) {
    const delta = count - (before.get(id) || 0);
    if (delta > 0) gains.push(`${id.replace(/^minecraft:/, '')}×${delta}`);
  }
  return gains.length ? gains.join(', ') : 'nothing';
};

function parseObstruction(message) {
  const m = /first hit ([a-z0-9_:-]+) @ (-?\d+),\s*(-?\d+),\s*(-?\d+)/i.exec(String(message || ''));
  if (!m) return null;
  return { id: m[1], x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) };
}

export async function collectBuriedBlocks(rt, bridge, args, { signal, remainingMs = () => 180000 } = {}) {
  const call = (method, params = {}) => bridge.call(method, params, { signal });
  const ids = (args.blocks || []).map(fullId);
  const wanted = Math.max(1, Math.min(64, Number(args.count) || 1));
  const radius = Math.max(8, Math.min(64, Number(args.radius) || 32));
  const budgetMs = Math.min(180000, Math.max(15000, Number(args.maxSeconds || 120) * 1000), remainingMs());
  const deadline = Date.now() + budgetMs;

  const initialState = await call('player.getState');
  const beforeInv = inventoryCounts(await call('player.getInventory'));
  const skip = new Set();
  let broken = 0;
  const progress = [];
  let stopReason = '';

  const checkSafety = async () => {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) return 'time_limit';
    const self = await call('player.getState');
    if (self.dimension !== initialState.dimension || self.gameMode !== 'survival') return 'state_changed';
    if (self.health <= 10 || self.health < initialState.health - 3 || self.inLava || (self.air ?? 300) < 100) return 'player_danger';
    const nearby = await call('perception.entities', { radius: 6, kinds: ['hostile'] });
    if ((nearby.entities || []).some(e => e.distance < 5.5)) return 'hostile_nearby';
    let inv = await call('player.getInventory');
    if ([...(inv.hotbar || []), ...(inv.main || [])].length >= 36) {
      await call('fish.mergeInventory').catch(() => {});
      await delay(250, undefined, { signal });
      inv = await call('player.getInventory');
      if ([...(inv.hotbar || []), ...(inv.main || [])].length >= 36) return 'inventory_full';
    }
    return '';
  };

  try {
    await call('screen.close');
    while (broken < wanted) {
      const unsafe = await checkSafety();
      if (unsafe) { stopReason = unsafe; break; }

      const self = await call('player.getState');
      const chunkRadius = Math.max(1, Math.min(3, Math.ceil(radius / 16)));
      const { scan } = await rt.observe({ radius: chunkRadius, find: ids, findLimit: 64 });
      const candidates = (scan.found || [])
        .filter(b => !skip.has(posKey(b)) && dist3(b, self) <= radius)
        .sort((a, b) => dist3(a, self) - dist3(b, self));

      if (!candidates.length) {
        stopReason = broken > 0 ? 'no_more_targets' : 'no_reachable_targets';
        break;
      }

      const target = candidates[0];
      const key = posKey(target);
      const [probe] = (await call('perception.blocks', { positions: [target], tool: true })).blocks;
      if (!probe || !probe.loaded || probe.air || !ids.includes(probe.id)) {
        skip.add(key);
        continue;
      }
      if (probe.canHarvest === false) {
        stopReason = `当前工具等级无法采集 ${probe.id.replace(/^minecraft:/, '')}（需要更高等级的镐）`;
        break;
      }

      // Skip ores directly adjacent to lava to avoid flooding the player.
      const adjPos = [
        { x: target.x + 1, y: target.y, z: target.z },
        { x: target.x - 1, y: target.y, z: target.z },
        { x: target.x, y: target.y + 1, z: target.z },
        { x: target.x, y: target.y - 1, z: target.z },
        { x: target.x, y: target.y, z: target.z + 1 },
        { x: target.x, y: target.y, z: target.z - 1 },
      ];
      const adjBlocks = (await call('perception.blocks', { positions: adjPos })).blocks || [];
      if (adjBlocks.some(b => b?.loaded && HAZARD.test(b.id || ''))) {
        skip.add(key);
        progress.push(`skipped lava-adjacent ${probe.id.replace(/^minecraft:/, '')} @ ${target.x} ${target.y} ${target.z}`);
        continue;
      }

      // Use Baritone to tunnel/path near the buried target.
      const navDeadline = Math.min(deadline, Date.now() + 28000);
      await call('fish.navigate', { x: target.x + 0.5, y: target.y, z: target.z + 0.5, reach: 2.3 });
      let lastPos = self;
      let lastMovedAt = Date.now();
      let navUnsafe = '';
      while (Date.now() < navDeadline) {
        navUnsafe = await checkSafety();
        if (navUnsafe) break;
        const cur = await call('player.getState');
        if (dist3(cur, lastPos) > 0.25) { lastPos = cur; lastMovedAt = Date.now(); }
        const [curBlock] = (await call('perception.blocks', { positions: [target] })).blocks;
        if (curBlock?.loaded && curBlock.air) break;
        const nav = await call('fish.navigationStatus');
        const eyeDist = dist3({ x: cur.x, y: cur.y + 1.62, z: cur.z }, { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 });
        if (eyeDist <= 3.6 && (nav.state === 'reached' || nav.state === 'stopped')) break;
        if (!nav.active && nav.state === 'stopped') break;
        if (Date.now() - lastMovedAt > 8000) break;
        await delay(400, undefined, { signal });
      }
      await call('fish.cancel').catch(() => {});
      if (navUnsafe) { stopReason = navUnsafe; break; }

      // Re-check target after navigation (Baritone may have already broken it while tunneling).
      const [afterNav] = (await call('perception.blocks', { positions: [target], tool: true })).blocks;
      if (afterNav?.loaded && afterNav.air) {
        broken++;
        progress.push(`mined ${probe.id.replace(/^minecraft:/, '')} @ ${target.x} ${target.y} ${target.z} (during tunnel)`);
        await call('fish.navigate', { x: target.x + 0.5, y: target.y, z: target.z + 0.5, reach: 0.8 }).catch(() => {});
        await delay(900, undefined, { signal });
        await call('fish.cancel').catch(() => {});
        continue;
      }

      const curNow = await call('player.getState');
      const eyeDistNow = dist3({ x: curNow.x, y: curNow.y + 1.62, z: curNow.z }, { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 });
      if (eyeDistNow > 4.6) {
        skip.add(key);
        progress.push(`could not reach ${probe.id.replace(/^minecraft:/, '')} @ ${target.x} ${target.y} ${target.z} (dist=${eyeDistNow.toFixed(1)})`);
        continue;
      }

      // Clear up to 3 obstructing blocks in front of the target ore if line-of-sight is blocked.
      let minedTarget = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const unsafeNow = await checkSafety();
        if (unsafeNow) { stopReason = unsafeNow; break; }
        try {
          await mineBlock(call, target, { signal });
          minedTarget = true;
          break;
        } catch (err) {
          signal?.throwIfAborted();
          const obs = parseObstruction(err.message);
          if (obs && !HAZARD.test(obs.id) && !(obs.x === target.x && obs.y === target.y && obs.z === target.z)) {
            try {
              await mineBlock(call, obs, { signal });
              continue;
            } catch {
              break;
            }
          }
          break;
        }
      }
      if (stopReason) break;

      if (minedTarget) {
        broken++;
        progress.push(`broke ${probe.id.replace(/^minecraft:/, '')} @ ${target.x} ${target.y} ${target.z}`);
        // Step closer briefly to collect the drop.
        await call('fish.navigate', { x: target.x + 0.5, y: target.y, z: target.z + 0.5, reach: 0.8 }).catch(() => {});
        await delay(1000, undefined, { signal });
        await call('fish.cancel').catch(() => {});
      } else {
        skip.add(key);
        progress.push(`failed to mine ${probe.id.replace(/^minecraft:/, '')} @ ${target.x} ${target.y} ${target.z}`);
      }
    }
  } finally {
    await call('fish.cancel').catch(() => {});
  }

  const afterInv = inventoryCounts(await call('player.getInventory'));
  const gained = diffInventory(beforeInv, afterInv);
  const what = ids.map(id => id.replace(/^minecraft:/, '')).join('/');
  if (broken > 0) {
    return {
      state: broken >= wanted ? 'succeeded' : 'succeeded',
      result: `tunneled and broke ${broken}/${wanted} buried ${what}${stopReason ? ` (stopped: ${stopReason})` : ''}; inventory +${gained}`,
      progress: progress.slice(-8),
    };
  }
  return {
    state: 'failed',
    result: `buried ${what} collection stopped (${stopReason || 'unreachable'}); broke 0/${wanted}; inventory +${gained}`,
    progress: progress.slice(-8),
  };
}

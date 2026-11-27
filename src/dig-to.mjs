import {setTimeout as delay} from 'node:timers/promises';
import {mineBlock} from './mining.mjs';

const ALL_DIRS = ['north', 'south', 'east', 'west'];
const DIR_VEC = {north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0]};
const FATAL_REASONS = new Set([
  'player_danger',
  'hostile_nearby',
  'inventory_full',
  'tool_nearly_broken',
  'player_state_changed',
]);
const DROP_ITEM_MAP = {
  diamond_ore: 'minecraft:diamond',
  iron_ore: 'minecraft:raw_iron',
  gold_ore: 'minecraft:raw_gold',
  nether_gold_ore: 'minecraft:gold_nugget',
  coal_ore: 'minecraft:coal',
  copper_ore: 'minecraft:raw_copper',
  redstone_ore: 'minecraft:redstone',
  lapis_ore: 'minecraft:lapis_lazuli',
  emerald_ore: 'minecraft:emerald',
  nether_quartz_ore: 'minecraft:quartz',
  obsidian: 'minecraft:obsidian',
  ancient_debris: 'minecraft:ancient_debris',
};

const stacks = inv => [...(inv?.hotbar || []), ...(inv?.main || [])];
const countItem = (inv, id) => stacks(inv).filter(s => s.id === id).reduce((sum, s) => sum + s.count, 0);
const oreFamily = id => String(id || '').replace(/^minecraft:/, '').replace(/^deepslate_/, '');
const keyOf = p => `${p.x},${p.y},${p.z}`;

function buildCandidates(px, py, pz, tx, ty, tz, blocked, preferToggle, {prevCellKey = null, visitedCount = new Map()} = {}) {
  const dx = tx - px;
  const dy = ty - py;
  const dz = tz - pz;
  const wantSlope = dy < 0 ? 'down' : dy > 0 ? 'up' : 'level';

  const scoredDirs = ALL_DIRS.map(dir => {
    const [vx, vz] = DIR_VEC[dir];
    const progress = vx * dx + vz * dz; // >0 moves toward target
    const axisDist = vx !== 0 ? Math.abs(dx) : Math.abs(dz);
    return {dir, progress, axisDist};
  }).sort((a, b) => {
    if (b.progress !== a.progress) return b.progress - a.progress;
    return b.axisDist - a.axisDist;
  });

  // When horizontally right above/below target, alternate horizontal axis slightly so staircase zig-zags near target
  if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && wantSlope !== 'level') {
    const rot = preferToggle % ALL_DIRS.length;
    for (let i = 0; i < rot; i++) scoredDirs.push(scoredDirs.shift());
  }

  const candidates = [];
  const add = (direction, slope, length) => {
    const k = `${direction}:${slope}`;
    if (blocked.has(k)) return;
    const clamped = Math.max(1, Math.min(8, Math.round(length)));
    if (!candidates.some(c => c.direction === direction && c.slope === slope)) {
      const [vx, vz] = DIR_VEC[direction];
      const sy = slope === 'up' ? 1 : slope === 'down' ? -1 : 0;
      const nextKey = `${px + vx},${py + sy},${pz + vz}`;
      candidates.push({direction, slope, length: clamped, nextKey});
    }
  };

  if (wantSlope !== 'level') {
    const absY = Math.abs(dy);
    const horizNear = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
    for (const {dir, progress, axisDist} of scoredDirs) {
      if (progress > 0) {
        add(dir, wantSlope, Math.min(8, Math.max(1, Math.min(axisDist, absY))));
      } else if (horizNear) {
        add(dir, wantSlope, Math.min(4, Math.max(2, absY)));
      }
    }
    // Sidestep level toward target before zig-zagging backwards
    for (const {dir, progress, axisDist} of scoredDirs) {
      if (progress > 0) add(dir, 'level', Math.min(4, Math.max(2, axisDist)));
    }
    for (const {dir} of scoredDirs) {
      add(dir, wantSlope, Math.min(4, Math.max(2, absY)));
    }
    for (const {dir} of scoredDirs) {
      add(dir, 'level', 2);
    }
    const oppSlope = wantSlope === 'up' ? 'down' : 'up';
    for (const {dir, progress} of scoredDirs) {
      if (progress > 0) add(dir, oppSlope, 2);
    }
  } else {
    for (const {dir, progress, axisDist} of scoredDirs) {
      if (progress > 0) add(dir, 'level', Math.min(8, Math.max(1, axisDist)));
    }
    // Bypass forward obstacles (lava/gaps/water) by stepping up or down before walking backwards
    for (const {dir, progress} of scoredDirs) {
      if (progress > 0) {
        add(dir, 'up', 2);
        add(dir, 'down', 2);
      }
    }
    for (const {dir} of scoredDirs) {
      add(dir, 'level', 2);
    }
    for (const {dir} of scoredDirs) {
      add(dir, 'up', 2);
      add(dir, 'down', 2);
    }
  }

  const tierOf = c => {
    const visits = visitedCount.get(c.nextKey) || 0;
    if (c.nextKey !== prevCellKey && visits === 0) return 0;
    if (c.nextKey !== prevCellKey && visits === 1) return 1;
    return 2;
  };
  return candidates
    .map((c, idx) => ({c, idx, tier: tierOf(c)}))
    .sort((a, b) => (a.tier - b.tier) || (a.idx - b.idx))
    .map(x => x.c);
}

async function probeChunked(call, positions) {
  const out = [];
  for (let i = 0; i < positions.length; i += 64) {
    const res = await call('fish.probeBlocks', {positions: positions.slice(i, i + 64)});
    out.push(...(res.blocks || []));
  }
  return out;
}

async function findConnectedVein(call, target, maxBlocks = 16) {
  const positions = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        positions.push({x: target.x + dx, y: target.y + dy, z: target.z + dz});
      }
    }
  }
  const blocks = await probeChunked(call, positions);
  const byKey = new Map();
  for (const b of blocks) byKey.set(keyOf(b), b);

  const seed = byKey.get(keyOf(target));
  if (!seed?.loaded || seed.air || seed.fluid || (seed.hardness ?? 0) < 0) {
    return {family: null, targetId: seed?.id || null, vein: [], byKey};
  }
  const family = oreFamily(seed.id);
  const visited = new Set([keyOf(target)]);
  const queue = [seed];
  const vein = [];

  while (queue.length && vein.length < maxBlocks) {
    const cur = queue.shift();
    vein.push({x: cur.x, y: cur.y, z: cur.z, id: cur.id});
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nk = `${cur.x + dx},${cur.y + dy},${cur.z + dz}`;
          if (visited.has(nk)) continue;
          const nb = byKey.get(nk);
          if (!nb?.loaded || nb.air || nb.fluid) continue;
          if (oreFamily(nb.id) !== family) continue;
          visited.add(nk);
          queue.push(nb);
        }
      }
    }
  }
  return {family, targetId: seed.id, vein, byKey};
}

function adjacentHasLava(pos, byKey) {
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [dx, dy, dz] of dirs) {
    const nb = byKey.get(`${pos.x + dx},${pos.y + dy},${pos.z + dz}`);
    if (nb && (nb.fluid && /lava/.test(nb.id || '') || /lava/.test(nb.id || ''))) return true;
  }
  return false;
}

async function stepTowardPoint(call, target, sleep) {
  try {
    await call('control.lookAt', {x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5});
    await call('control.setInput', {forward: true, back: false, left: false, right: false, jump: false, sneak: true, sprint: false});
    await sleep(320);
  } finally {
    await call('control.stop').catch(() => {});
  }
}

export async function digToPosition(
  args = {},
  {call, signal, dig, mine = mineBlock, now = Date.now, sleep = ms => delay(ms, undefined, {signal})} = {},
) {
  if (![args.x, args.y, args.z].every(Number.isFinite)) {
    throw Error('dig_to_position 需要有效的整数目标坐标 x/y/z。');
  }
  const tx = Math.floor(args.x);
  const ty = Math.floor(args.y);
  const tz = Math.floor(args.z);
  const mineTarget = args.mineTarget === true;
  const reach = args.reach ?? (mineTarget ? 2 : 2);
  const seconds = args.seconds ?? 90;
  if (!Number.isFinite(reach) || reach < 1 || reach > 4) throw Error('reach 限 1–4 格。');
  if (!Number.isInteger(seconds) || seconds < 15 || seconds > 150) throw Error('seconds 限 15–150 秒整数。');

  await call('fish.cancel').catch(() => {});
  await call('screen.close').catch(() => {});

  const start = await call('player.getState');
  if (start.health <= 8 || start.inLava) {
    throw Error('当前生命偏低或在岩浆中，请先脱险或回复生命。');
  }

  const started = now();
  const deadline = started + seconds * 1000;
  const blockedByCell = new Map();
  const visitedCount = new Map();
  const getBlocked = k => {
    let s = blockedByCell.get(k);
    if (!s) {
      s = new Set();
      blockedByCell.set(k, s);
    }
    return s;
  };
  let currentCellKey = null;
  let prevCellKey = null;
  let toggle = 0;
  let totalSteps = 0;
  let totalBroken = 0;
  let segments = 0;
  let lastReason = null;
  let lastMessage = null;
  let lastObstacleReason = null;
  let lastObstacleMessage = null;
  let reached = false;
  let self = start;
  let bestDist = Math.hypot(tx - Math.floor(start.x), ty - Math.floor(start.y), tz - Math.floor(start.z));
  let noProgressSegments = 0;

  const isCloseEnough = s => {
    const px = Math.floor(s.x), py = Math.floor(s.y), pz = Math.floor(s.z);
    const d3 = Math.hypot(tx - px, ty - py, tz - pz);
    const dh = Math.hypot(tx - px, tz - pz);
    const dv = Math.abs(ty - py);
    if (mineTarget) return d3 <= Math.max(reach, 2.3) && dh <= 2 && dv <= 2;
    return d3 <= reach + 0.6 && dv <= 2;
  };

  while (now() < deadline) {
    signal?.throwIfAborted();
    self = await call('player.getState');
    if (self.health <= 8 || self.inLava || self.inWater) {
      lastReason = 'player_danger';
      lastMessage = self.inWater ? '途中进入水中，已停止挖掘。' : '生命偏低或遇到岩浆，已停止挖掘。';
      break;
    }
    if (isCloseEnough(self)) {
      reached = true;
      break;
    }
    const px = Math.floor(self.x), py = Math.floor(self.y), pz = Math.floor(self.z);
    const cellKey = `${px},${py},${pz}`;
    if (cellKey !== currentCellKey) {
      prevCellKey = currentCellKey;
      currentCellKey = cellKey;
      visitedCount.set(cellKey, (visitedCount.get(cellKey) || 0) + 1);
    }
    const cellBlocked = getBlocked(cellKey);

    const candidates = buildCandidates(px, py, pz, tx, ty, tz, cellBlocked, toggle, {prevCellKey, visitedCount});
    if (!candidates.length) {
      lastReason = lastObstacleReason || lastReason || 'blocked_all_directions';
      lastMessage = lastObstacleMessage || lastMessage || '四周方向均受障碍阻挡（岩浆/空洞/不可挖方块），请查看周围后换路线。';
      break;
    }

    const pick = candidates[0];
    if (noProgressSegments >= 6 && (visitedCount.get(pick.nextKey) || 0) >= 2) {
      lastReason = lastObstacleReason || 'path_blocked_loop';
      lastMessage = lastObstacleMessage || '前方存在持续障碍且绕行会回到原格，已停止原地往返，请调整目标高度或换路线。';
      break;
    }
    toggle++;
    segments++;
    const seg = await dig({direction: pick.direction, slope: pick.slope, length: pick.length});
    totalSteps += seg.completedSteps || 0;
    totalBroken += seg.brokenBlocks || 0;
    lastReason = seg.reason || null;
    lastMessage = seg.message || null;
    if (seg.reason && seg.reason !== 'requested_length_reached' && seg.reason !== 'time_budget') {
      lastObstacleReason = seg.reason;
      if (seg.message) lastObstacleMessage = seg.message;
    }

    self = await call('player.getState');
    if (isCloseEnough(self)) {
      reached = true;
      break;
    }

    if (FATAL_REASONS.has(seg.reason)) break;
    if (seg.reason === 'time_budget') continue;
    if (seg.reason === 'action_failed' && /无法得到该方块的掉落/.test(seg.message || '')) break;

    const afterKey = `${Math.floor(self.x)},${Math.floor(self.y)},${Math.floor(self.z)}`;
    const afterDist = Math.hypot(tx - Math.floor(self.x), ty - Math.floor(self.y), tz - Math.floor(self.z));
    if (afterDist < bestDist - 0.5) {
      bestDist = afterDist;
      noProgressSegments = 0;
    } else {
      noProgressSegments++;
    }
    if (((seg.completedSteps || 0) === 0 && seg.status !== 'completed') || afterKey === cellKey) {
      cellBlocked.add(`${pick.direction}:${pick.slope}`);
    }
    if (noProgressSegments >= 10) {
      lastReason = lastObstacleReason || 'path_blocked_loop';
      lastMessage = lastObstacleMessage || '连续绕行多段未拉近目标距离，已提前停止避免原地空转，请换高度或使用其他路线。';
      break;
    }
  }

  let minedBlocks = 0;
  let skippedNearLava = 0;
  let veinFound = 0;
  let targetId = null;
  let gainedItem = null;
  let gainedCount = 0;
  let mineError = null;

  if (reached && mineTarget) {
    const invBefore = await call('player.getInventory');
    const {family, targetId: tid, vein, byKey} = await findConnectedVein(call, {x: tx, y: ty, z: tz}, 16);
    targetId = tid;
    veinFound = vein.length;
    gainedItem = family ? (DROP_ITEM_MAP[family] || null) : null;
    const beforeCount = gainedItem ? countItem(invBefore, gainedItem) : 0;

    // Sort vein blocks nearest to player first
    const curSelf = await call('player.getState');
    vein.sort((a, b) =>
      Math.hypot(a.x - curSelf.x, a.y - curSelf.y, a.z - curSelf.z) -
      Math.hypot(b.x - curSelf.x, b.y - curSelf.y, b.z - curSelf.z),
    );

    let lastMinedPos = null;
    for (const blockPos of vein) {
      signal?.throwIfAborted();
      if (now() >= deadline) break;
      const st = await call('player.getState');
      if (st.health <= 8 || st.inLava) {
        lastReason = 'player_danger';
        break;
      }
      if (adjacentHasLava(blockPos, byKey)) {
        skippedNearLava++;
        continue;
      }
      const dist = Math.hypot(blockPos.x + 0.5 - st.x, blockPos.y + 0.5 - (st.y + 1.2), blockPos.z + 0.5 - st.z);
      if (dist > 4.2) {
        await stepTowardPoint(call, blockPos, sleep);
      }
      let minedThis = false;
      for (let attempt = 0; attempt < 4 && !minedThis; attempt++) {
        try {
          await mine(call, blockPos, {signal, sleep});
          minedBlocks++;
          totalBroken++;
          lastMinedPos = blockPos;
          minedThis = true;
        } catch (err) {
          const msg = String(err?.message || '');
          if (/没有已加载的可挖方块/.test(msg)) {
            minedThis = true;
            break;
          }
          if (/无法得到该方块的掉落/.test(msg)) {
            mineError = msg;
            lastReason = 'tool_tier_insufficient';
            lastMessage = msg;
            break;
          }
          const obsMatch = msg.match(/first hit\s+([a-z0-9_:]+)\s*@\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/i);
          if (obsMatch && attempt < 3 && !/lava|water|bedrock|spawner|chest|furnace|obsidian/i.test(obsMatch[1])) {
            const blocker = {x: Number(obsMatch[2]), y: Number(obsMatch[3]), z: Number(obsMatch[4])};
            if (!adjacentHasLava(blocker, byKey)) {
              try {
                await mine(call, blocker, {signal, sleep});
                totalBroken++;
                continue;
              } catch {}
            }
          }
          if (/out of.*reach/i.test(msg) && attempt < 2) {
            await stepTowardPoint(call, blockPos, sleep);
            continue;
          }
          mineError = msg;
          break;
        }
      }
      if (lastReason === 'tool_tier_insufficient') break;
    }

    if (lastMinedPos) {
      await stepTowardPoint(call, lastMinedPos, sleep);
      await sleep(350);
    }
    if (gainedItem) {
      const invAfter = await call('player.getInventory');
      gainedCount = Math.max(0, countItem(invAfter, gainedItem) - beforeCount);
    }
  }

  const end = await call('player.getState');
  const remainingDistance = Number(Math.hypot(tx - Math.floor(end.x), ty - Math.floor(end.y), tz - Math.floor(end.z)).toFixed(1));
  const ok = reached && !mineError && (!mineTarget || veinFound === 0 || minedBlocks > 0 || skippedNearLava > 0);
  const finalReason = ok
    ? (mineTarget ? 'arrived_and_mined' : 'arrived')
    : (now() >= deadline && (!lastReason || lastReason === 'requested_length_reached')
      ? 'time_budget'
      : (mineError ? (lastReason || 'mine_failed') : (lastReason === 'requested_length_reached' ? 'time_budget' : (lastReason || 'time_budget'))));
  return {
    status: ok ? 'succeeded' : 'interrupted',
    reason: finalReason,
    ...(lastMessage || mineError ? {message: lastMessage || mineError} : {}),
    target: {x: tx, y: ty, z: tz},
    reached,
    remainingDistance,
    segments,
    stepsMoved: totalSteps,
    brokenBlocks: totalBroken,
    ...(mineTarget ? {targetId, veinFound, minedBlocks, skippedNearLava, gainedItem, gainedCount} : {}),
    position: {x: end.x, y: end.y, z: end.z},
    elapsedMs: now() - started,
  };
}

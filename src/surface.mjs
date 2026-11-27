import {setTimeout as delay} from 'node:timers/promises';

const DIRECTIONS = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};
const ALL_DIRS = ['north', 'south', 'east', 'west'];
const SKY_TRANSPARENT = /(?:_leaves|_log|_wood|air|grass|fern|flower|poppy|dandelion|vine|snow|sapling|bush|moss_carpet|torch|lantern|glass|fence|wall|mushroom|sugar_cane|bamboo|cactus|lily_pad|azalea)$/;
const FATAL_DIG_REASONS = new Set([
  'player_danger',
  'hostile_nearby',
  'low_tool_durability',
  'no_pickaxe',
  'missing_floor_blocks',
  'inventory_full',
  'player_state_changed',
]);

function isTransparentForSky(block) {
  if (!block || !block.loaded) return true;
  if (block.air) return true;
  if (block.fluid) return false;
  return SKY_TRANSPARENT.test(block.id || '');
}

export async function isOpenSky(call, pos) {
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);
  const top = Math.min(255, Math.max(128, by + 36));
  const positions = [];
  for (let y = by + 2; y <= top; y++) positions.push({x: bx, y, z: bz});
  for (let i = 0; i < positions.length; i += 64) {
    const chunk = positions.slice(i, i + 64);
    const {blocks = []} = await call('fish.probeBlocks', {positions: chunk});
    for (const block of blocks) {
      if (!isTransparentForSky(block)) return {openSky: false, blockedAt: {x: block.x, y: block.y, z: block.z, id: block.id}};
    }
  }
  return {openSky: by >= 55 || top >= 128, height: by};
}

async function pickBestDirection(call, pos, preferred, avoided) {
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);
  const order = preferred !== 'auto'
    ? [preferred, ...ALL_DIRS.filter(d => d !== preferred)]
    : ALL_DIRS;
  const probes = [];
  for (const dir of order) {
    const [dx, dz] = DIRECTIONS[dir];
    // Step 1: floor(0), feet(1), head(2), ceiling(3); Step 2: floor(1), feet(2), head(3)
    probes.push(
      {x: bx + dx, y: by, z: bz + dz},
      {x: bx + dx, y: by + 1, z: bz + dz},
      {x: bx + dx, y: by + 2, z: bz + dz},
      {x: bx + dx, y: by + 3, z: bz + dz},
      {x: bx + dx * 2, y: by + 1, z: bz + dz * 2},
      {x: bx + dx * 2, y: by + 2, z: bz + dz * 2},
      {x: bx + dx * 2, y: by + 3, z: bz + dz * 2},
      {x: bx, y: by + 2, z: bz},
    );
  }
  const {blocks = []} = await call('fish.probeBlocks', {positions: probes});
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < order.length; i++) {
    const dir = order[i];
    const slice = blocks.slice(i * 8, i * 8 + 8);
    if (slice.some(b => !b?.loaded)) continue;
    if (slice.some(b => b.fluid)) continue;
    if (slice.some(b => /lava|fire|magma|bedrock/.test(b.id || ''))) continue;
    let score = 0;
    if (!avoided.has(dir)) score += 30;
    if (dir === preferred) score += 10;
    // Prefer directions that already have floor support and open air ahead (natural caves/stairs).
    if (slice[0]?.fullSupport && !slice[0].falling) score += 12;
    if (slice[1]?.air) score += 8;
    if (slice[2]?.air) score += 8;
    if (slice[5]?.air && slice[6]?.air) score += 6;
    if (slice.some(b => b.falling)) score -= 10;
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  return best;
}

export async function returnToSurface(args = {}, {call, signal, dig, now = Date.now, sleep = ms => delay(ms, undefined, {signal})} = {}) {
  const maxHeight = args.maxHeight ?? 48;
  const seconds = args.seconds ?? 90;
  const preferred = args.direction ?? 'auto';
  if (!Number.isInteger(maxHeight) || maxHeight < 4 || maxHeight > 120) {
    throw Error('maxHeight 须为 4–120 格整数。');
  }
  if (!Number.isInteger(seconds) || seconds < 15 || seconds > 150) {
    throw Error('seconds 须为 15–150 秒整数。');
  }
  if (preferred !== 'auto' && !ALL_DIRS.includes(preferred)) {
    throw Error('direction 可选 auto、north、south、east、west。');
  }
  await call('fish.cancel');
  await call('screen.close');
  const start = await call('player.getState');
  if (start.dimension !== 'minecraft:overworld') {
    throw Error('return_to_surface 仅适用于主世界地下返回地表。');
  }
  if (start.health <= 8 || start.inLava) {
    throw Error('当前生命偏低或在岩浆中，请先脱险或回复生命。');
  }
  const startY = Math.floor(start.y);
  const startCheck = await isOpenSky(call, start);
  if (startCheck.openSky && startY >= 56) {
    return {
      status: 'succeeded',
      reason: 'already_on_surface',
      climbed: 0,
      startY,
      endY: startY,
      openSky: true,
      position: {x: Math.floor(start.x), y: startY, z: Math.floor(start.z)},
    };
  }

  const deadline = now() + seconds * 1000;
  const avoided = new Set();
  const directionsUsed = [];
  let segments = 0;
  let lastReason = 'in_progress';
  let lastDetail = null;
  let current = start;

  while (now() < deadline) {
    signal?.throwIfAborted();
    current = await call('player.getState');
    if (current.dimension !== 'minecraft:overworld') {
      return {status: 'interrupted', reason: 'dimension_changed', startY, endY: Math.floor(current.y), climbed: Math.max(0, Math.floor(current.y) - startY), openSky: false};
    }
    if (current.health <= 8 || current.inLava || (current.air ?? 300) < 100) {
      return {status: 'interrupted', reason: 'player_danger', startY, endY: Math.floor(current.y), climbed: Math.max(0, Math.floor(current.y) - startY), openSky: false};
    }
    const climbed = Math.max(0, Math.floor(current.y) - startY);
    const sky = await isOpenSky(call, current);
    if (sky.openSky && Math.floor(current.y) >= 55) {
      return {
        status: 'succeeded',
        reason: 'reached_surface',
        startY,
        endY: Math.floor(current.y),
        climbed,
        segments,
        directionsUsed,
        openSky: true,
        position: {x: Math.floor(current.x), y: Math.floor(current.y), z: Math.floor(current.z)},
      };
    }
    if (climbed >= maxHeight) {
      return {
        status: 'interrupted',
        reason: 'max_height_reached',
        startY,
        endY: Math.floor(current.y),
        climbed,
        segments,
        directionsUsed,
        openSky: false,
        position: {x: Math.floor(current.x), y: Math.floor(current.y), z: Math.floor(current.z)},
        message: '已安全上升到本次高度上限，仍未见天空；可再次调用 return_to_surface 继续上行。',
      };
    }

    const dir = await pickBestDirection(call, current, preferred, avoided);
    if (!dir) {
      return {
        status: 'interrupted',
        reason: 'no_safe_upward_direction',
        startY,
        endY: Math.floor(current.y),
        climbed,
        segments,
        directionsUsed,
        openSky: false,
        position: {x: Math.floor(current.x), y: Math.floor(current.y), z: Math.floor(current.z)},
        message: '四个方向上行台阶附近均检测到流体、未加载或危险方块；请先观察周围或挪开几格再试。',
      };
    }

    const stepLength = Math.max(2, Math.min(6, maxHeight - climbed));
    directionsUsed.push(dir);
    segments++;
    const stepResult = await dig({direction: dir, length: stepLength, slope: 'up'});
    const advanced = stepResult?.completedSteps ?? stepResult?.advanced ?? 0;
    lastReason = stepResult?.reason || stepResult?.status || 'completed';
    lastDetail = stepResult;

    if (stepResult?.status === 'interrupted') {
      if (FATAL_DIG_REASONS.has(stepResult.reason)) {
        const after = await call('player.getState');
        return {
          status: 'interrupted',
          reason: stepResult.reason,
          startY,
          endY: Math.floor(after.y),
          climbed: Math.max(0, Math.floor(after.y) - startY),
          segments,
          directionsUsed,
          openSky: false,
          lastSegment: stepResult,
          position: {x: Math.floor(after.x), y: Math.floor(after.y), z: Math.floor(after.z)},
        };
      }
      if (advanced === 0) {
        avoided.add(dir);
        if (avoided.size >= ALL_DIRS.length) {
          const after = await call('player.getState');
          return {
            status: 'interrupted',
            reason: stepResult.reason || 'all_directions_blocked',
            startY,
            endY: Math.floor(after.y),
            climbed: Math.max(0, Math.floor(after.y) - startY),
            segments,
            directionsUsed,
            openSky: false,
            lastSegment: stepResult,
            position: {x: Math.floor(after.x), y: Math.floor(after.y), z: Math.floor(after.z)},
          };
        }
      } else {
        avoided.clear();
      }
    } else {
      avoided.clear();
    }
    await sleep(150);
  }

  current = await call('player.getState');
  const finalSky = await isOpenSky(call, current);
  const climbed = Math.max(0, Math.floor(current.y) - startY);
  return {
    status: finalSky.openSky && Math.floor(current.y) >= 55 ? 'succeeded' : 'interrupted',
    reason: finalSky.openSky && Math.floor(current.y) >= 55 ? 'reached_surface' : 'time_budget',
    startY,
    endY: Math.floor(current.y),
    climbed,
    segments,
    directionsUsed,
    openSky: Boolean(finalSky.openSky),
    lastReason,
    lastSegment: lastDetail,
    position: {x: Math.floor(current.x), y: Math.floor(current.y), z: Math.floor(current.z)},
  };
}

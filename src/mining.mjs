import { setTimeout as delay } from 'node:timers/promises';

const STONE_TIER_OK = /(?:^|:)(?:stone|cobblestone|deepslate|cobbled_deepslate|granite|diorite|andesite|tuff|calcite|dripstone_block|sandstone|red_sandstone|netherrack|basalt|smooth_basalt|blackstone|end_stone|coal_ore|deepslate_coal_ore|copper_ore|deepslate_copper_ore|iron_ore|deepslate_iron_ore|lapis_ore|deepslate_lapis_ore|nether_quartz_ore|nether_gold_ore)$/;
const VALUABLE_PICKAXE = /(?:^|:)(?:iron_pickaxe|diamond_pickaxe|netherite_pickaxe)$/;

async function chooseMiningSlot(call, before) {
  if (!Number.isInteger(before.bestSlot)) return null;
  if (!STONE_TIER_OK.test(before.id || '')) return before.bestSlot;
  try {
    const inv = await call('player.getInventory');
    const stacks = [...(inv?.hotbar || []), ...(inv?.main || [])];
    const bestItem = stacks.find(s => s.slot === before.bestSlot);
    if (!bestItem || !VALUABLE_PICKAXE.test(bestItem.id || '')) return before.bestSlot;
    const stonePick = stacks.find(
      s => s.id === 'minecraft:stone_pickaxe' && (!s.maxDamage || s.maxDamage - (s.damage ?? 0) > 3),
    );
    return stonePick ? stonePick.slot : before.bestSlot;
  } catch {
    return before.bestSlot;
  }
}

export async function mineBlock(call, args, {signal, check = async () => {}, sleep = ms => delay(ms, undefined, {signal})} = {}) {
  if (![args.x, args.y, args.z].every(Number.isFinite)) throw new Error('挖掘坐标无效');
  const pos = {x:Math.floor(args.x), y:Math.floor(args.y), z:Math.floor(args.z)};
  await call('screen.close');
  const before = (await call('perception.blocks', {positions:[pos], tool:true})).blocks[0];
  if (!before?.loaded || before.air) throw new Error('指定位置没有已加载的可挖方块');
  if (before.canHarvest === false) throw new Error('现有工具无法得到该方块的掉落');
  if (before.hardness < 0) throw new Error('指定方块无法正常挖开');
  await check();
  await call('fish.checkBlock', pos);
  const chosenSlot = await chooseMiningSlot(call, before);
  if (Number.isInteger(chosenSlot)) await call('fish.equip', {slot:chosenSlot});
  await call('control.lookAt', {x:pos.x+.5, y:pos.y+.5, z:pos.z+.5});
  await call('interact.breakBlock', {...pos, mode:'survival'});
  const until = Date.now()+30000;
  while (Date.now()<until) {
    signal?.throwIfAborted();
    await sleep(200);
    await check();
    const after = (await call('perception.blocks', {positions:[pos]})).blocks[0];
    // Require actual air, not merely a different id (e.g. fluid or falling gravel).
    if (after?.loaded && after.air) return {broke:before.id, position:pos, after:after.id};
  }
  throw new Error('指定方块在30秒内没有挖开，请核对工具和位置');
}

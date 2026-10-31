import { setTimeout as delay } from 'node:timers/promises';

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
  if (Number.isInteger(before.bestSlot)) await call('fish.equip', {slot:before.bestSlot});
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
